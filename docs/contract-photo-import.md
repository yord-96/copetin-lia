# Contratos desde fotos: lector local sin APIs de pago

El botón **Desde foto** está junto a Nuevo Contrato y Cotización. Permite subir una foto JPG/PNG/WEBP (máximo 8 MB), interpretarla y comparar la transcripción con el original. Después abre el wizard de un contrato NUEVO. Solo los botones normales de creación/aprobación guardan datos, generan recibos o reservan inventario.

## Funcionamiento y límites

### Avance de Python (motor recomendado para la prueba del VPS)

La alternativa `CONTRACT_PHOTO_ENGINE=python` utiliza OpenCV para enderezar la cuadrícula y RapidOCR/PaddleOCR para leer las celdas en CPU. No utiliza Ollama ni necesita su contenedor. Se inicia un proceso por foto, con un hilo configurado en OpenCV/ONNX y límite predeterminado de 60 segundos. Cancelar termina ese proceso. No se afirma un límite de memoria/CPU impuesto por contenedor para esta variante; hay que medirla en el VPS con trabajo normal.

Pruebas reales locales: los contratos 3503 y 3506 devolvieron dos ítems cada uno en unos 21–28 segundos. En 3506 se recuperaron 260 × 12 = 3120 y 30 × 32 = 960. En 3503 se recuperaron 60 y 36 unidades, pero el precio 2,50 fue leído como 2150 y se dejó vacío por discrepancia con el subtotal 150. Fechas, nombres, teléfono, garantía y logística todavía pueden requerir corrección manual. No se afirma una transcripción completa ni precisión garantizada. Todos los ítems se marcan para revisar y seleccionar el producto exacto. Una garantía desconocida no se considera inexistente y los pagos no se acreditan por OCR.

Actualización en Ubuntu, desde la carpeta de la aplicación, con el usuario habitual de PM2:

```bash
npm run backup
git pull --ff-only origin main
sudo apt-get update
sudo apt-get install -y python3-venv
bash scripts/setup-contract-photo-ocr.sh
node scripts/enable-contract-photo-ocr.mjs
npm run build
CONTRACT_PHOTO_ENGINE=python CONTRACT_PHOTO_ENABLED=true CONTRACT_PHOTO_PYTHON_TIMEOUT_MS=60000 pm2 restart prestamos-app --update-env
pm2 save
node scripts/check-contract-photo-reader.mjs
```

Ejecutar cada paso solo si el anterior terminó correctamente. El activador comprueba la instalación antes de modificar únicamente tres claves de `.env`, conserva el resto y guarda una copia privada en `data/contract-photo-python/`. El instalador usa un venv privado y no reemplaza el Python del sistema. Descarga modelos durante la instalación, no envía fotos a proveedores externos. La primera instalación requiere conexión a PyPI y al repositorio de modelos.

Después de comprobar `engine: python` y `ready: true`, detener el antiguo contenedor con `sudo docker compose -f docker-compose.contract-photo.yml stop ollama`. No borrar sus volúmenes como parte de esta actualización. Recargar el navegador con Ctrl+F5 y probar ambas fotos cancelando el wizard antes de crear contratos. Revisar tiempos y `free -h` con usuarios activos; la velocidad local no sustituye esa prueba.

Diagnóstico del nuevo motor: `data/contract-photo-python/venv/bin/python server/ocr/worker.py --check`. Desactivar las lecturas si hace falta con `CONTRACT_PHOTO_ENABLED=false` en el entorno del backend y reiniciar PM2. El resto de contratos funciona independientemente del lector.

### Motor anterior de Ollama

- Ollama local lee la imagen con `qwen3-vl:2b`. No utiliza OpenAI, claves API, servicios cloud ni pruebas gratuitas con cobro posterior. La imagen se transmite solo del navegador al servidor de la empresa y de allí al lector local; no se publica en uploads. Se mantiene temporalmente en memoria, no en la base de datos.
- El modelo extrae manuscrito, cantidades, precios, cliente, número lateral y responsable superior. La consigna ignora las filas preimpresas vacías, distingue garantía de alquiler/pago y trata cualquier instrucción escrita en el documento como datos.
- La aplicación valida el JSON y hace las coincidencias de catálogo localmente. Productos genéricos/ambiguos requieren selección explícita. Si no existen, el usuario puede conservar un ítem fuera de inventario por verificar. Los precios escritos se conservan aunque difieran del catálogo.
- Carla puede resolverse como CARLA TERCEROS solo si existe una coincidencia única. Un teléfono compartido entre clientes no elige uno silenciosamente. Los números de contrato duplicados se advierten y deben cambiarse; el wizard conserva su validación contra datos actualizados.
- Una garantía escrita queda acordada, no pagada. Un pago inicial debe revisarse en el wizard, incluido método/cuenta. Fechas y horas ausentes no se reconocen por adivinación: la entrega propuesta usa el evento, la devolución/horarios ausentes quedan por coordinar y se advierte.
- Ningún OCR de manuscrito garantiza 100% de acierto. Deben verificarse también las transcripciones que parecen seguras. Las coincidencias y advertencias no son porcentajes de precisión del lector.
- Las pruebas de los ejemplos 3506/3503 usan transcripciones manuales para verificar el mapeo. No demuestran precisión real del modelo. Para validar lectura real hay que instalarlo y probar ambas fotos, luego más contratos con distintas letras, sombras y giros.

