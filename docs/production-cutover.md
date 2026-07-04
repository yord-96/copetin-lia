# Corte a produccion

No ejecutar todavia. Esta guia es para una fase posterior.

## Pre-corte

1. Congelar cambios de datos o definir ventana corta.
2. Backup de `data/app-state.json`.
3. Backup de `uploads/`.
4. Probar migracion con copia reciente.
5. Ejecutar `db:migrate:dry`.
6. Revisar `reports/postgres-migration-report.md`.
7. Ejecutar migracion en staging/local.
8. Ejecutar `db:verify`.

## Corte

1. Activar PostgreSQL.
2. Ejecutar migracion.
3. Verificar PASS criticos.
4. Cambiar `DATABASE_MODE=hybrid`.
5. Probar login, empresa, asistencia y modulos migrados.

## Rollback

Volver a:

```env
DATABASE_MODE=json
```

Restaurar JSON/uploads solo si hubo cambios destructivos externos. En esta fase no debe haberlos.

## Tiempo estimado

Para el tamaño local actual, la importacion deberia tardar minutos. El corte real debe estimarse despues de probar en un entorno con PostgreSQL disponible.
