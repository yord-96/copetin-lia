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
