# Migracion JSON a PostgreSQL

## Analisis

```powershell
npm.cmd run db:analyze
```

Genera:

- `reports/json-schema-analysis.json`
- `reports/json-schema-analysis.md`

## Dry-run

```powershell
npm.cmd run db:migrate:dry
```

No modifica `data/app-state.json` ni PostgreSQL. Genera:

- `reports/postgres-migration-report.json`
- `reports/postgres-migration-report.md`

## Apply local

Requiere PostgreSQL activo y `DATABASE_URL` configurado o el fallback local del compose.

```powershell
npm.cmd run postgres:up
npm.cmd run prisma:migrate
npm.cmd run db:migrate
npm.cmd run db:verify
```

## Reset local

Solo para base local de desarrollo:

```powershell
npm.cmd run db:reset-local
```

## Reglas

- Nunca modifica `data/app-state.json`.
- Conserva IDs heredados.
- Usa `legacyData` para campos complejos.
- No importa `userPresence`.
- No importa `isCurrentUser`.
- Preserva `passwordHash` heredado sin imprimirlo.
- No guarda base64 en PostgreSQL.
