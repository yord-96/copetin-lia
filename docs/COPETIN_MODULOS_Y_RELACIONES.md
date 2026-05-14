# COPETIN - Modulos, Relaciones y Estado Tecnico

## Cobertura funcional en esta base de codigo

- `Dashboard`: resumen operativo con ordenes activas, stock, entregas y metricas financieras.
- `Clientes`: alta, edicion y metricas de historial por cliente.
- `Ordenes de Servicio`: gestionadas via `rentals` con proyeccion a `serviceOrders` y `serviceOrderItems`.
- `Inventario`: items, movimientos, recuperaciones y ajustes.
- `Transporte`: entregas, vehiculos y choferes con validacion de disponibilidad por ventana horaria.
- `Calendario`: eventos manuales + eventos derivados de entregas, mantenimientos y licencias.
- `Reportes`: plantillas generadas + reportes de ordenes.
- `Contabilidad`: caja, garantias, liquidaciones, saldos por cobrar y estados de cobro/finalizacion.
- `Usuarios`: alta, edicion y reenvio de invitaciones.
- `Ajustes`: configuracion global y numeracion.

## Relaciones principales modeladas

- Cliente `1:N` Ordenes (`clients -> serviceOrders` / `rentals`).
- Orden `1:N` Items (`serviceOrders -> serviceOrderItems`).
- Item `1:N` Movimientos (`items -> inventoryMovements/stock_movements`).
- Item `1:N` Ajustes (`items -> stockAdjustments`).
- Orden `1:N` Entregas (`serviceOrders/rentals -> deliveries`).
- Vehiculo `1:N` Entregas (`vehicles -> deliveries`).
- Chofer `1:N` Entregas (`drivers -> deliveries`).
- Orden `1:N` Pagos (`serviceOrders/rentals -> payments`).
- Orden `1:N` Penalidades (`serviceOrders/rentals -> penalties`).
- Orden `1:N` Movimientos de caja (`rentals/returns -> cashMovements`).
- Usuario `1:N` Acciones (`users -> auditLogs`).

## Reglas tecnicas activas

- Auditoria de operaciones clave (`auditLogs`) en clientes, usuarios, inventario, ordenes, caja y transporte.
- Soft delete en entidades relevantes mediante `deletedAt` (sin borrado fisico para datos criticos).
- Validacion de conflictos de agenda para chofer/vehiculo al crear o actualizar entregas.
- Persistencia web local/demo unificada para todos los modulos mientras se migra a backend.

## Nota de evolucion

- Para despliegue empresarial con PostgreSQL, usar el archivo:
  - `docs/COPETIN_POSTGRESQL_SCHEMA.sql`
- Ese esquema incluye constraints y triggers para:
  - inmutabilidad de movimientos de stock
  - bloqueo de edicion de ordenes cerradas
  - soporte de soft delete
