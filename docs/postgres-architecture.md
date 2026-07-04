# Arquitectura PostgreSQL

Flujo objetivo:

```text
React/Vite
  -> src/services/apiClient.js
  -> Node/Express REST API
  -> middlewares auth/company/permission
  -> services por modulo
  -> repositories Prisma
  -> PostgreSQL
  -> uploads/ para archivos
```

## Modos

- `DATABASE_MODE=json`: comportamiento heredado con `app-state.json` y `/__copetin_db`.
- `DATABASE_MODE=hybrid`: PostgreSQL solo para modulos migrados; JSON sigue para pendientes.
- `DATABASE_MODE=postgres`: PostgreSQL como fuente de verdad.

No se elimina `/__copetin_db` hasta terminar la migracion funcional.

## Matriz inicial

| Modulo | Fuente actual | Hybrid inicial | Fuente final | Riesgo | Rollback |
|---|---|---|---|---|---|
| auth | JSON/sessionStorage | Postgres cuando endpoints auth esten activos | Postgres | Alto | Volver a `DATABASE_MODE=json` |
| companies | no aplica | Postgres | Postgres | Medio | Reimportar desde JSON |
| users | JSON | Postgres luego de verificar roles | Postgres | Alto | JSON |
| attendance | JSON + uploads | Postgres + uploads | Postgres | Medio | JSON |
| clients | JSON | Postgres tras verificacion | Postgres | Alto | JSON |
| cash | JSON | JSON hasta cierre de pruebas | Postgres | Alto | JSON |
| calendar | JSON | JSON hasta endpoints | Postgres | Medio | JSON |
| deliveries | JSON | JSON hasta endpoints | Postgres | Medio | JSON |
| contracts | JSON | JSON hasta validacion completa | Postgres | Critico | JSON |
| inventory | JSON | JSON hasta validacion stock | Postgres | Critico | JSON |
| suppliers | JSON | JSON hasta endpoints | Postgres | Medio | JSON |
| reports | JSON/uploads | JSON hasta endpoints | Postgres metadata | Bajo | JSON |

## Concurrencia

Las entidades nuevas tienen `version Int @default(1)`. Cada API migrada debe recibir `expectedVersion`, actualizar con condicion de version e incrementar a `version + 1`. Mientras existan modulos JSON, se conserva la revision global heredada.
