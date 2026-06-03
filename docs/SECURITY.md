# Seguridad

## Estado actual

El sistema usa login interno desde `src/services/webBridge.js`.

- Los usuarios viven dentro del estado JSON.
- El hash actual se guarda en `user.passwordHash`.
- La sesión del navegador usa `localStorage` con la clave `prestamos-auth-session-v1`.
- El backend de producción protege mínimamente `GET/PUT /__copetin_db` con `X-App-Internal-Key`.

## Clave interna de estado

Variables:

```env
APP_INTERNAL_KEY=clave-larga-y-segura
VITE_APP_INTERNAL_KEY=misma-clave-larga-y-segura
```

Header usado:

```http
X-App-Internal-Key: clave-larga-y-segura
```

Importante: esta protección es mínima. Como `VITE_APP_INTERNAL_KEY` queda dentro del bundle frontend, no reemplaza autenticación real de servidor. Sirve para evitar llamadas accidentales o externas simples al endpoint de estado, pero no debe considerarse seguridad definitiva.

## Reset general

Variable:

```env
RESET_SECURITY_CODE=valor-seguro
```

No debe quedar hardcodeado en el código fuente. Usa un valor largo y no obvio.

## Medidas ya aplicadas en Express

- `helmet` para headers HTTP de seguridad.
- `express-rate-limit` global.
- Rate limit adicional para `/__copetin_db`.
- CORS desde `CORS_ORIGIN`.
- `JSON_LIMIT` configurable.
- Errores sin stack trace ni detalles internos en `NODE_ENV=production`.

## Control de concurrencia del estado JSON

`GET /__copetin_db` devuelve el estado completo junto con su `revision` actual.
`PUT /__copetin_db` exige enviar `{ state, revision }`. Si esa `revision` no coincide con la revision actual del archivo, el backend responde `409 Conflict` y no reemplaza `app-state.json`.

Mensaje esperado para el operador:

```text
Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.
```

## Base inicial limpia

El estado inicial definido en `src/services/webBridge.js` no carga clientes, inventario, vehiculos, choferes, ordenes, calendario ni movimientos de ejemplo. Si `app-state.json` no existe, el sistema arranca con configuracion base y solo un usuario `super_admin` de bootstrap.

El usuario bootstrap no tiene una contrasena conocida hardcodeada. En una base nueva, el primer ingreso de `admin` define la contrasena inicial si tiene al menos 8 caracteres; luego se guarda como hash y el login vuelve al flujo normal.

## Recomendaciones antes de datos sensibles reales

1. No exponer el puerto `4000`.
   - Solo Nginx debe recibir tráfico público.

2. Usar HTTPS cuando tengas dominio.
   - Con Certbot o SSL del proveedor.

3. Mover autenticación al backend.
   - Login `/api/auth/login`.
   - Cookie `HttpOnly`, `Secure`, `SameSite=Lax` o `Strict`.
   - Middleware de sesión antes de permitir leer/escribir datos.

4. Migrar contraseñas a `bcrypt` o `argon2`.
   - El hash actual tipo `fnv1a:*` es débil y solo sirve para entorno local o transitorio.
   - Plan compatible:
     - Al hacer login, si el usuario tiene hash `fnv1a:*` y la contraseña coincide, rehashear con bcrypt/argon2.
     - Guardar `passwordHash` nuevo.
     - Después de un periodo de transición, rechazar hashes antiguos.

5. No enviar `passwordHash` al frontend.
   - Hoy el estado completo contiene `users`.
   - En una API real, `users.list` debe devolver usuarios sanitizados.

6. Agregar auditoría de servidor.
   - IP.
   - Usuario.
   - Acción.
   - Fecha.
   - Resultado.

7. Agregar control de concurrencia.
   - Requerir `revision` al hacer `PUT /__copetin_db`.
   - Rechazar si el cliente intenta sobrescribir una revisión vieja.

8. Migrar a PostgreSQL cuando el flujo de negocio esté estable.
   - Usar `docs/COPETIN_POSTGRESQL_SCHEMA.sql` como base.
   - Mantener `legacy_id` para migrar desde JSON.
