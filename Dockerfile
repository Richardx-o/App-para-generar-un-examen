# ---------- Etapa 1: build de dependencias ----------
FROM python:3.12-slim AS builder

WORKDIR /app

# Dependencias del sistema solo necesarias para compilar wheels
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# ---------- Etapa 2: imagen final, liviana ----------
FROM python:3.12-slim

WORKDIR /app

# Usuario no-root por seguridad
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copiar únicamente los paquetes ya instalados (sin build tools)
COPY --from=builder /root/.local /home/appuser/.local
COPY ./app ./app

ENV PATH=/home/appuser/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER appuser

EXPOSE 8000

# --workers se ajusta según CPUs disponibles del contenedor;
# Uvicorn con workers de Gunicorn es la opción recomendada en prod,
# aquí se deja Uvicorn puro para simplicidad (ver docker-compose para escalar).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
