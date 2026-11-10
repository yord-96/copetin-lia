# Asistencia concurrente

La revisión no encontró un máximo de 3 o 4 sesiones en el código. Sin un registro de red del incidente actual o acceso al VPS, no se puede atribuir su mensaje exacto a un único componente. Se corrigieron los siguientes problemas comprobables del recorrido de acceso y marcación:

- Las consultas de usuarios para iniciar sesión y las solicitudes de asistencia compartían presupuestos por IP con otros módulos. Ahora acceso y asistencia tienen presupuestos independientes; presencia conserva el suyo. No se usan identificadores enviados por el cliente para eludir límites.
- Cada marca clonaba la base comercial completa, reconstruía su orden de caja y volvía a escribir todo el archivo dentro de una cola global. Ahora las operaciones de asistencia cercanas se agrupan durante 20 ms, clonan solo usuarios/asistencias y se confirman juntas después de persistir. Comparten el bloqueo de escritura con los demás módulos, conservando sus cambios.
- Un fallo de una persona se aísla del resto de la tanda. Los reintentos ya confirmados no reescriben la base. Las revisiones avanzan al confirmar una tanda, conservando el control de concurrencia de los demás guardados.
- El formulario generaba nuevas identidades de operación en cada reintento; un grupo parcial podía duplicarse. Ahora conserva identidades por participante y la evidencia ya subida, espera todas las respuestas y permite reintentar sin duplicar. El grupo se envía concurrentemente.
- Registro, usuarios, reporte y foto tenían solicitudes sin plazo máximo. Ahora usan el plazo de 20 segundos, incluida la lectura de la respuesta. Un corte no se muestra como éxito; se conserva la misma operación para comprobarla al reintentar.
- Consultas de acceso, asistencia y metadatos evitan reconstruir el libro de caja.

## Verificación

- `node --test server/middleware/requestLimits.test.js`: desde una misma IP, saturar inventario o presencia no bloquea acceso, asistencia o evidencia. Se mantienen respuestas 429 para los presupuestos agotados.
- `node --test server/routes/attendanceConcurrency.test.js`: 24 consultas de usuarios para acceso y 24 marcas concurrentes, 24 subidas de evidencia, cuatro compras de inventario, presencia y metadatos. Comprueba códigos únicos, persistencia, reintentos, rechazo aislado y conservación de contratos/stock. Una tanda directa de 24 marcas requiere una revisión/guardado, no 24.
- `ATTENDANCE_TEST_PAYLOAD_MB=120 node --test server/routes/attendanceConcurrency.test.js`: misma prueba con 120 MB sintéticos de datos comerciales. En la ejecución local del 10/11/2026, la carga HTTP concurrente terminó en 7,4 segundos. Es una referencia local, no una medición de producción ni una garantía de latencia.
- Pruebas de permisos, administración, filtros y análisis de asistencia; prueba de cliente con respuesta interrumpida y reintento; compilación y ESLint.
- Verificación del formulario en Chromium con 20 participantes: se interrumpe una respuesta después del guardado, se reintenta y quedan 20 identidades de marca, no 40.

## Aplicación y límites

Requiere actualizar y reiniciar el backend, además de compilar el frontend. Los nuevos valores predeterminados por IP son 1200 solicitudes/minuto para asistencia y 600 para consultas de usuarios de acceso. Pueden configurarse con `ATTENDANCE_RATE_LIMIT_MAX` y `ACCESS_RATE_LIMIT_MAX`; los otros límites existentes se conservan.

Se conserva el despliegue de **una instancia** definido en `ecosystem.config.cjs`. La cola protege el archivo JSON dentro de ese proceso; aumentar instancias de PM2 requiere almacenamiento transaccional compartido. No se modifican registros reales durante las pruebas. Si persiste un bloqueo tras desplegar, revisar respuesta HTTP y logs del mismo instante, incluidos proxy y cualquier límite externo al repositorio.
