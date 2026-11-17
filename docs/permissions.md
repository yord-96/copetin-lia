# Permisos

Permisos iniciales:

- `companies.view`
- `companies.switch`
- `users.view`
- `users.create`
- `users.update`
- `roles.manage`
- `clients.view`
- `clients.create`
- `clients.update`
- `contracts.view`
- `contracts.create`
- `contracts.update`
- `contracts.approve`
- `inventory.view`
- `inventory.adjust`
- `cash.view`
- `cash.open`
- `cash.close`
- `attendance.view`
- `attendance.register`
- `attendance.update`
- `calendar.view`
- `calendar.update`
- `reports.view`
- `reports.export`
- `system.reset`
- `system.audit`

Roles iniciales:

- `developer`
- `superadmin`
- `administrator`
- `cashier`
- `inventory`
- `transport`
- `attendance`
- `viewer`

Los permisos deben validarse en backend. Ocultar botones en frontend es solo una mejora de UX, no seguridad.

Contabilidad de El Copetin: Developer y las operadoras activas LISBETH MUÑOZ y
ARACELY SIERRA pueden consultar y trabajar en Caja Grande, Caja Chica Efectivo y
Caja Chica Digital. El acceso nominal normaliza mayusculas, espacios y tildes;
no concede el rol Developer ni permisos tecnicos de usuarios, importacion o reset.
Las eliminaciones de movimientos verifican al operador por su ID en el estado del servidor.
