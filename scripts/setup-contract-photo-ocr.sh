#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! python3 -c 'import sys; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; then
  echo "Se necesita Python 3.10 o posterior. Ubuntu 24.04 incluye Python 3.12."
  exit 1
fi
available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
disk_kb=$(df -Pk . | awk 'NR==2 {print $4}')
if [ "${available_kb:-0}" -lt 1048576 ] || [ "${disk_kb:-0}" -lt 2097152 ]; then
  echo "Reserva al menos 1 GiB de RAM disponible y 2 GiB de disco antes de instalar el OCR."
  exit 1
fi
mkdir -p data/contract-photo-python
if ! python3 -m venv data/contract-photo-python/venv; then
  echo "Falta el módulo venv. Instala python3-venv y vuelve a ejecutar este script con el usuario de la aplicación."
  exit 1
fi
data/contract-photo-python/venv/bin/python -m pip install --no-cache-dir -r scripts/research/requirements-contract-ocr.txt
data/contract-photo-python/venv/bin/python server/ocr/worker.py --install-models
data/contract-photo-python/venv/bin/python server/ocr/worker.py --check
echo "OCR instalado. Para seleccionarlo, configura CONTRACT_PHOTO_ENGINE=python en el .env del backend y reinicia PM2."
echo "No se cambió la base de datos ni se activó automáticamente este motor."
