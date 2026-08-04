#!/usr/bin/env bash
# scripts/compile_proto.sh
#
# Compila o proto a partir da raiz do projeto e corrige o import
# gerado pelo protoc no stub gRPC.
#
# Uso (a partir da raiz do projeto):
#   bash scripts/compile_proto.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Compilando proto..."

python -m grpc_tools.protoc \
  -I . \
  --python_out=. \
  --grpc_python_out=. \
  proto/transcriber.proto

# O protoc gera "import transcriber_pb2" mas o módulo está em proto/
# Corrige para "from proto import transcriber_pb2"
sed -i 's/^import transcriber_pb2/from proto import transcriber_pb2/' \
    proto/transcriber_pb2_grpc.py

echo "Proto compilado com sucesso."
echo "  proto/transcriber_pb2.py"
echo "  proto/transcriber_pb2_grpc.py"
