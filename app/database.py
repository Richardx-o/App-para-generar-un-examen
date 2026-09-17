import os
from functools import lru_cache

from supabase import AsyncClient, acreate_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]

_client: AsyncClient | None = None


async def get_supabase_client() -> AsyncClient:
    """
    Devuelve un único cliente async de Supabase reutilizado en toda la vida
    del proceso (patrón singleton). Esto evita abrir una conexión HTTP nueva
    en cada petición y permite que httpx reutilice su pool de conexiones
    keep-alive, algo crítico bajo alta concurrencia.
    """
    global _client
    if _client is None:
        _client = await acreate_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


async def obtener_preguntas_aleatorias(
    cantidad: int = 6,
    categoria: str | None = None,
    dificultad: str | None = None,
    creado_por: str | None = None,
) -> list[dict]:
    """
    Llama a la función RPC 'obtener_preguntas_aleatorias' definida en Postgres.
    Se usa RPC (y no un SELECT + ORDER BY random() desde el cliente) para que
    el muestreo aleatorio ocurra dentro del motor de base de datos y no se
    transfiera la tabla completa por red.

    `creado_por`, si se pasa, restringe el sorteo al banco de un maestro
    específico (así cada maestro solo puede generar exámenes de SUS propias
    preguntas, nunca de las de otro).
    """
    client = await get_supabase_client()

    response = await (
        client.rpc(
            "obtener_preguntas_aleatorias",
            {
                "cantidad": cantidad,
                "filtro_categoria": categoria,
                "filtro_dificultad": dificultad,
                "filtro_creado_por": creado_por,
            },
        ).execute()
    )

    return response.data or []


async def obtener_cliente_autenticado(access_token: str) -> AsyncClient:
    """
    A diferencia de get_supabase_client() (que usa la SUPABASE_SERVICE_KEY y
    se salta RLS por completo), este cliente se autentica con el token de
    sesión propio de quien hizo la petición HTTP (alumno o maestro). Así,
    cualquier consulta hecha con este cliente queda sujeta a las mismas
    políticas RLS que ya protegen sus datos, sin que el backend tenga que
    reimplementar esa validación de permisos a mano.

    Se crea uno nuevo por petición (no es el singleton) porque cada quien
    trae un token distinto.
    """
    client = await acreate_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(access_token)
    return client


async def obtener_usuario_desde_token(access_token: str):
    """
    Valida el token contra el servidor de Supabase Auth (nunca se confía en
    un JWT decodificado a mano en el backend) y regresa el usuario real al
    que pertenece. Se usa para saber QUIÉN llama al endpoint antes de decidir
    qué puede hacer — por ejemplo, para filtrar el banco de preguntas por su
    propio id de maestro.

    Lanza ValueError si el token es inválido, expiró, o no corresponde a
    ningún usuario.
    """
    client = await obtener_cliente_autenticado(access_token)
    respuesta = await client.auth.get_user(access_token)
    if not respuesta or not respuesta.user:
        raise ValueError("Token inválido o expirado.")
    return respuesta.user