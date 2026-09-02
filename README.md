ViralVideo AI 2.0
=================

Esta versión añade un backend real para:
1. generar el guion con un modelo de texto,
2. generar 5 imágenes por escena,
3. convertir el guion a voz,
4. montar las imágenes + voz con FFmpeg,
5. entregar un MP4 para reproducir y descargar.

IMPORTANTE
----------
GitHub Pages solo sirve archivos estáticos; no puede ejecutar server.js.
Para esta versión real necesitas un servidor Node/Docker (por ejemplo un servicio que ejecute el Dockerfile).

CLAVES
------
Configura en el servidor:
- OPENAI_API_KEY
- ELEVENLABS_API_KEY

Nunca pongas esas claves dentro de public/index.html ni las subas a GitHub.

EJECUCIÓN LOCAL
---------------
1. Instala Node.js 22+ y FFmpeg.
2. En esta carpeta:
   npm install
3. Copia .env.example a .env y coloca las claves.
4. Exporta las variables del .env o usa un gestor de secretos.
5. Ejecuta:
   npm start
6. Abre http://localhost:3000

DOCKER
------
El Dockerfile ya instala FFmpeg. En un hosting con Docker:
- crea el servicio desde este repositorio,
- añade OPENAI_API_KEY y ELEVENLABS_API_KEY como secretos/variables,
- usa el puerto 3000 (o PORT que asigne el hosting).

NOTA DE COSTOS
--------------
Cada generación puede consumir créditos del proveedor de texto, imágenes y voz. El código no promete que esos servicios sean gratuitos.

La API de voz de ElevenLabs usa el endpoint de Text to Speech y devuelve audio; consulta sus límites y precios actuales antes de publicar la app.
