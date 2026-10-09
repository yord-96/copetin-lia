# Corrección de pagos al editar contratos

Editar cantidades, precios o datos comerciales de un contrato aprobado conserva sus pagos, prepagos e historial económico. El wizard no reenvía campos de pago ocultos. Se elimina la reconstrucción de cobros iniciales y garantías durante la normalización y la limpieza heurística que modificaba depósitos o anulaba recibos al superar el total comercial.

Los movimientos de garantía explícitos del wizard se conservan. El alta/aprobación original mantiene su flujo de pago inicial. Los cambios económicos posteriores se realizan mediante las operaciones del sector económico.

## Auditoría de solo lectura

Desde la carpeta del proyecto:

```bash
node scripts/audit-contract-payments.mjs /ruta/al/respaldo.json data/auditoria-pagos
```

Acepta un respaldo exportado (`state`) o un estado JSON directo. Genera JSON y CSV; no modifica el respaldo ni la base en ejecución. La salida predeterminada queda en `data/`, excluida de Git para mantener los datos de clientes fuera del repositorio.

- `ledger_receipt_mismatch`: diferencia comprobada entre una fila de depósito y su recibo vigente enlazado. No demuestra por sí sola cuál de los dos importes debe corregirse.
- `automatic_payment_with_separate_deposits`: cobro inicial automático y otros depósitos con recibos distintos. Requiere revisar su origen; la coincidencia exacta de importe y fecha de edición aumenta la evidencia, pero no autoriza una anulación masiva.

El respaldo del 8 de octubre de 2026 tiene 1.553 contratos activos: 113 señalados, 102 con diferencias de importe y 14 con cobros automáticos para revisión. Tres pertenecen a ambos grupos. El informe completo se conserva localmente, fuera de Git.

## Actualización del VPS

Desde la carpeta del repositorio, comprobar primero que no existan cambios locales que deban conservarse. Usar el respaldo habitual antes de actualizar. Para actualizar código y compilación:

```bash
git pull --ff-only origin main
npm ci
npm run build
pm2 restart prestamos-app --update-env
```

Reiniciar el servidor es necesario porque `webBridge.js` también se ejecuta en el backend. Refrescar las sesiones abiertas del navegador para cargar el nuevo wizard.

Después, ejecutar la auditoría sobre un respaldo recién exportado del VPS y revisar los recibos señalados. Actualizar el código detiene la falla; no repara ni anula automáticamente movimientos históricos. No importar el respaldo antiguo sobre la base actual.

## Validación

- Regresión: aumentos y reducciones de cantidades, valores ocultos de pago obsoletos, historial reenviado, excedente legítimo y normalización sin reconstrucción de pagos.
- Prueba del auditor: enlaces al mismo recibo, recibos distintos, importes inconsistentes, recibos eliminados y contratos ajenos.
- Compilación de producción correcta.
- Suite general: 135 de 137 pruebas pasan. Las dos pruebas de `webBridge.contract-day-totals.test.js` también fallan sobre la versión anterior de `main`; verifican textos/estructura del PDF que ya no coinciden. No se modificaron esas expectativas en esta corrección.

## Reparación puntual del contrato 1179

La comparación de los respaldos de las 13:35 y 13:53 UTC confirma que los registros del contrato 1179 no cambiaron: el cobro automático RC-13629 y el primer depósito alterado ya existían el 7 de octubre. La actualización del código no repara esos registros históricos.

Se incorpora `scripts/repair-contract-1179.mjs`. Por defecto solo simula. Verifica contrato, importes, recibos y garantía contra el caso diagnosticado. Si detecta pagos nuevos o cambios inesperados, aborta antes de modificar datos. Con `--apply` crea una copia completa en `backups/`, usa la revisión vigente y la escritura atómica del almacenamiento del servidor. Anula RC-13629 conservando su registro y motivo; restaura RC-13559 a Bs 5.000,00 y actualiza los resúmenes del contrato y orden. Añade trazabilidad y una segunda ejecución no vuelve a aplicar cambios.

Desde la carpeta del VPS, con el código actualizado, ejecutar primero:

```bash
node scripts/repair-contract-1179.mjs
```

El resultado esperado muestra `pendingBs: 3262.5`. Para aplicarlo, detener el servidor para que otra sesión no escriba durante la reparación y reiniciarlo después para descartar su caché:

```bash
pm2 stop prestamos-app
node scripts/repair-contract-1179.mjs --apply
pm2 restart prestamos-app
```

Si la reparación rechaza los datos, reiniciar igualmente el servicio y revisar la salida antes de cambiar nada más. El script carga `.env` y respeta `APP_STATE_FILE`. No importa el respaldo local sobre el VPS. Esta reparación afecta solo el contrato 1179; los otros contratos señalados requieren revisión individual.

## Reporte diario 2808 y cobro de daños 2404

