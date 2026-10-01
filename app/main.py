import asyncio
import random
import uuid
import zipfile
from io import BytesIO

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.database import (
    get_supabase_client,
    obtener_cliente_autenticado,
    obtener_preguntas_aleatorias,
    obtener_usuario_desde_token,
)
from app.models import Dificultad, PreguntaMezclada
from app.pdf_generator import generar_pdf_alumno, generar_pdf_maestro, generar_pdf_resultado

app = FastAPI(
    title="Generador de Exámenes Aleatorios",
    version="1.0.0",
)

# CORS: en desarrollo el frontend vive en un origen distinto al backend
# (p.ej. Live Server en 127.0.0.1:5500 llamando a localhost:8001), y el
# navegador bloquea esas peticiones por defecto. Se permite explícitamente
# aquí. En producción, esta lista debería restringirse al dominio real
# donde se sirva el frontend, en vez de "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _mezclar_opciones(fila: dict) -> PreguntaMezclada:
    """
    Toma una fila cruda de Supabase y baraja las 4 opciones. Es CPU-bound
    pero trivial (microsegundos), así que se ejecuta de forma síncrona
    dentro del endpoint async sin bloquear el event loop de forma perceptible.
    """
    pares = [
        ("A", fila["opcion_a"]),
        ("B", fila["opcion_b"]),
        ("C", fila["opcion_c"]),
        ("D", fila["opcion_d"]),
    ]
    letra_original_correcta = fila["respuesta_correcta"]
    texto_correcto = dict(pares)[letra_original_correcta]

    random.shuffle(pares)

    nuevas_letras = ["A", "B", "C", "D"]
    opciones_mezcladas = {}
    letra_correcta_nueva = None
    for nueva_letra, (_, texto) in zip(nuevas_letras, pares):
        opciones_mezcladas[nueva_letra] = texto
        if texto == texto_correcto:
            letra_correcta_nueva = nueva_letra

    return PreguntaMezclada(
        id=fila["id"],
        pregunta=fila["pregunta"],
        opciones=opciones_mezcladas,
        letra_correcta=letra_correcta_nueva,
        dificultad=fila["dificultad"],
        categoria=fila["categoria"],
    )