## KVM 2 / Ubuntu 24.04

La configuración propuesta usa CPU, sin GPU: un trabajo a la vez, 1 vCPU como máximo y 4 GiB de memoria de contenedor, con el modelo liberado de memoria al terminar cada lectura (`keep_alive: 0`). No comparte la cola de escrituras de la aplicación. La API devuelve 202 y el navegador consulta el progreso con solicitudes cortas, evitando mantener una petición abierta durante minutos. Un segundo lector recibe un aviso de ocupado; cancelar detiene la petición al motor.

El modelo ocupa aproximadamente 1.9 GB de descarga; la imagen completa de Docker y su almacenamiento ocuparon unos 8 GB adicionales en el VPS observado. Reserva al menos 16 GiB libres de disco y 4 GiB disponibles de RAM antes de instalar. Esto es un margen operativo de esta integración, no una garantía de rendimiento. Hay que medir tiempo, CPU y RAM en el VPS real con usuarios trabajando. El límite de tiempo predeterminado es 180 s, configurable hasta 300 s. Si se agota, no se crea un contrato.

### Instalación

Desde la carpeta de la aplicación, con Docker Engine y el plugin Docker Compose ya instalados según la [guía oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/):

```bash
bash scripts/setup-contract-photo-reader.sh
node scripts/check-contract-photo-reader.mjs
```

El script verifica memoria/disco, inicia el lector limitado y descarga el modelo gratuito. No modifica la base ni reinicia la aplicación. El puerto 11434 queda vinculado a 127.0.0.1; no lo abras al público.

En el `.env` del backend:

```dotenv
CONTRACT_PHOTO_ENABLED=true
CONTRACT_PHOTO_OLLAMA_URL=http://127.0.0.1:11434
CONTRACT_PHOTO_MODEL=qwen3-vl:2b
CONTRACT_PHOTO_TIMEOUT_MS=180000
```

Después de actualizar y compilar la aplicación, reiniciar el backend habitual con `pm2 restart prestamos-app --update-env`. Frontend y backend deben actualizarse juntos. Vite reenvía `/__copetin_db/contract-photo` a Node en desarrollo. El contenedor es opcional para la aplicación; si no existe el lector, el botón muestra que falta instalarlo y no simula resultados.

Para detener exclusivamente el lector: `docker compose -f docker-compose.contract-photo.yml stop`. No elimina modelos ni datos. Para quitarlo del flujo: `CONTRACT_PHOTO_ENABLED=false` y reiniciar el backend.

## Comprobación antes de usarlo operativamente

Estado de validación (13/11/2026): el flujo de revisión y apertura del wizard se comprobó con una respuesta de lectura simulada. La prueba real local con Qwen3-VL 2B en CPU falló con HTTP 500 tras aproximadamente 2 minutos y 50 segundos, durante el procesamiento de la imagen; no produjo una extracción válida. Por tanto, la precisión manuscrita y la viabilidad operativa en el VPS siguen sin estar demostradas. No se debe considerar esta función lista para producción ni interpretar las pruebas de interfaz como validación del reconocimiento.

La prueba posterior en el VPS también terminó sin extracción; el cgroup informó `oom=0`, `oom_kill=0` y un pico de 3852541952 bytes con límite de 4 GiB. No hay evidencia para atribuir ese fallo a falta de RAM. Una prueba local adicional con imagen de 896 píxeles de lado mayor, instrucciones reducidas y salida limitada a 600 tokens tampoco entregó resultado dentro de 90 segundos. Esa reducción no está aplicada al flujo de producción: no demostró una mejora suficiente ni precisión aceptable.

1. Ejecutar el diagnóstico y comprobar `ready: true`.
2. Subir por separado las fotos de 3506 y 3503. En la primera comprobar 260 × 12 + 30 × 32 = 4080 y garantía 200 separada. En la segunda comprobar 60 × 2.50 + 36 × 1.20 = 193.20 y que tacita/platillo sustituye el renglón impreso.
3. Comparar nombres, teléfono, fecha, código y responsable con el original. Las cucharillas y sillas ambiguas deben permitir elegir la variante exacta.
4. Abrir el wizard, comprobar proveedores y logística; cancelar. Verificar que no se creó contrato, recibo ni movimiento de inventario.
5. Probar una imagen ilegible, cancelar una lectura y abrir una segunda simultánea. Probar trabajo normal y asistencia mientras el lector está ocupado.
6. Medir los tiempos reales y comprobar que los límites de recursos dejan capacidad al sistema. Si la lectura no es útil en ese hardware, desactivar el lector; no sustituirlo por una API de pago sin autorización.

Fuentes: [visión local de Ollama](https://docs.ollama.com/capabilities/vision), [salida estructurada](https://docs.ollama.com/capabilities/structured-outputs), [modelo Qwen3-VL](https://ollama.com/library/qwen3-vl), [recursos KVM](https://www.hostinger.com/vps-hosting?lang=en).
