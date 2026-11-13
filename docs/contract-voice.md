# Asistente de contrato por voz

En Cotizaciones y Contratos, «Contrato por voz» abre la conversación. «Desde foto» se retiró de la pantalla; los motores anteriores no se desinstalan ni se ejecutan durante el dictado.

## Conversación

Pulsa **Iniciar conversación** una vez y permite el micrófono. El asistente lee la pregunta, espera a terminar de hablar y escucha la respuesta. Muestra la transcripción provisional y definitiva y avanza automáticamente al terminar el reconocimiento de cada respuesta. Una respuesta inválida mantiene la pregunta y solicita corregirla. No guarda el contrato por voz: la creación final sigue en el wizard.

«Pausar conversación», cerrar, corregir una respuesta o escribir detienen la escucha. Puedes reanudar con un botón. El permiso denegado, los errores de reconocimiento y varios silencios consecutivos pausan la conversación sin repetir solicitudes indefinidamente. Los eventos tardíos del micrófono anterior no se aplican a otra pregunta.

Preguntas: número de contrato (o automático), cliente, teléfono opcional, fecha y hora del evento, dirección, responsable (según permisos), logística, productos y garantía. No se acredita pago inicial.

- El número se contrasta con contratos y órdenes en la copia de datos y mediante una consulta al servidor completo, incluyendo contratos ocultos o anulados que conservan su número. Se vuelve a consultar antes de abrir el wizard. Esa consulta no reserva un número; la validación de guardado existente sigue siendo necesaria ante creaciones simultáneas.
- Acepta fechas como «21 de noviembre del 2026», «veintiuno de noviembre del dos mil veintiséis» y `21/11/2026`. Rechaza fechas imposibles o sin año. Acepta horas como «ocho de la noche» y `20:00`.
- Al decir el producto se muestran las coincidencias directamente en tarjetas con foto (o «Sin foto»), precio y disponibilidad. Puedes decir «opción dos», el nombre o una variante que identifique una única tarjeta. No elige variantes ambiguas silenciosamente.
- Usa el mismo cálculo de disponibilidad que el editor, con el resumen actualizado al abrir la conversación. Se estima para el día del evento, con devolución por coordinar, y descuenta unidades ya agregadas al borrador. Si falla la consulta se muestra «sin confirmar». El wizard recalcula al cambiar fechas y asignar proveedores.
- La disponibilidad no limita la cantidad solicitada. Se admiten cantidades positivas enteras hasta el límite existente de 100.000 por fila; los faltantes se resuelven en el wizard.
- Si el catálogo tiene precio válido, incluido cero, no se vuelve a preguntar. Si falta, se pide por voz. El resumen permite editar precios antes de preparar el contrato.
- «Ver o corregir» permite volver a una respuesta y rehacer las posteriores, restaurando el borrador correspondiente para evitar duplicar o mezclar ítems.

## Navegador y privacidad

Usa SpeechRecognition o webkitSpeechRecognition con español es-BO y síntesis de voz cuando está disponible. Requiere permisos y HTTPS (localhost para desarrollo). La disponibilidad y exactitud dependen del navegador. Puede enviar audio al proveedor del navegador: no se ofrece como reconocimiento exclusivamente local. Copetín no agrega una API de pago ni almacena audio. Sin dictado, el mismo flujo admite texto.

No necesita instalar modelos adicionales en el VPS. El lector de fotos y sus motores son independientes.

## Verificación

`node --test src/utils/contractVoice.test.js src/utils/contractVoiceSession.test.js src/utils/contractPhotoImport.test.js server/routes/contractCode.test.js`

Pruebas de números y fechas naturales, precios, variantes, duplicados, lectura del servidor sin mutar datos, espera entre voz y micrófono, pausa, eventos tardíos y permisos. Se comprobó también el recorrido en navegador con voz simulada: una sola activación, tarjetas, cantidad superior al stock, precio automático o faltante, comprobación repetida de código y apertura del wizard sin guardar registros. El micrófono y el reconocimiento reales deben validarse en los equipos de los usuarios.