@app.get("/api/examenes/generar")
async def generar_examen(
    cantidad: int = Query(default=6, ge=1, le=50),
    categoria: str | None = Query(default=None),
    dificultad: Dificultad | None = Query(default=None),
    authorization: str = Header(...),
):
    """
    Flujo:
      0. Valida el token del maestro que llama (Bearer) y confirma que su
         rol sea 'profesor' o 'admin'. Las preguntas se sortean SOLO de su
         propio banco (creado_por = su id) — nunca del de otro maestro.
      1. Trae `cantidad` preguntas al azar desde Supabase (RPC async, I/O-bound).
      2. Mezcla las opciones A-D de cada pregunta.
      3. Genera PDF alumno y PDF maestro en paralelo, cada uno en su propio
         buffer BytesIO (nunca se escribe a disco).
      4. Empaqueta ambos PDFs en un ZIP en memoria y lo devuelve como
         streaming response con un nombre único (UUID) para evitar
         colisiones entre descargas concurrentes.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Falta el token de autenticación.")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        usuario = await obtener_usuario_desde_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado.")

    cliente = await obtener_cliente_autenticado(token)
    perfil_resp = await (
        cliente.table("perfiles").select("rol").eq("id", usuario.id).maybe_single().execute()
    )
    perfil = perfil_resp.data if perfil_resp else None
    if not perfil or perfil["rol"] not in ("profesor", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Solo los maestros pueden generar exámenes en PDF.",
        )

    filas = await obtener_preguntas_aleatorias(
        cantidad=cantidad,
        categoria=categoria,
        dificultad=dificultad.value if dificultad else None,
        creado_por=usuario.id,
    )

    if not filas:
        raise HTTPException(
            status_code=404,
            detail="No se encontraron preguntas en tu banco para los filtros indicados.",
        )
    if len(filas) < cantidad:
        raise HTTPException(
            status_code=422,
            detail=f"Solo tienes {len(filas)} preguntas en tu banco para esos filtros "
                   f"(se pidieron {cantidad}).",
        )

    preguntas = [_mezclar_opciones(f) for f in filas]

    # Generación de ambos PDFs en paralelo. reportlab es síncrono/CPU-bound,
    # así que se delega a un hilo del threadpool de FastAPI (run_in_executor
    # vía asyncio.to_thread) para no bloquear el event loop mientras se
    # atienden otras peticiones concurrentes.
    pdf_alumno_task = asyncio.to_thread(generar_pdf_alumno, preguntas)
    pdf_maestro_task = asyncio.to_thread(generar_pdf_maestro, preguntas)
    pdf_alumno_buffer, pdf_maestro_buffer = await asyncio.gather(
        pdf_alumno_task, pdf_maestro_task
    )

    # Empaquetado en un ZIP en memoria (segundo buffer BytesIO, nunca disco).
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("examen_alumno.pdf", pdf_alumno_buffer.getvalue())
        zf.writestr("examen_maestro.pdf", pdf_maestro_buffer.getvalue())
    zip_buffer.seek(0)

    nombre_zip = f"examen_{uuid.uuid4().hex}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{nombre_zip}"'},
    )


@app.get("/api/examenes/resultado/{intento_id}")
async def resultado_examen(intento_id: str, authorization: str = Header(...)):
    """
    Genera el PDF de resultado de UN intento específico. Requiere el header
    'Authorization: Bearer <token>' con el access_token de la sesión de
    Supabase del propio alumno (se obtiene en el frontend con
    sb.auth.getSession()). No se acepta la clave service_role aquí: el
    cliente que arma este endpoint usa el token del alumno, así que RLS
    decide por sí solo si tiene permiso de ver ese intento — si intenta
    pedir el resultado de otro alumno cambiando el UUID en la URL, la
    consulta simplemente no devuelve nada (404), no un error de permisos
    revelador.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Falta el token de autenticación.")
    token = authorization.removeprefix("Bearer ").strip()

    client = await obtener_cliente_autenticado(token)

    intento_resp = await (
        client.table("intentos_examen")
        # El embed anidado examenes(..., perfiles(...)) trae de un jalón el
        # título del examen Y el nombre del maestro que lo creó, siguiendo
        # la relación examenes.creado_por -> perfiles.id. Requiere la
        # política "Alumnos ven perfil del profesor de su examen" (RLS).
        .select("id, examen_id, alumno_id, estado, calificacion, examenes(titulo, perfiles(nombre_completo))")
        .eq("id", intento_id)
        .maybe_single()
        .execute()
    )
    intento = intento_resp.data if intento_resp else None
    if not intento:
        raise HTTPException(status_code=404, detail="Intento no encontrado o no autorizado.")
    if intento["estado"] != "entregado":
        raise HTTPException(status_code=409, detail="Este examen todavía no ha sido entregado.")

    nombre_maestro = (intento["examenes"].get("perfiles") or {}).get("nombre_completo") or "—"

    perfil_resp = await (
        client.table("perfiles").select("nombre_completo, matricula").eq("id", intento["alumno_id"]).maybe_single().execute()
    )
    nombre_alumno = (perfil_resp.data or {}).get("nombre_completo") or "Alumno"
    matricula_alumno = (perfil_resp.data or {}).get("matricula")

    preguntas_resp = await (
        client.table("examen_preguntas")
        .select("id, pregunta_texto, opcion_a, opcion_b, opcion_c, opcion_d, letra_correcta, orden")
        .eq("examen_id", intento["examen_id"])
        .order("orden")
        .execute()
    )
    respuestas_resp = await (
        client.table("respuestas_alumno")
        .select("examen_pregunta_id, letra_seleccionada")
        .eq("intento_id", intento_id)
        .execute()
    )
    respuestas_por_pregunta = {
        r["examen_pregunta_id"]: r["letra_seleccionada"] for r in (respuestas_resp.data or [])
    }

    detalle = [
        {
            "pregunta": p["pregunta_texto"],
            "opciones": {
                "A": p["opcion_a"], "B": p["opcion_b"], "C": p["opcion_c"], "D": p["opcion_d"],
            },
            "correcta": p["letra_correcta"],
            "seleccionada": respuestas_por_pregunta.get(p["id"]),
        }
        for p in (preguntas_resp.data or [])
    ]

    pdf_buffer = await asyncio.to_thread(
        generar_pdf_resultado,
        titulo_examen=intento["examenes"]["titulo"],
        nombre_alumno=nombre_alumno,
        matricula_alumno=matricula_alumno,
        nombre_maestro=nombre_maestro,
        calificacion=intento["calificacion"],
        detalle=detalle,
    )

    nombre_pdf = f"resultado_{uuid.uuid4().hex}.pdf"
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nombre_pdf}"'},
    )


@app.delete("/api/admin/usuarios/{usuario_id}")
async def borrar_usuario(usuario_id: str, authorization: str = Header(...)):
    """
    Borrado PERMANENTE de una cuenta. Requiere que quien llama sea admin.

    Usa la clave service_role (a través de get_supabase_client) porque
    borrar de auth.users solo lo puede hacer esa clave — es la única
    razón por la que este endpoint existe en el backend en vez de hacerse
    directo desde admin.html con la clave anon.

    El borrado en cascada de todo el contenido de esa persona (preguntas,
    exámenes, intentos, respuestas) lo resuelve Postgres solo, gracias a
    los ON DELETE CASCADE agregados en schema_v2_addendum3.sql — este
    endpoint no necesita saber nada de esas tablas.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Falta el token de autenticación.")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        usuario_admin = await obtener_usuario_desde_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado.")

    cliente = await obtener_cliente_autenticado(token)
    perfil_resp = await (
        cliente.table("perfiles").select("rol").eq("id", usuario_admin.id).maybe_single().execute()
    )
    perfil = perfil_resp.data if perfil_resp else None
    if not perfil or perfil["rol"] != "admin":
        raise HTTPException(status_code=403, detail="Solo un administrador puede borrar cuentas.")

    if usuario_id == usuario_admin.id:
        raise HTTPException(status_code=400, detail="No puedes borrar tu propia cuenta desde aquí.")

    cliente_servicio = await get_supabase_client()
    try:
        await cliente_servicio.auth.admin.delete_user(usuario_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"No se pudo borrar la cuenta: {exc}")

    return {"status": "ok", "usuario_id": usuario_id}


@app.get("/health")
async def health():
    return {"status": "ok"}