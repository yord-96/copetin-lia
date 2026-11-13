# Investigación de lectura local de contratos

Fecha: 13/11/2026. Esta investigación no sustituye el motor desplegado ni demuestra que la importación esté lista para producción.

## Hallazgos

- RapidOCR ejecuta modelos de PaddleOCR con ONNX Runtime, tiene licencia Apache 2.0 y permite ejecución local en CPU. Es un candidato más ligero para detectar texto y sus coordenadas que un modelo generativo de página completa.
- PaddleOCR ofrece reconocimiento latino que incluye español. Soportar el idioma no garantiza reconocer la caligrafía de estos formularios.
- TrOCR tiene modelos especializados en líneas manuscritas. El modelo publicado por Microsoft usa IAM y espera imágenes de una sola línea; necesita segmentación previa y validación en español.
- Tesseract advierte expresamente que está diseñado para texto impreso y no funciona bien con manuscritos. No es el candidato principal para estas fotos.

## Prueba local reproducible

Entorno aislado de Python 3.12 en Windows, Intel N95, CPU, un hilo configurado para ONNX Runtime. Sin API remota. Las descargas iniciales son de modelos, no de las fotos del cliente.

Se probó RapidOCR 3.10.0 con detección PP-OCRv5 mobile y reconocimiento PP-OCRv5 latino mobile. Con los modelos ya descargados:

| Foto | Tiempo de llamada | RSS del proceso después de leer | Observaciones |
| --- | ---: | ---: | --- |
| 3503 | 17,27 s | 117 MiB | Detectó código 003503, cantidades 60/36 y precios 2,50/1,20. Leyó incorrectamente 43,20 como 213,20; teléfono, fecha y descripciones también contienen errores. |
| 3506 | 19,74 s | 117 MiB | Detectó código 003506, cantidades 260/30, 3120/960, alquiler 4080 y garantía 200. Leyó 12 como 2 y contiene errores en fecha y descripciones. |

RSS después de la llamada no es el pico de RAM. Estos tiempos no son mediciones del VPS y no garantizan el mismo rendimiento allí. La primera llamada con descarga de modelos tardó 39,77 s y no se usa como estimación de inferencia normal. La confianza del OCR no equivale a exactitud: el subtotal incorrecto obtuvo una puntuación alta.

Comparación posterior con reconocimiento PP-OCRv6 small (`es`) y la misma detección v5: la foto 3503 tardó 21,62 s incluyendo la descarga inicial del nuevo reconocedor; la 3506 tardó 16,30 s con el modelo cargado, y RSS posterior de 138 MiB. En 3506 leyó correctamente 260, 12, 3120, 30, 32, 960, alquiler 4080 y garantía 200. En 3503 recuperó mejor «Cucharillas», pero leyó 2,50 como 2150 y 43,20 como H13,20, además de errores en encabezado. V6 mejora algunas lecturas y empeora otras; no es una extracción fiable por sí sola.

Los resultados no permiten crear un contrato automáticamente ni reemplazar el lector actual todavía. Sí demuestran que existe una alternativa local considerablemente más ligera que merece desarrollo y validación.

Para reproducir en un entorno virtual de Python 3.12:

```bash
python -m pip install -r scripts/research/requirements-contract-ocr.txt
python scripts/research/benchmark-contract-ocr.py --recognizer v6-small --output data/ocr-research-v6 foto-3503.jpeg foto-3506.jpeg
python scripts/research/benchmark-contract-ocr.py --recognizer v5-latin --output data/ocr-research-v5 foto-3503.jpeg foto-3506.jpeg
```

Las rutas de ejemplo deben sustituirse por las fotos reales. Los JSON de salida contienen datos personales y se conservan en la carpeta privada `data/`, fuera del control de versiones. El script no llama a los endpoints de contratos ni registra pagos o inventario.

## Siguiente experimento

Avance integrado posterior: se implementaron la corrección geométrica y el reconocimiento por celdas en `server/ocr/`, con un proceso Python cancelable conectado al lector existente. Las dos fotos devolvieron dos ítems cada una en 21–28 s en pruebas a través del backend Node. Se recuperó el subtotal 3120 que sobresalía de la celda de 3506 mediante un recorte más ancho y comprobación contra 260 × 12. El precio contradictorio de 3503 queda vacío para revisión, sin transformarlo por conjetura en 2,50. La fecha no legible también queda vacía y obliga a completarla. El instalador no activa el motor por sí solo; debe pasar el diagnóstico y seleccionarse explícitamente en el backend. Sigue pendiente validar el rendimiento en Linux/VPS y con más letras.

1. Ampliar la comparación v6 small / v5 latino con recortes de celdas y más muestras, midiendo errores por campo.
2. Rectificar perspectiva y localizar las líneas/celdas del formulario con OpenCV.
3. Reconocer por separado descripciones manuscritas, cantidades, precios, encabezado y código lateral. Ignorar filas sin cantidades, no tomar la etiqueta impresa como descripción manuscrita.
4. Validar multiplicaciones y suma del alquiler, separando garantía y pagos. Una discrepancia marca revisión; no autoriza corregir cifras por conjetura.
5. Comparar con inventario solo después del OCR, sin sustituir lecturas dudosas por productos arbitrarios.
6. Conservar la revisión humana del wizard. Validar con más caligrafías y con carga normal de usuarios antes de desplegar.

## Fuentes primarias

- [RapidOCR](https://github.com/RapidAI/RapidOCR)
- [Reconocimiento multilingüe de PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md)
- [Modelos de reconocimiento y mediciones de PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/text_recognition.en.md)
- [Modelo manuscrito TrOCR de Microsoft](https://huggingface.co/microsoft/trocr-small-handwritten)
- [Limitaciones manuscritas de Tesseract](https://tesseract-ocr.github.io/tessdoc/FAQ.html#can-i-use-tesseract-for-handwriting-recognition)