- Una fecha de recibo editada explícitamente (`receiptEditedAt` o `editedAt`) tiene prioridad sobre una `cashEffectiveDate` histórica desactualizada al calcular el día comercial. La secuencia y hora de registro permanecen intactas. Así RC-1701 se incluye el 1 de octubre, aunque se registró el 8. El cambio se aplica al leer el reporte; no requiere crear otra devolución ni resetear el contrato.
- El límite de cobro de daños excluye movimientos eliminados y anulados. El antiguo RC-422 eliminado ya no bloquea el cobro vigente de Bs 164 en el contrato 2404.
- General envía el desglose de alquiler, transporte y daños. El servidor también reconoce el caso de clientes anteriores que envían General cuando solo quedan daños. Ese importe se registra como daños, no aumenta el pago del alquiler, y un segundo cobro queda rechazado.
- Validación: prueba HTTP del reporte y cobro, prueba con el respaldo real en almacenamiento aislado, 13 pruebas relacionadas correctas, ESLint correcto y compilación de producción correcta. Suite general: 137/139 pasan; se mantienen los dos fallos de PDF anteriores documentados arriba.

Actualizar frontend y backend con `git pull --ff-only origin main`, `npm run build` y `pm2 restart prestamos-app`. Recargar el navegador y generar nuevamente el reporte diario. No se registraron pagos reales durante estas comprobaciones.


## Recibo duplicado hist?rico del contrato 2863

El respaldo de 2026-10-08T13:53:29Z confirma un ?nico dep?sito real de Bs 235: RC-13498, QR Mercantil, con fecha de recibo del 1 de octubre. RC-13519 se cre? el 2 de octubre a las 10:26:58 (Bolivia), exactamente al guardar el aumento de manteles de 15 a 16 y caminitos de 10 a 11. Tiene la marca initial_rental_payment, m?todo efectivo y nota de pago inicial generado desde el contrato. No tiene un dep?sito econ?mico adicional que lo respalde.

La prevenci?n ya est? en main desde 3c9f41c: editar cantidades no reconstruye cobros iniciales ni modifica dep?sitos. Se a?ade una regresi?n espec?fica con orden vinculada y dep?sito QR de Bs 235; aumentos, reducciones y guardados repetidos conservan el ?nico recibo.

El script scripts/repair-contract-2863.mjs conserva ?ntegros RC-13498, su fecha, el historial econ?mico y los res?menes de pagos (que ya contaban Bs 235 una sola vez). Anula ?nicamente RC-13519, deja motivo y auditor?a, y crea una copia completa antes de aplicar. Comprueba los identificadores, importes, m?todos, fecha, historial de edici?n y que no haya nuevos recibos vinculados. Si la base actual cambi?, aborta antes de modificarla. Es idempotente. No se borran registros ni se ocultan cobros por coincidencia de importe.

En el VPS, desde /var/www/prestamos-app/app, actualizar main y simular:

    git pull --ff-only origin main
    node scripts/repair-contract-2863.mjs

Resultado esperado: preservedReceipt RC-13498, voidedReceipt RC-13519, removedDuplicateBs 235. Para aplicar, detener el servicio, ejecutar el script y reiniciar aunque el script rechace los datos:

    pm2 stop prestamos-app && node scripts/repair-contract-2863.mjs --apply
    pm2 restart prestamos-app

El ingreso del 2 de octubre baja Bs 235 y los fondos efectivos posteriores se recalculan con el recibo anulado. El reporte del 1 de octubre se conserva. Recargar el navegador y generar nuevamente los reportes. El script de reparaci?n no requiere recompilar frontend.


## Sincronizacion de fechas del cuaderno y Caja Grande (2430)

El deposito RC-12637 de Bs 100 del contrato 2430 esta fechado el 5 de septiembre. La logica antigua lo anulo y genero RC-12787 (servicio Bs 50) y RC-12788 (garantia Bs 50) con fecha del 7. Editar la linea economica solo encontraba el recibo anulado.

La sincronizacion compartida sigue enlaces explicitos de recibos (id/codigo y replacementOfMovementId/replacedByMovementId), dentro del contrato. Actualiza fecha de recibo, fecha efectiva de caja y comprobantes generados de los movimientos vigentes. Conserva importes y secuencia. Se ejecuta al enviar una fecha nueva o distinta, tanto en mutaciones como en guardado completo del historial, sin cambiar fechas por normalizacion de filas incompletas. No enlaza recibos por semejanza de importes.

scripts/repair-contract-2430.mjs verifica el caso historico, agrega los enlaces de sustitucion y cambia ambos ingresos al 5 de septiembre. No reactiva el recibo original ni altera pagos, garantia o devoluciones. Simula por defecto; --apply crea respaldo y guarda con control de revision. Aborta si cambiaron los datos verificados. Es idempotente.

Actualizar codigo, compilar y reiniciar. Luego simular con node scripts/repair-contract-2430.mjs. Para aplicar:

    pm2 stop prestamos-app && node scripts/repair-contract-2430.mjs --apply
    pm2 restart prestamos-app

Recargar sesiones y generar nuevamente los reportes del 5 y 7 de septiembre. Las pruebas cubren recibos sustitutos, comprobantes, codigo de recibo, operaciones locales, ausencia de cambios en importes/devoluciones, bloqueo ante evidencia distinta e idempotencia. Compilacion y ESLint correctos.
