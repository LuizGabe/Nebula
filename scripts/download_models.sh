#!/usr/bin/env bash
# Baixa os modelos ONNX INT8 do Parakeet TDT 0.6B v3 (~670 MB)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/apps/parakeet/models"
BASE_URL="https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main"

echo "📁 Destino: $MODELS_DIR"
mkdir -p "$MODELS_DIR"

files=(
    "config.json"
    "encoder-model.int8.onnx"
    "decoder_joint-model.int8.onnx"
    "nemo128.onnx"
    "vocab.txt"
)

for file in "${files[@]}"; do
    dest="$MODELS_DIR/$file"
    if [ -f "$dest" ]; then
        echo "✅ Já existe: $file"
        continue
    fi
    echo "⬇️  Baixando: $file"
    curl -L --progress-bar -o "$dest" "${BASE_URL}/${file}?download=true"
done

echo ""
echo "✅ Modelos em: $MODELS_DIR"
echo "   $(du -sh "$MODELS_DIR" | cut -f1) no total"
echo ""
echo "Agora suba o container:"
echo "  docker compose up -d --build"