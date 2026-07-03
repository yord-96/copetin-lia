# Notas de seguridad pendientes

`VITE_APP_INTERNAL_KEY` se compila dentro del bundle del navegador. Sirve como barrera operativa minima para endpoints internos, pero no reemplaza autenticacion real backend.

No se deben registrar claves en logs ni incluir valores reales en commits. `.env.example` contiene solo valores ficticios.

Fase posterior recomendada: sustituir la clave publica del frontend por sesiones/tokens emitidos y validados en backend, con permisos por usuario y expiracion controlada.
