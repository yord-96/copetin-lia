# Revision general de pagos historicos

El script `scripts/review-all-contract-payments.mjs` revisa todos los contratos vigentes. Detecta referencias a recibos anulados o faltantes y pagos con monto cero que apuntan a recibos positivos. No supone que dos pagos iguales sean duplicados.

Solo restaura originales cuando la anulacion documenta duplicacion del mismo contrato, los recibos pertenecen al contrato y no estan referenciados por otro, y los montos de contrato y garantia coinciden exactamente con los recibos automaticos vigentes. Simula cada cambio y comprueba que conserve el saldo confirmado. Los demas casos quedan en el informe sin modificar.

La reparacion conserva los recibos originales y sus fechas, anula sus reemplazos automaticos, recupera el monto del deposito y deja auditoria. No crea dinero nuevo ni modifica devoluciones. Cada ejecucion genera un informe JSON con contratos reparables y motivos de revision. La aplicacion crea respaldo y usa control de revision para evitar sobrescribir cambios concurrentes.

Primero revisar en el VPS:

```bash
cd /var/www/prestamos-app/app &&
git pull --ff-only origin main &&
node scripts/review-all-contract-payments.mjs
```

Aplicar y reiniciar, conservando el reinicio incluso si falla la reparacion:

```bash
pm2 stop prestamos-app
node scripts/review-all-contract-payments.mjs --apply
pm2 restart prestamos-app
```

El respaldo analizado del 12/10/2026 contiene 1665 contratos, de los cuales 1604 estan vigentes. La simulacion identifica 271 reparables y 199 que requieren revision individual. Estas cantidades pueden cambiar en el VPS si sus datos han cambiado. Los restantes no presentan estos patrones; esto no certifica que todo pago historico sea correcto.
