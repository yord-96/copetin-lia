# Rollback PostgreSQL

## Rollback funcional inmediato

Cambiar:

```env
DATABASE_MODE=json
```

Esto mantiene `/__copetin_db` y `app-state.json` como fuente de verdad.

## Restaurar JSON

Usar los scripts existentes:

```powershell
npm.cmd run backup
npm.cmd run restore
```

## Restaurar PostgreSQL

Usar `pg_restore` sobre un backup previo. Los scripts base estan en:

- `scripts/backup-postgres.sh`
- `scripts/restore-postgres.sh`

## Restaurar uploads

Restaurar el archivo generado por `scripts/backup-uploads.sh`.

Nunca borrar `uploads/` durante rollback.
