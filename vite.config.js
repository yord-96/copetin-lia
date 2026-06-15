import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sharedDbPath = path.join(__dirname, '.copetin-shared-db.json')
const maxSharedDbPayloadBytes = 64 * 1024 * 1024

const getSharedDbRevision = () => {
  if (!fs.existsSync(sharedDbPath)) {
    return null
  }

  const stat = fs.statSync(sharedDbPath)
  return `${Math.round(stat.mtimeMs)}:${stat.size}`
}

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let receivedBytes = 0
    let payloadTooLarge = false

    req.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxSharedDbPayloadBytes) {
        payloadTooLarge = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (payloadTooLarge) {
        const error = new Error('La base supera el limite local permitido de 64 MB.')
        error.statusCode = 413
        reject(error)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })

const sharedDemoDbPlugin = () => ({
  name: 'copetin-shared-demo-db',
  configureServer(server) {
    server.middlewares.use('/__copetin_db', async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        if (req.method === 'GET') {
          if (url.searchParams.get('meta') === '1') {
            sendJson(res, 200, {
              initialized: fs.existsSync(sharedDbPath),
              revision: getSharedDbRevision(),
              updatedAt: fs.existsSync(sharedDbPath) ? fs.statSync(sharedDbPath).mtime.toISOString() : null,
            })
            return
          }

          if (!fs.existsSync(sharedDbPath)) {
            sendJson(res, 200, { initialized: false, state: null, revision: null })
            return
          }

          const raw = fs.readFileSync(sharedDbPath, 'utf8')
          sendJson(res, 200, { initialized: true, state: JSON.parse(raw), revision: getSharedDbRevision() })
          return
        }

        if (req.method === 'PUT') {
          const body = await readBody(req)
          const payload = JSON.parse(body)
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            sendJson(res, 400, { error: 'La solicitud debe enviarse como objeto JSON.' })
            return
          }
          if (!Object.prototype.hasOwnProperty.call(payload, 'revision')) {
            sendJson(res, 400, { error: 'Debes enviar la revision actual para guardar el estado.' })
            return
          }
          if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
            sendJson(res, 400, { error: 'El estado debe enviarse como objeto JSON en el campo state.' })
            return
          }

          const currentRevision = getSharedDbRevision()
          const providedRevision = payload.revision === null ? null : String(payload.revision ?? '').trim() || null
          if (providedRevision !== currentRevision) {
            sendJson(res, 409, {
              error: 'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
              currentRevision,
              providedRevision,
            })
            return
          }

          const state = payload.state
          fs.writeFileSync(sharedDbPath, JSON.stringify(state, null, 2), 'utf8')
          sendJson(res, 200, { ok: true, revision: getSharedDbRevision() })
          return
        }

        sendJson(res, 405, { error: 'Metodo no permitido.' })
      } catch (error) {
        server.config.logger.error(error)
        sendJson(res, error.statusCode ?? 500, {
          error: error.message ?? 'No se pudo sincronizar la base demo.',
        })
      }
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    define: {
      'import.meta.env.APP_INTERNAL_KEY': JSON.stringify(env.APP_INTERNAL_KEY ?? ''),
      'import.meta.env.RESET_SECURITY_CODE': JSON.stringify(env.RESET_SECURITY_CODE ?? ''),
    },
    plugins: [react(), sharedDemoDbPlugin()],
  }
})
