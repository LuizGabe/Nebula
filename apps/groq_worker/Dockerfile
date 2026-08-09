FROM python:3.11-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


FROM base AS dev
COPY audio ./audio
COPY batch ./batch
COPY core ./core
COPY emit ./emit
COPY events ./events
COPY inference ./inference
COPY infra ./infra
COPY observability ./observability
COPY worker.py .

ENTRYPOINT ["python", "-m", "worker"]


FROM base AS production
COPY audio ./audio
COPY batch ./batch
COPY core ./core
COPY emit ./emit
COPY events ./events
COPY inference ./inference
COPY infra ./infra
COPY observability ./observability
COPY worker.py .

RUN useradd -r -u 10001 -g root worker && chown -R worker:root /app
USER worker

ENTRYPOINT ["python", "-m", "worker"]
