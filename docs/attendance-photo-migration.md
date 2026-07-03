# Migracion manual de fotos de asistencia

Esta migracion saca `attendanceRecords[n].photoDataUrl` del JSON principal y guarda la imagen como archivo en `uploads/attendance`.

No se ejecuta automaticamente al iniciar el servidor.

## Diagnostico previo

```powershell
npm run migrate:attendance-photos:dry
```

Opcionalmente indica rutas explicitas:

```powershell
node scripts/migrate-attendance-photos.mjs --dry-run --state=./data/app-state.json --uploads=./uploads/attendance
```

El modo `dry-run` no escribe archivos. Informa registros detectados, bytes y nombres de archivos que crearia.

## Aplicar migracion local

```powershell
npm run migrate:attendance-photos
```

Antes de modificar el JSON, el script crea un backup completo en `data/backups/`.

## Aplicar migracion en VPS

1. Detener temporalmente el servidor o ponerlo en mantenimiento breve.
2. Verificar la ruta real de `APP_STATE_FILE`.
3. Ejecutar:

```bash
npm run migrate:attendance-photos:dry
npm run migrate:attendance-photos
```

4. Confirmar que existen archivos en `uploads/attendance`.
5. Iniciar el servidor.
6. Verificar que registros antiguos muestren la foto mediante `photoUrl`.

## Rollback

1. Detener el servidor.
2. Restaurar el backup creado por el script:

```bash
cp data/backups/app-state-before-attendance-photo-migration-YYYYMMDD-HHMMSS.json data/app-state.json
```

3. Reiniciar el servidor.

Los archivos creados en `uploads/attendance` pueden permanecer; el JSON restaurado volvera a usar `photoDataUrl`.

## Notas de seguridad

- No elimina backups.
- No sobrescribe archivos existentes con contenido distinto.
- Conserva IDs, fechas y campos ajenos a la fotografia.
- Actualiza `version`, `checksum` y `updatedAt` solo cuando el archivo tiene estructura con wrapper `state`.
