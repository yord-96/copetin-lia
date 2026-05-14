# Sistema de Prestamos y Alquileres (Web + React)

Aplicacion para un negocio que alquila vajilla, mesas, sillas, manteleria y decoracion.

## Funcionalidades actuales

- Dashboard operativo con metricas de ordenes, inventario, entregas e ingresos.
- Clientes (alta, edicion y metricas por historial de ordenes).
- Ordenes de servicio (modelo operativo via alquileres + proyeccion de servicio/lineas/pagos/penalidades).
- Inventario (items, movimientos, recuperaciones y ajustes).
- Transporte (entregas, vehiculos y choferes con validacion de disponibilidad por ventana horaria).
- Calendario (eventos manuales + eventos de entrega/mantenimiento/licencias).
- Reportes (catalogo y reportes generados).
- Usuarios (alta, edicion, estado y reenvio de invitaciones).
- Ajustes globales (empresa, regionalizacion y numeracion).
- Contabilidad (caja, cobros, garantias, saldos por cobrar y liquidaciones).
- Persistencia web en localStorage/base demo durante desarrollo.
- Backend Node/Express preparado para Render con persistencia transicional en Neon PostgreSQL.

## Arquitectura

### Vista (View)
- `src/` (React): interfaz de usuario.

### Datos y servicios
- `src/services/webBridge.js`: bridge web con persistencia local/demo.
- `src/services/api.js`: capa de acceso usada por la app.
- `src/hooks/useAppController.js`: orquestacion de vistas, permisos y operaciones.
- `server/`: API Node/Express para sincronizar estado en Neon durante la migracion a backend real.

## Ejecutar

```bash
npm install
npm run dev
```

`npm run dev` inicia el sistema en modo web (navegador).

Para probar el backend localmente necesitas `DATABASE_URL` en un archivo `.env`:

```bash
cp .env.example .env
npm run dev:server
```

## Scripts

- `npm run dev`: inicia en modo web con Vite.
- `npm run dev:web`: inicia en modo web con Vite.
- `npm run dev:server`: inicia la API Node con recarga en desarrollo.
- `npm run build`: compila la UI React.
- `npm run preview`: sirve el build localmente.
- `npm run server`: inicia la API Node para Render Web Service.

## Modos de ejecucion

- `Web local`: usa `localStorage` del navegador o base demo compartida en desarrollo.
- `Render + Neon`: si defines `VITE_API_URL`, el frontend sincroniza contra el backend Node y este persiste en Neon.

## Siguientes mejoras sugeridas

- Migrar persistencia transicional JSONB a tablas PostgreSQL normalizadas por modulo.
- Implementar permisos granulares por modulo/accion en runtime.
- Exportacion PDF/Excel de reportes por rango con filtros avanzados.
- Integraciones de notificacion (WhatsApp/Email) y recordatorios automaticos.
- App movil operativa para choferes/logistica.

## Documentacion adicional

- Esquema relacional PostgreSQL:
  - `docs/COPETIN_POSTGRESQL_SCHEMA.sql`
- Esquema transicional Neon:
  - `docs/NEON_APP_STATE_SCHEMA.sql`
- Mapa de modulos y relaciones:
  - `docs/COPETIN_MODULOS_Y_RELACIONES.md`
