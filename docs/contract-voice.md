# Asistente de contrato por voz

En Cotizaciones y Contratos, «Contrato por voz» pregunta cliente, teléfono, fecha completa, dirección, responsable (según permisos), logística, productos, cantidades, precios y garantía. Permite dictar o escribir cada respuesta; muestra transcripción provisional y definitiva. «Leer las preguntas en voz alta» activa la lectura de las preguntas, sin encender automáticamente el micrófono. Cada respuesta se confirma antes de avanzar.

El producto se elige explícitamente del catálogo tras buscarlo por voz o texto. Los números ambiguos y las fechas incompletas requieren corrección. Las respuestas anteriores pueden rehacerse; el recorrido posterior se vuelve a confirmar. La garantía queda separada del alquiler; no se acredita pago inicial.

El resumen prepara un contrato NUEVO en el editor existente. No guarda contratos, cobros ni movimientos de inventario por sí solo. Entrega, devolución, disponibilidad, proveedores y pagos se revisan en el editor, que conserva sus validaciones. Esta versión no permite conversar libremente ni interpretar un contrato completo en una sola frase.

## Navegador y privacidad

Se usa SpeechRecognition o webkitSpeechRecognition del navegador con español es-BO y síntesis de voz cuando esté disponible. Requiere permisos de micrófono y HTTPS (localhost para desarrollo). La disponibilidad, los idiomas y la exactitud dependen del navegador. Puede enviar audio al proveedor del navegador: no se ofrece como reconocimiento exclusivamente local. Copetín no agrega una API de pago ni almacena audio. Si el dictado falla o no existe, el mismo flujo admite texto.

No necesita instalar modelos adicionales en el VPS. El lector de fotos y sus motores son independientes.

## Verificación

Pruebas de números, fechas y preparación del contrato: `node --test src/utils/contractVoice.test.js src/utils/contractPhotoImport.test.js`.

Se verificó en navegador con eventos de voz simulados: transcripción provisional y final, recorrido, catálogo, totales, adaptación móvil y apertura del wizard sin guardar registros. Falta validar el micrófono real, permisos y calidad del reconocimiento en los dispositivos de los usuarios.
