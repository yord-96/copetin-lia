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
- Persistencia web con estado local en desarrollo y sincronizacion en servidor para despliegue.
- Backend Node/Express preparado para VPS/cPanel con persistencia inicial en archivo del servidor.

## Arquitectura

### Vista (View)
- `src/` (React): interfaz de usuario.

### Datos y servicios
- `src/services/webBridge.js`: bridge web con persistencia local del navegador.
- `src/services/api.js`: capa de acceso usada por la app.
- `src/hooks/useAppController.js`: orquestacion de vistas, permisos y operaciones.
- `server/`: API Node/Express para sincronizar estado desde el servidor.

## Ejecutar

```bash
npm install
npm run dev
```

`npm run dev` inicia el sistema en modo web (navegador).

Para probar el backend localmente puedes crear un archivo `.env` desde `.env.example`:

```bash
cp .env.example .env
npm run dev:server
```

## Scripts

### Portal de eventos de Lincoln

- En el espacio Lincoln, abre **Portal de eventos**. Un usuario `developer`, `super_admin` o `admin` con acceso a Lincoln debe ingresar con su contraseña para administrar el portal.
- Selecciona un contrato, crea el usuario y contraseña del cliente y comparte el enlace `/lincoln/mi-evento`. Cada acceso queda vinculado a un único evento. Puedes revocarlo o cambiar su contraseña; ambas acciones invalidan sus sesiones anteriores.
- El cliente y Lincoln comparten actividades, revisión de proveedores, especificaciones, protocolo, invitados, proveedores y notas. La ficha toma la estructura del Excel de referencia, sin cargar sus datos personales en otros eventos.
- El croquis permite agregar y mover figuras de mesas, sillas, escenario, pista, barra, entrada y mesa dulce; cambiar tamaño, rotación, etiquetas y plazas; duplicar, eliminar y descargar SVG. Las unidades son orientativas, no medidas reales del salón.
- Pulsa **Guardar cambios** para guardar ficha y croquis. Si otra persona guardó antes, se debe recargar la ficha para evitar sobrescribirla.
- Los datos se guardan en `LINCOLN_PORTAL_FILE` (por defecto `data/lincoln-portal.json`), separado de la caja y los contratos. Incluye este archivo en las copias de seguridad. Las contraseñas de clientes usan bcrypt y las sesiones expiran a las ocho horas.
- Para desarrollo, inicia Vite y `npm run dev:server` (puerto 4000). Vite redirige las rutas de Lincoln al backend. Si usas `VITE_API_URL`, se usa ese servidor.
- El frontend del portal usa `/__lincoln_db/portal`, aprovechando la ruta de Lincoln ya enviada al backend por Nginx. El backend también acepta `/api/lincoln-portal` para compatibilidad. El ingreso del cliente usa la autenticación del portal y no requiere la clave interna del sistema.
- Verificación: `node --test server/services/lincoln/lincolnPortal.test.js`. Prueba de navegador aislada: `npm run build` y `node scripts/verify-lincoln-portal.mjs` (requiere Chrome; ruta configurable con `CHROME_PATH`).

El portal incorpora autenticación propia. Las APIs internas previas del sistema mantienen su mecanismo de clave interna; este cambio no moderniza su autenticación. Revisa esa protección antes de habilitar el acceso público en producción.

- `npm run dev`: inicia en modo web con Vite.
- `npm run dev:web`: inicia en modo web con Vite.
- `npm run dev:server`: inicia la API Node con recarga en desarrollo.
- `npm run build`: compila la UI React.
- `npm run preview`: sirve el build localmente.
- `npm run server`: inicia la API Node para VPS/cPanel o servidor propio.

## Modos de ejecucion

- `Web local`: usa `localStorage` del navegador para pruebas sin servidor.
- `VPS/cPanel`: si defines `VITE_API_URL`, el frontend sincroniza contra el backend Node desplegado en el servidor.

## Siguientes mejoras sugeridas

- Migrar persistencia inicial en archivo a una base de datos del VPS si el volumen de datos crece.
- Implementar permisos granulares por modulo/accion en runtime.
- Exportacion PDF/Excel de reportes por rango con filtros avanzados.
- Integraciones de notificacion (WhatsApp/Email) y recordatorios automaticos.
- App movil operativa para choferes/logistica.

## Documentacion adicional

### Diagnóstico de apertura de Órdenes

Desde la carpeta del proyecto en el VPS, `node scripts/diagnose-orders-server.mjs` consulta el backend local y muestra el tiempo de Órdenes y de una solicitud de salud concurrente. Lee la clave interna desde `.env` sin imprimirla. Las consultas no modifican los datos.

La ruta de Órdenes informa `Server-Timing` y registra `[orders-overview]` con los tiempos de lectura del estado, índice de caja, resúmenes de contratos y demás listas. El índice conserva las reglas económicas existentes y evita recorrer toda la caja dos veces por cada contrato. La preparación de contratos cede ejecución cada 50 registros para atender otras solicitudes.

Para comparar localmente con una copia de datos: `node scripts/benchmark-orders-overview.mjs ruta/al/estado.json`. El benchmark usa una copia temporal, informa el tamaño y SHA-256 de la respuesta para verificar equivalencia, y elimina su copia al terminar. El proceso de prueba comparte el bucle de eventos del servidor; `timerDelayMs` muestra cuánto se retrasó su temporizador, mientras que el diagnóstico del VPS se ejecuta en un proceso separado.

- Esquema relacional PostgreSQL:
  - `docs/COPETIN_POSTGRESQL_SCHEMA.sql`
- Mapa de modulos y relaciones:
  - `docs/COPETIN_MODULOS_Y_RELACIONES.md`
