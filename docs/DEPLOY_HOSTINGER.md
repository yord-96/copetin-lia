# Deploy en Hostinger VPS Ubuntu 24.04

Objetivo: correr `prestamos-app` como monolito Node/Express. Express sirve `dist/` y persiste en un archivo JSON.

## 1. Preparar servidor

```bash
sudo apt update
sudo apt install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Clonar proyecto

```bash
sudo mkdir -p /var/www/prestamos-app
sudo chown -R $USER:$USER /var/www/prestamos-app
git clone TU_REPO_GIT /var/www/prestamos-app/app
cd /var/www/prestamos-app/app
```

## 3. Crear carpetas persistentes

```bash
mkdir -p /var/www/prestamos-app/data
mkdir -p /var/www/prestamos-app/backups
mkdir -p /var/www/prestamos-app/app/logs
```

## 4. Crear `.env`

```bash
cp .env.example .env
nano .env
```

Ejemplo inicial por IP:

```env
NODE_ENV=production
PORT=4000
CORS_ORIGIN=http://2.24.108.161
JSON_LIMIT=25mb
APP_STATE_FILE=/var/www/prestamos-app/data/app-state.json
BACKUP_DIR=/var/www/prestamos-app/backups
APP_INTERNAL_KEY=CAMBIA_POR_UNA_CLAVE_LARGA
VITE_APP_INTERNAL_KEY=CAMBIA_POR_LA_MISMA_CLAVE_LARGA
RESET_SECURITY_CODE=CAMBIA_POR_UN_CODIGO_SEGURO
VITE_API_URL=
```

Generar clave segura:

```bash
openssl rand -base64 48
```

## 5. Instalar y compilar

```bash
npm ci
npm run build
```

## 6. Iniciar con PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

Para iniciar PM2 al reiniciar el VPS:

```bash
pm2 startup
```

Ejecuta el comando que PM2 te muestre.

## 7. Configurar Nginx por IP

```bash
sudo cp docs/nginx/prestamos-app-ip.conf /etc/nginx/sites-available/prestamos-app
sudo ln -s /etc/nginx/sites-available/prestamos-app /etc/nginx/sites-enabled/prestamos-app
sudo nginx -t
sudo systemctl reload nginx
```

La app debe abrir en:

```text
http://2.24.108.161
```

No abras el puerto `4000` públicamente. Nginx debe ser el único punto público.

## 8. Firewall recomendado

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 9. Actualizar sistema después de cambios

```bash
cd /var/www/prestamos-app/app
npm run backup
git pull
npm ci
npm run build
pm2 restart prestamos-app
pm2 save
```

## 10. Verificación rápida

```bash
curl http://127.0.0.1:4000/health
curl http://2.24.108.161/health
pm2 logs prestamos-app
```
