# ─── Build stage ──────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY apps/parakeet_worker/requirements.txt .

# onnxruntime CPU-only — NÃO instala onnxruntime-gpu
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /

# libgomp = paralelismo OpenMP do ONNX Runtime
# ffmpeg  = decode de mp3/m4a/ogg/etc pelo onnx-asr
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

COPY apps/parakeet_worker/ .

VOLUME ["/models"]

EXPOSE 5092

CMD ["python", "worker.py"]