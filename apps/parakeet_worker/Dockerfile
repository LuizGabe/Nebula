# ── Parakeet Worker — GPU-first ──────────────────────────────────────────────
#
# Base: NVIDIA NeMo 24.09 (CUDA 12.6, PyTorch 2.4, Python 3.10)
# GPU target: RTX 4060 8GB (sm_89 / Ada Lovelace)
#
# Build:
#   docker build -t parakeet-worker:latest .
#
# Run (requer NVIDIA Container Runtime):
#   docker run --gpus all -p 50051:50051 -p 9090:9090 \
#     --env-file .env parakeet-worker:latest

FROM nvcr.io/nvidia/nemo:24.09

WORKDIR /app

# ── dependências Python adicionais ───────────────────────────────────────────
COPY requirements.txt .
COPY requirements-diarization.txt .
ARG ENABLE_DIARIZATION=false
RUN pip install --no-cache-dir -r requirements.txt
RUN if [ "$ENABLE_DIARIZATION" = "true" ]; then pip install --no-cache-dir -r requirements-diarization.txt; fi

# ── compilação do proto ───────────────────────────────────────────────────────
# Gera a partir da raiz com -I . para que o import gerado seja
# "proto.transcriber_pb2" (compatível com a estrutura de pacotes).
COPY proto/ proto/
RUN python -m grpc_tools.protoc \
      -I . \
      --python_out=. \
      --grpc_python_out=. \
      proto/transcriber.proto && \
    sed -i 's/^import transcriber_pb2/from proto import transcriber_pb2/' \
        proto/transcriber_pb2_grpc.py

# ── código da aplicação ───────────────────────────────────────────────────────
COPY core/          core/
COPY grpc_server/   grpc_server/
COPY session/       session/
COPY inference/     inference/
COPY batch/         batch/
COPY audio/         audio/
COPY emit/          emit/
COPY observability/ observability/
COPY infra/         infra/
COPY utils/         utils/
COPY worker.py      .

# ── usuário não-root + diretórios de cache graváveis ─────────────────────────
#
# Problema: useradd -r cria um system user SEM home directory (/home/worker
# não existe nem tem permissão). HuggingFace Hub, lhotse e matplotlib tentam
# escrever em /home/worker/.cache e falham com PermissionError.
#
# Solução: criar todos os diretórios de cache dentro de /app (que pertence ao
# usuário worker) e apontar as variáveis de ambiente para lá.
RUN groupadd -r worker && \
    useradd -r -g worker -d /app worker && \
    mkdir -p \
        /app/.cache/huggingface/hub \
        /app/.cache/torch \
        /app/.cache/matplotlib \
        /app/.lhotse/tools && \
    chown -R worker:worker /app

# Aponta todas as bibliotecas que tentam escrever em $HOME para /app/.cache
ENV HOME=/app
ENV HF_HOME=/app/.cache/huggingface
ENV HUGGINGFACE_HUB_CACHE=/app/.cache/huggingface/hub
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface/hub
ENV TORCH_HOME=/app/.cache/torch
ENV MPLCONFIGDIR=/app/.cache/matplotlib

USER worker

# ── portas ────────────────────────────────────────────────────────────────────
EXPOSE 50051 9090

# ── health check Docker ───────────────────────────────────────────────────────
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1

ENTRYPOINT ["python", "-m", "worker"]
