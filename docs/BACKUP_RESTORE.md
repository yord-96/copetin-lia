# Backups y restauración

La persistencia actual de producción es un archivo JSON definido por `APP_STATE_FILE`.

Ejemplo recomendado:

```env
APP_STATE_FILE=/var/www/prestamos-app/data/app-state.json
BACKUP_DIR=/var/www/prestamos-app/backups
```

## Backup manual

Desde la carpeta del proyecto:

```bash
cd /var/www/prestamos-app/app
npm run backup
```

Esto crea un archivo:

```text
/var/www/prestamos-app/backups/app-state-YYYY-MM-DD-HH-mm-ss.json
```

Backup comprimido:

```bash
npm run backup -- --gzip
```

El script no borra backups anteriores.

## Restaurar manualmente con script

1. Detener PM2:

```bash
pm2 stop prestamos-app
```

2. Restaurar:

```bash
cd /var/www/prestamos-app/app
npm run restore -- app-state-YYYY-MM-DD-HH-mm-ss.json
```

El script crea primero un backup `pre-restore-...json` del estado actual.

3. Reiniciar PM2:

```bash
pm2 restart prestamos-app
```

## Restaurar manualmente sin script

```bash
pm2 stop prestamos-app
cp /var/www/prestamos-app/data/app-state.json \
  /var/www/prestamos-app/backups/pre-restore-$(date +%F-%H-%M-%S).json
cp /var/www/prestamos-app/backups/app-state-YYYY-MM-DD-HH-mm-ss.json \
  /var/www/prestamos-app/data/app-state.json
pm2 restart prestamos-app
```

## Descargar backup a tu computadora

```bash
scp usuario@2.24.108.161:/var/www/prestamos-app/backups/app-state-YYYY-MM-DD-HH-mm-ss.json .
```

## Cuándo hacer backup

- Antes de `git pull`.
- Antes de `npm ci`.
- Antes de `npm run build`.
- Antes de reset general.
- Antes de cambios grandes de inventario, caja o contratos.
- Al cierre del día.
