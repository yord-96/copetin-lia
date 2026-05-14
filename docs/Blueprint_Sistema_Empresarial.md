# Blueprint Sistema Empresarial de Alquileres

## 1. Vision del sistema
Pasar de un sistema administrativo a una plataforma empresarial orientada a tres ejes:
- `Comercial`: CRM, cotizaciones, seguimiento y conversion a orden.
- `Operacion`: inventario, preparacion, transporte, entrega, retorno y cierre.
- `Finanzas`: facturacion, caja, cuentas por cobrar, costos y rentabilidad.

## 2. Modulos empresariales (version completa)
## 2.1 CRM y Clientes
- Ficha 360 del cliente: contacto, historial de eventos, preferencias, credit score interno.
- Pipeline comercial: lead, oportunidad, cotizacion, negociacion, ganado/perdido.
- Segmentacion: corporativo, social, wedding planner, recurrente.
- Tareas y recordatorios por asesor.
- SLA de respuesta comercial.

## 2.2 Cotizaciones y Presupuestos
- Constructor de cotizacion por paquetes y por item.
- Reglas de precios: temporada, volumen, cliente VIP, urgencia.
- Versionado y aprobaciones.
- Envio por email/WhatsApp con link de aprobacion.
- Conversion 1 clic a `Orden de Servicio`.

## 2.3 Ordenes de Servicio (core operativo)
- Estados: `Borrador -> Confirmada -> En Preparacion -> Cargada -> En Ruta -> Entregada -> En Retorno -> Cerrada`.
- Datos clave: fecha/hora de salida, entrega, retiro, direccion, contacto en sitio.
- Checklist operativo por orden.
- Trazabilidad por responsable y hora.

## 2.4 Inventario y Almacen
- Stock disponible, comprometido, en ruta, en lavado, en reparacion y fuera de servicio.
- Reservas por fecha para evitar sobreventa.
- Preparacion por picking list (kit por orden).
- Control de danios y faltantes con evidencia fotografica.
- Kardex y auditoria de movimientos.

## 2.5 Transporte y Ruteo
- Planificador de rutas por ventana horaria.
- Asignacion de vehiculo, chofer y ayudantes.
- Hoja de ruta digital (orden de carga/descarga).
- Estado en tiempo real: pendiente, en camino, entregado, retirado.
- KPI logistico: puntualidad, costo por ruta, km por orden.

## 2.6 Calendario Operativo
- Vista dia/semana/mes por ordenes.
- Capacidad por franja horaria (almacen, carga, transporte).
- Alertas de conflictos de agenda y doble reserva.
- Vista por area: comercial, almacen, transporte.

## 2.7 Finanzas y Control
- Caja diaria (apertura/cierre).
- Facturacion y recibos.
- Cuentas por cobrar (saldo por cliente, aging).
- Penalidades y devoluciones.
- Conciliacion caja vs movimientos reales.

## 2.8 Costos y Rentabilidad
- Costo por orden: personal, transporte, reposicion, limpieza, mantenimiento.
- Margen bruto por orden/cliente/categoria.
- Analitica de clientes rentables y no rentables.

## 2.9 Reportes y BI
- Dashboard ejecutivo (ventas, ocupacion, puntualidad, morosidad).
- Reportes operativos por fecha, cliente, estado, ruta, item.
- Exportables PDF/Excel y envio programado.

## 2.10 Usuarios, Roles y Seguridad
- Roles base: `Admin`, `Comercial`, `Almacen`, `Transporte`, `Finanzas`, `Gerencia`.
- Permisos granulares por accion (ver, crear, aprobar, anular, imprimir).
- Bitacora de auditoria completa.
- 2FA para perfiles sensibles.

## 2.11 Configuracion y Parametros
- Catalogo maestro de items/categorias.
- Politicas comerciales (garantia, mora, penalidad, descuentos).
- Horarios operativos.
- Plantillas de documentos.

## 3. Flujo end-to-end recomendado
1. `Lead` entra al CRM.
2. Comercial arma cotizacion y negocia.
3. Cliente aprueba, sistema crea `Orden de Servicio`.
4. Inventario reserva stock para fecha/hora.
5. Almacen prepara pedido con checklist.
6. Transporte recibe ruta y ventana de entrega.
7. Entrega en evento + confirmacion digital.
8. Retorno + inspeccion de estado.
9. Cierre financiero (saldo, penalidad, reembolso).
10. Postventa y nueva oportunidad en CRM.

## 4. Entidades de datos que no pueden faltar
- `Cliente`
- `Lead/Oportunidad`
- `Cotizacion`
- `OrdenServicio`
- `OrdenItem`
- `ReservaInventario`
- `MovimientoInventario`
- `RutaTransporte`
- `EntregaRetiro`
- `Factura/Recibo`
- `MovimientoCaja`
- `CostoOrden`
- `Usuario/Rol/Permiso`
- `BitacoraAuditoria`

## 5. KPI empresariales sugeridos
- Tasa de conversion de cotizacion a orden.
- Fill rate de inventario comprometido.
- Puntualidad de entrega y retiro.
- % de ordenes con incidencias.
- Margen promedio por orden.
- DSO (dias promedio de cobro).
- Tasa de recompra por cliente.

## 6. Roadmap recomendado
1. `Fase 1 (Base Operativa)`: CRM basico, cotizacion, ordenes, inventario reservado.
2. `Fase 2 (Logistica)`: transporte, rutas, calendario, checklist digital.
3. `Fase 3 (Finanzas)`: facturacion, CxC, costos y rentabilidad.
4. `Fase 4 (BI y Automatizacion)`: dashboards avanzados, alertas, integraciones.
5. `Fase 5 (Escala)`: multi-sucursal, app movil operativa y portal cliente.

## 7. Integraciones de alto impacto
- WhatsApp Business API (envio de cotizaciones y recordatorios).
- Email transaccional.
- Maps (rutas y ETA).
- Firma digital simple para entrega/recepcion.
- Contabilidad/ERP (opcional en fase avanzada).

## 8. Definicion de exito del sistema empresarial
- Cero sobre-reserva por fecha.
- Trazabilidad completa comercial-operacion-finanzas.
- Orden cerrada en tiempo y con margen visible.
- Cliente con historial utilizable para recompra.
