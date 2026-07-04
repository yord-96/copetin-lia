# Migracion de autenticacion

El sistema heredado usa sesion de navegador y `VITE_APP_INTERNAL_KEY` para proteger endpoints internos. Esa clave queda expuesta en el bundle y no debe considerarse autenticacion real.

## Objetivo

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/auth/switch-company`

La sesion final debe usar cookie `HttpOnly`, `SameSite=Lax` o `Strict`, `Secure` configurable y sesion revocable en PostgreSQL.

## Passwords heredadas

El JSON actual contiene `passwordHash`, no se imprime en reportes. Algunos hashes usan formato heredado (`fnv1a:*`). La fase de auth debe aceptar temporalmente el hash heredado y rehashear con bcrypt/argon2 al siguiente login valido.

No guardar texto plano.
