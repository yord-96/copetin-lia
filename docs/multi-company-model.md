# Modelo multiempresa

La empresa inicial para datos heredados es:

- `code`: `COPETIN`
- `name`: `El Copetin`

El dry-run tambien prepara una segunda empresa vacia:

- `code`: `SECONDARY`
- `status`: `inactive`

Todos los registros heredados se asignan a `COPETIN`. No se duplican datos hacia la segunda empresa.

## Acceso

`UserCompany` define a que empresas pertenece un usuario, su rol por empresa y si es su empresa predeterminada.

El frontend no debe enviar `companyId` como fuente de verdad. La API debe derivarlo de la sesion activa y validar con `requireCompanyAccess`.

## Aislamiento

Todas las entidades operativas tienen `companyId`. Las consultas REST deben filtrar siempre por la empresa activa de la sesion.
