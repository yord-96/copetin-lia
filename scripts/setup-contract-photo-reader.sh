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
if [ "${available_kb:-0}" -lt 4194304 ] || [ "${disk_kb:-0}" -lt 16777216 ]; then
  echo "Para esta configuración reserva al menos 4 GiB de RAM disponible y 16 GiB de disco libre. No se instaló el lector."
  exit 1
fi
docker compose -f docker-compose.contract-photo.yml up -d
reader_ready=false
for attempt in $(seq 1 30); do
  if docker compose -f docker-compose.contract-photo.yml exec -T ollama ollama list >/dev/null 2>&1; then
    reader_ready=true
    break
  fi
  sleep 2
done
if [ "$reader_ready" != true ]; then
  echo "Ollama no inició en 60 segundos. Revisa los registros del contenedor."
  docker compose -f docker-compose.contract-photo.yml logs --tail=60 ollama
  exit 1
fi
docker compose -f docker-compose.contract-photo.yml exec -T ollama ollama pull qwen3-vl:2b
echo "Modelo local instalado. Verifica con: node scripts/check-contract-photo-reader.mjs"
echo "No se cambió la base de datos ni se reinició la aplicación."
