# Despliegue PostgreSQL

Esta fase esta preparada solo para trabajo local. No ejecutar en VPS todavia.

## Local

```powershell
npm.cmd run postgres:up
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run db:migrate:dry
npm.cmd run db:migrate
npm.cmd run db:verify
```

## Produccion futura

1. Crear backup de JSON.
2. Crear backup de uploads.
3. Crear `pg_dump` si ya existe base.
4. Ejecutar migracion en ventana de mantenimiento.
5. Verificar conteos y totales.
6. Cambiar `DATABASE_MODE=hybrid`.
7. Monitorear logs.
8. Recién despues migrar modulos frontend.

No usar credenciales locales en produccion.
