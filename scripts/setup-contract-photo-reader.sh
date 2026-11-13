#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Se necesita Docker Engine con Compose. Consulta docs/contract-photo-import.md."
  exit 1
fi
available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
docker_root=$(docker info --format '{{.DockerRootDir}}')
disk_kb=$(df -Pk "$docker_root" | awk 'NR==2 {print $4}')
if [ "${available_kb:-0}" -lt 4194304 ] || [ "${disk_kb:-0}" -lt 8388608 ]; then
  echo "Para esta configuración reserva al menos 4 GiB de RAM disponible y 8 GiB de disco libre. No se instaló el lector."
  exit 1
fi
docker compose -f docker-compose.contract-photo.yml up -d
docker compose -f docker-compose.contract-photo.yml exec -T ollama ollama pull qwen3-vl:2b
echo "Modelo local instalado. Verifica con: node scripts/check-contract-photo-reader.mjs"
echo "No se cambió la base de datos ni se reinició la aplicación."
