# Generador de Exámenes Aleatorios — Arquitectura de alta concurrencia

## Estructura del proyecto

```
examen-generador/
├── app/
│   ├── main.py            # Endpoint FastAPI
│   ├── database.py        # Cliente Supabase async + RPC
│   ├── pdf_generator.py   # Generación de PDFs en memoria (BytesIO)
│   └── models.py          # Modelos Pydantic
├── schema.sql              # DDL + función RPC + RLS de Supabase
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 1. Puesta en marcha

```bash
cp .env.example .env
# editar .env con tus credenciales reales de Supabase

# aplicar schema.sql en el SQL Editor de Supabase (o vía CLI)

docker compose up --build
```

El endpoint queda disponible en:

```
GET http://localhost:8000/api/examenes/generar?cantidad=6&categoria=matematicas&dificultad=media
```

Responde con un `.zip` que contiene `examen_alumno.pdf` (sin respuestas) y
`examen_maestro.pdf` (respuestas correctas resaltadas en verde).

## 2. Por qué la selección aleatoria vive en Postgres, no en Python

`order by random() limit N` ejecutado **dentro** de la función RPC
`obtener_preguntas_aleatorias` evita traer miles de filas por la red para
luego muestrear en el backend. Con tablas grandes (>100k filas) conviene
sustituir `random()` por muestreo basado en `TABLESAMPLE` o en un campo
`id` aleatorio pre-calculado; la función queda aislada en `schema.sql`
precisamente para poder optimizarla sin tocar el backend.

## 3. Por qué nunca se escribe a disco

Cada PDF se construye directamente sobre un buffer `BytesIO` que
`ReportLab` trata como si fuera un archivo. El ZIP final también se arma
en un segundo `BytesIO`. Como no hay ninguna ruta de archivo física
involucrada:

- No hay riesgo de colisión de nombres entre usuarios concurrentes.
- No hay que limpiar archivos huérfanos si una request falla a la mitad.
- El contenedor puede correr con filesystem de solo lectura (`read_only: true`
  en Compose) si se quiere endurecer aún más la seguridad.

Los UUID (`uuid4().hex`) solo se usan para nombrar el archivo de descarga
que ve el usuario final, nunca como ruta en disco.

## 4. Guía de concurrencia: FastAPI + Docker

**a) Dentro de un mismo proceso (event loop de FastAPI/Uvicorn)**

- La llamada a Supabase (`await client.rpc(...).execute()`) es I/O de red.
  Mientras espera la respuesta, el event loop queda libre para atender
  otras peticiones entrantes — por eso el cliente Supabase se usa en su
  variante `AsyncClient` (`acreate_client`), no la síncrona.
- La generación del PDF con ReportLab es CPU-bound y **síncrona** por
  naturaleza (la librería no ofrece una API async). Ejecutarla directamente
  dentro de una función `async def` bloquearía el event loop y congelaría
  a todos los demás usuarios durante esos milisegundos. Por eso se delega
  a un hilo con `asyncio.to_thread(...)`, que internamente usa el
  threadpool por defecto de FastAPI/Starlette. El event loop principal
  sigue aceptando conexiones mientras esos hilos trabajan en paralelo.
- Los dos PDFs (alumno y maestro) se generan con `asyncio.gather(...)`,
  así que corren en hilos distintos simultáneamente en vez de uno después
  del otro.

**b) Entre procesos, dentro de un mismo contenedor**

- El `CMD` del `Dockerfile` levanta Uvicorn con `--workers 4`: cuatro
  procesos independientes, cada uno con su propio event loop y su propio
  threadpool, escuchando en el mismo puerto vía `SO_REUSEPORT`. El sistema
  operativo reparte las conexiones entrantes entre ellos. Esto aprovecha
  múltiples núcleos de CPU, algo que un único proceso async no puede hacer
  por el GIL de Python.
- El número de workers debe ajustarse a los CPUs reservados en
  `docker-compose.yml` (regla práctica: `2 × núcleos + 1`).

**c) Entre contenedores / instancias (escalado horizontal)**

- Como no se usa disco local para nada persistente ni para archivos
  temporales, el contenedor es completamente *stateless*. Eso permite
  levantar N réplicas idénticas (`docker compose up --scale api=3`, o en
  Kubernetes/ECS) detrás de un balanceador de carga sin ningún problema de
  sincronización de archivos entre instancias.
- Supabase (Postgres administrado) actúa como única fuente de verdad
  compartida; el `AsyncClient` de cada worker mantiene su propio pool de
  conexiones HTTP keep-alive hacia Supabase, evitando el costo de
  reconexión en cada request.

**Resumen del flujo bajo carga concurrente:**

```
Cliente A ─┐                     ┌─► await Supabase RPC (I/O, no bloquea)
Cliente B ─┼─► Worker Uvicorn 1 ─┤
Cliente C ─┘                     └─► asyncio.to_thread(ReportLab) (CPU, hilo aparte)

Cliente D ─┐
Cliente E ─┼─► Worker Uvicorn 2  (proceso independiente, otro núcleo de CPU)
           ┘
```

## 5. Notas de seguridad

- La `SUPABASE_SERVICE_KEY` solo debe vivir en el backend (variable de
  entorno del contenedor), nunca en el cliente/frontend.
- RLS está activo en la tabla `preguntas`; la policy pública solo permite
  `select` de filas `activo = true`. El backend usa `service_role`, que
  ignora RLS, así que sigue siendo responsable de filtrar correctamente.
