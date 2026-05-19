import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sharedDbPath = path.join(__dirname, '.copetin-shared-db.json')

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
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload demasiado grande.'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
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
          const state = JSON.parse(body)
          fs.writeFileSync(sharedDbPath, JSON.stringify(state, null, 2), 'utf8')
          sendJson(res, 200, { ok: true, revision: getSharedDbRevision() })
          return
        }

        sendJson(res, 405, { error: 'Metodo no permitido.' })
      } catch (error) {
        server.config.logger.error(error)
        sendJson(res, 500, { error: error.message ?? 'No se pudo sincronizar la base demo.' })
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
