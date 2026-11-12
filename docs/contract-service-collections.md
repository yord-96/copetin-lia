# Cobros de servicios incluidos y extras

El respaldo del 12/11/2026 muestra un solo ingreso TAXI de Bs 35 con RC-510 en el contrato 3027. La hoja flexible conserva una línea `extra` enlazada a ese recibo y una anotación `deposit` de Bs 35 sin caja propia. La asignación de recibos omitía las líneas `extra`, por lo que el depósito podía tomar prestado el mismo recibo por coincidencia de fecha, método e importe. Esto hacía que la ventana pareciera pagada mientras el listado excluía correctamente los extras del pago comercial.

El usuario confirmó que TAXI paga el servicio de transporte de Bs 35 ya incluido en el total de Bs 90. La corrección dirigida por IDs:

- Reclasifica el mismo ingreso RC-510 como pago comercial del servicio existente, conservando identificador, monto, fecha, método y código de recibo.
- Convierte su línea existente en el depósito respaldado por RC-510 y anula solamente la anotación duplicada identificada, conservando motivo e historial.
- Actualiza los saldos comerciales almacenados: Bs 90 pagados, saldo Bs 0. La garantía devuelta de Bs 195 se conserva.
- Guarda la clasificación anterior y una auditoría de la reparación.

`runConfirmedTaxi3027Repair` se ejecuta al iniciar el backend actualizado. Antes de escribir crea una copia en `backups` junto al archivo de estado. Solo actúa sobre los IDs y el recibo confirmados, con los importes esperados, y no se repite una vez aplicado. Si el saldo ha cambiado desde la confirmación, informa que requiere revisión.

Para cobros futuros, el formulario ofrece «Extra nuevo, fuera del total del contrato» y los servicios ya incluidos. Un pago de servicio reduce el saldo comercial; un extra independiente queda separado. El servidor valida pertenencia del servicio y saldo, y confirma caja y una sola línea de historial en la misma transacción. El formulario conserva su identificador al reintentar y no necesita un segundo guardado del cuaderno.

Los recibos de extras y daños conservan sus enlaces y no confirman simultáneamente un depósito. Los extras pagados muestran su recibo; una anotación sin respaldo se identifica como «Anotado sin recibo».

Verificación: copia del respaldo real de 3027, prueba de reparación con respaldo y reinicio, solicitudes de cobro concurrentes y repetidas, rechazo de servicio ajeno o ya pagado, conservación de extras independientes y prueba del formulario en Chromium.
