# Devolución de garantía: contrato 3026

En el respaldo del 11/11/2026, el contrato totaliza Bs 2.514,40. Los recibos RC-14678 a RC-14681 cubren ese servicio y una garantía separada de Bs 582,60. RC-14682 corresponde a Bs 20 de daños cobrados por separado.

Se reprodujeron dos bloqueos consecutivos sobre una copia aislada:

1. La devolución informaba deuda de Bs 285,60. El recibo RC-14679 existía en Caja Grande como `cobro_saldo_devolucion`, pero su depósito en la hoja flexible no conservaba `cashMovementId` ni código de recibo. La conciliación solo infería/agregaba tres tipos de pago y omitía los cobros al devolver material. Ahora reconoce también ese tipo, reservando primero el enlace determinista `contract-deposit:<contractId>:<ledgerEntryId>`. La inferencia histórica mantiene fecha, monto, método y cuenta. Los recibos de daños, garantía, extras o anulados permanecen separados.
2. Una vez reconocido el pago, el servidor solo permitía devolver Bs 562,60. Sumaba toda línea `charge` como garantía consumida, aunque los Bs 20 ya estuvieran cobrados con un recibo independiente. Ahora usa `getGuaranteeLedgerEvidence`, igual que el resto de los cálculos de garantía, que distingue ese cobro de una aplicación de garantía.

No se agregan pagos ni se modifica el respaldo. La conciliación interpreta los recibos existentes; no hace falta volver a cobrar o ingresar RC-14679. La devolución debe ejecutarse normalmente por el usuario después del despliegue.

## Validación

- Pruebas de pago al devolver material con enlace por operación, enlace histórico y recibo sin anotación de depósito.
- Un recibo anulado o un pago de daños no salda deuda comercial.
- Una edición de fecha/monto de recibo mantiene su identidad y usa el monto corregido.
- Prueba HTTP con las condiciones de 3026: dos solicitudes simultáneas generan un solo egreso de Bs 582,60 y una sola línea de devolución; conserva los cinco ingresos originales y rechaza otra devolución.
- Reproducción con el contrato, alquiler y recibos extraídos del respaldo: devolución completa aceptada, garantía aplicada Bs 0, sin duplicar ingreso, egreso ni recibo al reintentar.
- Revisión de los 366 contratos con depósitos sin enlace en el respaldo: la conciliación cambia el saldo en 1300, 3026 y 3054. Este examen detecta el patrón; no ejecuta devoluciones ni modifica sus datos.

Los cambios se aplican a todos los contratos que usan estas funciones compartidas, sin excepciones por número de contrato. Se conservan las validaciones de devolución del material, deuda comercial, garantía efectivamente recibida y límite contra devoluciones duplicadas.
