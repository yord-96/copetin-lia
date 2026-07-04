#!/usr/bin/env sh
set -eu

UPLOADS_DIR="${UPLOADS_DIR:-./uploads}"
BACKUP_DIR="${BACKUP_DIR:-./backups/uploads}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$BACKUP_DIR/copetin-uploads-$TIMESTAMP.tar.gz"

if [ ! -d "$UPLOADS_DIR" ]; then
  echo "Uploads directory not found: $UPLOADS_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
tar -czf "$OUTPUT" "$UPLOADS_DIR"
echo "$OUTPUT"
