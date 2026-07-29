import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sharedDbPath = path.join(__dirname, '.copetin-shared-db.json')
const maxSharedDbPayloadBytes = 64 * 1024 * 1024
const defaultProductUploadDirectory = path.join(__dirname, 'uploads', 'products')
const defaultAttendanceUploadDirectory = path.join(__dirname, 'uploads', 'attendance')

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

const normalizeRoleId = (role) => {
  const normalized = String(role ?? '').trim().toLowerCase()
  if (normalized === 'developer' || normalized === 'dev' || normalized.includes('desarrollador')) return 'developer'
  if (normalized === 'super_admin' || normalized === 'superadmin' || normalized.includes('super')) return 'super_admin'
  return normalized
}

const getUserRoleIds = (user) => {
  const roles = Array.isArray(user?.roleIds) ? user.roleIds : [user?.roleId ?? user?.role]
  return [...new Set(roles.map(normalizeRoleId).filter(Boolean))]
}

const isDeveloperUser = (user) => getUserRoleIds(user).includes('developer')

const databaseBackupCollections = [
  'categories',
  'clients',
  'users',
  'items',
  'inventoryCombos',
  'quotes',
  'contracts',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'personnelEmployees',
  'personnelAttendance',
  'personnelIncidents',
  'rentals',
  'deliveries',
  'transportRoutes',
  'vehicles',
  'drivers',
  'calendarEvents',
  'calendarBoardNotes',
  'generatedReports',
  'cashSessions',
  'cashMovements',
  'cashDebts',
  'attendanceRecords',
  'resetLogs',
  'inventoryMovements',
  'stockRecoveries',
  'systemAuditLog',
  'userPresence',
]

const countBackupRows = (state) =>
  databaseBackupCollections.reduce((summary, key) => {
    const count = Array.isArray(state?.[key]) ? state[key].filter((entry) => !entry?.deletedAt).length : 0
    return { ...summary, [key]: count, total: summary.total + count }
  }, { total: 0 })

const extractBackupState = (payload) => {
  const candidate = payload?.state ?? payload?.database ?? payload?.backup ?? payload
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    const error = new Error('El archivo importado no contiene una base de datos valida.')
    error.statusCode = 400
    throw error
  }
  return candidate
}

const readRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let receivedBytes = 0
    req.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxSharedDbPayloadBytes) {
        const error = new Error('La base supera el limite local permitido de 64 MB.')
        error.statusCode = 413
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const assertDeveloperDatabaseAccess = (state, { code, userId, resetSecurityCode }) => {
  if (!resetSecurityCode || String(code ?? '').trim() !== resetSecurityCode) {
    const error = new Error('Contrasena de seguridad incorrecta.')
    error.statusCode = 403
    throw error
  }
  const currentUser = (Array.isArray(state?.users) ? state.users : [])
    .find((user) => String(user?.id ?? '').trim() === String(userId ?? '').trim() && !user?.deletedAt)
  if (!currentUser || !isDeveloperUser(currentUser) || currentUser.status !== 'active') {
    const error = new Error('Solo el rol developer puede respaldar o importar la base.')
    error.statusCode = 403
    throw error
  }
  return currentUser
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

const detectImageType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  return null
}

const sanitizeIdentifier = (value) =>
  String(value ?? 'product')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'product'

const allowedEconomicLedgerTypes = new Set(['deposit', 'guarantee', 'charge', 'refund', 'note'])
const allowedEconomicLedgerPaymentMethods = new Set(['efectivo', 'qr', 'transferencia'])

const makeEconomicLedgerId = () => `eco-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

const publicCatalogAreas = [
  { id: 'combos', label: 'Combos' },
  { id: 'vajilla', label: 'Vajilla' },
  { id: 'manteleria', label: 'Manteleria' },
  { id: 'mobiliario', label: 'Mobiliario' },
]

const publicCatalogAreaKeywords = {
  vajilla: [
    'cristaleria', 'cubierto', 'plaquet plastico', 'plaquet vidrio', 'vaso',
    'plato hondo', 'butetero plano', 'jarra', 'juego de te', 'llajuero',
    'charola', 'dispensador', 'hielera', 'pinza', 'panero', 'cenicero',
    'varios', 'chifundi', 'aro',
  ],
  manteleria: [
    'faldon', 'cortina', 'gasa', 'caminito', 'capuchon', 'manteleria',
    'servilleta', 'mona', 'cancan', 'licra', 'muleton', 'mantel',
  ],
  mobiliario: [
    'mesa', 'tapiz', 'cojin', 'modulo', 'silla infantil', 'mesa infantil',
    'lounge', 'sombrilla', 'silla', 'silla coctelera', 'mesa coctelera',
    'calentador', 'panel', 'toldo', 'lona', 'tarima', 'plaquet',
  ],
}

const normalizePublicCatalogText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const resolvePublicCatalogArea = (item) => {
  const assignedArea = normalizePublicCatalogText(item?.inventoryArea)
  if (publicCatalogAreas.some((area) => area.id === assignedArea)) return assignedArea

  const haystack = normalizePublicCatalogText([
    item?.category,
    item?.name,
    item?.itemName,
    item?.description,
  ].filter(Boolean).join(' '))

  for (const area of publicCatalogAreas) {
    if ((publicCatalogAreaKeywords[area.id] ?? []).some((keyword) => haystack.includes(keyword))) {
      return area.id
    }
  }

  return 'mobiliario'
}

const getPublicProductImageSrc = (item) => {
  for (const field of ['imageUrl', 'imageDataUrl', 'image', 'photo', 'thumbnailUrl']) {
    const value = item?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const buildPublicCatalogPayload = (state) => {
  const toNumber = (value) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
  }

  const stockItems = (Array.isArray(state?.items) ? state.items : [])
    .filter((item) => !item?.deletedAt)
    .filter((item) => String(item?.adoptionSource ?? '').trim() !== 'service_order_quick_item')
    .filter((item) => String(item?.verificationStatus ?? '').trim() !== 'pending_verification')
    .filter((item) => toNumber(item?.totalStock) > 0)
  const stockItemById = new Map(stockItems.map((item) => [String(item?.id ?? ''), item]))

  const products = stockItems
    .map((item) => {
      const area = resolvePublicCatalogArea(item)
      const name = String(item?.name ?? item?.itemName ?? '').trim()
      const category = String(item?.category ?? '').trim()
      const color = String(item?.itemColor ?? item?.color ?? '').trim()
      const material = String(item?.brand ?? item?.material ?? '').trim()
      const sku = String(item?.sku ?? item?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase()
      const totalStock = Math.max(0, Math.trunc(toNumber(item?.totalStock)))

      return {
        id: String(item?.id ?? sku).trim(),
        name,
        category,
        color,
        material,
        area,
        areaLabel: publicCatalogAreas.find((entry) => entry.id === area)?.label ?? 'Mobiliario',
        sku: sku || 'GEN',
        imageUrl: getPublicProductImageSrc(item),
        totalStock,
        kind: 'product',
        searchText: normalizePublicCatalogText([name, category, color, material, sku, area].join(' ')),
      }
    })
    .filter((item) => item.name)

  const combos = (Array.isArray(state?.inventoryCombos) ? state.inventoryCombos : [])
    .filter((combo) => !combo?.deletedAt)
    .filter((combo) => String(combo?.status ?? 'active') !== 'inactive')
    .map((combo) => {
      const ingredients = (Array.isArray(combo?.ingredients) ? combo.ingredients : [])
        .map((line) => {
          const optionIds = Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0
            ? line.optionItemIds
            : [line?.itemId]
          const optionItems = optionIds
            .map((id) => stockItemById.get(String(id ?? '')))
            .filter(Boolean)
          const quantity = Math.max(1, Math.trunc(toNumber(line?.quantity ?? 1)))
          const available = optionItems.reduce((sum, item) => sum + toNumber(item?.totalStock), 0)
          return {
            name: String(line?.slotLabel ?? line?.itemName ?? optionItems[0]?.name ?? '').trim(),
            quantity,
            available,
            controlsStock: optionItems.length > 0,
          }
        })
        .filter((line) => line.name)
      const availableCombos = ingredients.reduce((min, line) => {
        if (!line.controlsStock) return min
        return Math.min(min, Math.floor(line.available / Math.max(1, line.quantity)))
      }, Number.POSITIVE_INFINITY)
      const totalStock = Number.isFinite(availableCombos) ? Math.max(0, availableCombos) : 0
      const name = String(combo?.name ?? '').trim()
      const category = String(combo?.category ?? 'COMBOS').trim() || 'COMBOS'
      const sku = String(combo?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase()
      const ingredientText = ingredients.map((line) => `${line.quantity}x ${line.name}`).join(' + ')
      return {
        id: `combo-${String(combo?.id ?? sku).trim()}`,
        name,
        category,
        color: '',
        material: '',
        area: 'combos',
        areaLabel: 'Combos',
        sku: sku || 'COMBO',
        imageUrl: getPublicProductImageSrc(combo),
        totalStock,
        kind: 'combo',
        ingredientsCount: ingredients.length,
        detailText: ingredientText,
        searchText: normalizePublicCatalogText([name, category, sku, 'combo combos', ingredientText].join(' ')),
      }
    })
    .filter((combo) => combo.name)

  const catalogItems = [...combos, ...products]
    .sort((left, right) => left.area.localeCompare(right.area, 'es') || left.name.localeCompare(right.name, 'es'))

  return {
    updatedAt: new Date().toISOString(),
    products: catalogItems,
    categories: [...new Set(catalogItems.map((item) => item.category).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'es')),
    areas: publicCatalogAreas,
  }
}

const toPositiveRoundedNumber = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number * 100) / 100
}

const normalizeEconomicLedgerRows = (rows) => {
  if (!Array.isArray(rows)) return []
  return rows.map((entry) => {
    const type = allowedEconomicLedgerTypes.has(entry?.type) ? entry.type : 'note'
    const paymentMethodCandidate = String(entry?.paymentMethod ?? entry?.method ?? '').trim().toLowerCase()
    const paymentMethod = type === 'note'
      ? ''
      : allowedEconomicLedgerPaymentMethods.has(paymentMethodCandidate)
        ? paymentMethodCandidate
        : 'efectivo'
    return {
      id: String(entry?.id ?? '').trim() || makeEconomicLedgerId(),
      type,
      amountBs: type === 'note'
        ? 0
        : toPositiveRoundedNumber(entry?.amountBs ?? entry?.amount),
      paymentMethod,
      paymentAccount: paymentMethod === 'qr'
        ? String(entry?.paymentAccount ?? entry?.account ?? '').trim().toUpperCase()
        : '',
      note: String(entry?.note ?? '').trim(),
      createdAt: String(entry?.createdAt ?? '').trim() || new Date().toISOString(),
      createdById: entry?.createdById ?? entry?.userId ?? null,
      createdByName: String(entry?.createdByName ?? entry?.userName ?? 'Sistema').trim() || 'Sistema',
    }
  })
}

const patchContractEconomicLedger = (state, requestedId, payload) => {
  const contracts = Array.isArray(state?.contracts) ? state.contracts : []
  const contractIndex = contracts.findIndex((contract) =>
    String(contract?.id ?? '') === requestedId
    || String(contract?.contractCode ?? '') === requestedId
    || String(contract?.number ?? '') === requestedId
  )

  if (contractIndex < 0) {
    const error = new Error('Contrato no encontrado para guardar el cuaderno economico.')
    error.statusCode = 404
    throw error
  }

  const now = new Date().toISOString()
  const updatedContract = {
    ...contracts[contractIndex],
    economicLedger: normalizeEconomicLedgerRows(payload?.economicLedger),
    economicLedgerUpdatedAt: now,
    economicLedgerUpdatedById: payload?.updatedById ?? payload?.userId ?? null,
    economicLedgerUpdatedByName: String(payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema',
    updatedAt: now,
  }

  return {
    state: {
      ...state,
      contracts: [
        ...contracts.slice(0, contractIndex),
        updatedContract,
        ...contracts.slice(contractIndex + 1),
      ],
    },
    contract: updatedContract,
  }
}

const sharedDemoDbPlugin = (env) => {
  const productUploadDirectory = path.resolve(env.PRODUCT_UPLOAD_DIR || defaultProductUploadDirectory)
  const attendanceUploadDirectory = path.resolve(env.ATTENDANCE_UPLOAD_DIR || defaultAttendanceUploadDirectory)
  const maxProductImageBytes = Number(env.PRODUCT_IMAGE_MAX_BYTES || 8 * 1024 * 1024)
  const maxAttendancePhotoBytes = Number(env.ATTENDANCE_PHOTO_MAX_BYTES || 1024 * 1024)
  const configuredResetSecurityCode = String(env.RESET_SECURITY_CODE ?? '').trim()
  const resetSecurityCode = configuredResetSecurityCode && configuredResetSecurityCode !== 'cambia-este-codigo'
    ? configuredResetSecurityCode
    : '1703'
  fs.mkdirSync(productUploadDirectory, { recursive: true })
  fs.mkdirSync(attendanceUploadDirectory, { recursive: true })

  return {
  name: 'copetin-shared-demo-db',
  configureServer(server) {
    const servePublicCatalog = async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Metodo no permitido.' })
        return
      }

      try {
        if (!fs.existsSync(sharedDbPath)) {
          res.setHeader('Cache-Control', 'public, max-age=60')
          sendJson(res, 200, buildPublicCatalogPayload({}))
          return
        }

        const state = JSON.parse(fs.readFileSync(sharedDbPath, 'utf8'))
        res.setHeader('Cache-Control', 'public, max-age=60')
        sendJson(res, 200, buildPublicCatalogPayload(state))
      } catch (error) {
        server.config.logger.error(error)
        sendJson(res, 500, { error: error.message || 'No se pudo cargar el catalogo publico.' })
      }
    }

    server.middlewares.use('/api/public/catalog', servePublicCatalog)
    server.middlewares.use('/__copetin_db/public/catalog', servePublicCatalog)

    server.middlewares.use('/api/uploads/products', async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Metodo no permitido.' })
        return
      }
      try {
        const chunks = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > maxProductImageBytes) {
            sendJson(res, 413, { error: 'La imagen supera el tamano maximo permitido.' })
            return
          }
          chunks.push(chunk)
        }
        const buffer = Buffer.concat(chunks)
        const type = detectImageType(buffer)
        if (!type) {
          sendJson(res, 400, { error: 'El archivo no es una imagen JPG, PNG o WEBP valida.' })
          return
        }
        const declaredMime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
        if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== type.mimeType) {
          sendJson(res, 400, { error: 'El contenido de la imagen no coincide con su tipo declarado.' })
          return
        }
        const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20)
        const filename = `${sanitizeIdentifier(req.headers['x-product-id'])}-${hash}.${type.extension}`
        const destination = path.join(productUploadDirectory, filename)
        if (!fs.existsSync(destination)) {
          fs.writeFileSync(destination, buffer, { flag: 'wx' })
        }
        sendJson(res, 201, {
          ok: true,
          imageUrl: `/uploads/products/${filename}`,
          filename,
          mimeType: type.mimeType,
          bytes: buffer.length,
        })
      } catch (error) {
        server.config.logger.error(error)
        sendJson(res, 500, { error: error.message || 'No se pudo guardar la imagen.' })
      }
    })

    server.middlewares.use('/api/uploads/attendance', async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Metodo no permitido.' })
        return
      }
      try {
        const chunks = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > maxAttendancePhotoBytes) {
            sendJson(res, 413, { error: 'La foto supera el tamano maximo permitido.' })
            return
          }
          chunks.push(chunk)
        }
        const buffer = Buffer.concat(chunks)
        const type = detectImageType(buffer)
        if (!type) {
          sendJson(res, 400, { error: 'El archivo no es una imagen JPG, PNG o WEBP valida.' })
          return
        }
        const declaredMime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
        if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== type.mimeType) {
          sendJson(res, 400, { error: 'El contenido de la foto no coincide con su tipo declarado.' })
          return
        }
        const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20)
        const filename = `${sanitizeIdentifier(req.headers['x-attendance-id'] || 'attendance')}-${Date.now()}-${hash}.${type.extension}`
        const destination = path.join(attendanceUploadDirectory, filename)
        fs.writeFileSync(destination, buffer, { flag: 'wx' })
        sendJson(res, 201, {
          ok: true,
          photoUrl: `/uploads/attendance/${filename}`,
          filename,
          mimeType: type.mimeType,
          bytes: buffer.length,
        })
      } catch (error) {
        server.config.logger.error(error)
        sendJson(res, 500, { error: error.message || 'No se pudo guardar la foto.' })
      }
    })

    server.middlewares.use('/uploads/products', (req, res) => {
      const filename = path.basename(decodeURIComponent(String(req.url || '').replace(/^\/+/, '')))
      if (!filename || filename !== decodeURIComponent(String(req.url || '').replace(/^\/+/, ''))) {
        sendJson(res, 400, { error: 'Nombre de archivo invalido.' })
        return
      }
      const filePath = path.join(productUploadDirectory, filename)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(res, 404, { error: 'Imagen no encontrada.' })
        return
      }
      const extension = path.extname(filename).toLowerCase()
      const mimeType = extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/jpeg'
      res.statusCode = 200
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
      fs.createReadStream(filePath).pipe(res)
    })

    server.middlewares.use('/uploads/attendance', (req, res) => {
      const filename = path.basename(decodeURIComponent(String(req.url || '').replace(/^\/+/, '')))
      if (!filename || filename !== decodeURIComponent(String(req.url || '').replace(/^\/+/, ''))) {
        sendJson(res, 400, { error: 'Nombre de archivo invalido.' })
        return
      }
      const filePath = path.join(attendanceUploadDirectory, filename)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(res, 404, { error: 'Foto no encontrada.' })
        return
      }
      const extension = path.extname(filename).toLowerCase()
      const mimeType = extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/jpeg'
      res.statusCode = 200
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
      fs.createReadStream(filePath).pipe(res)
    })

    server.middlewares.use('/__copetin_db', async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const normalizedPath = url.pathname.replace(/^\/__copetin_db/, '') || '/'
        if (req.method === 'POST' && normalizedPath === '/database/export') {
          if (!fs.existsSync(sharedDbPath)) {
            sendJson(res, 404, { error: 'La base de datos aun no esta inicializada.' })
            return
          }

          const body = await readBody(req)
          const payload = JSON.parse(body || '{}')
          const state = JSON.parse(fs.readFileSync(sharedDbPath, 'utf8'))
          const currentUser = assertDeveloperDatabaseAccess(state, {
            code: payload.code,
            userId: payload.userId,
            resetSecurityCode,
          })
          const exportedAt = new Date().toISOString()
          const summary = countBackupRows(state)
          const backup = {
            app: 'el-copetin',
            kind: 'database-backup',
            schemaVersion: state?.schemaVersion ?? 3,
            exportedAt,
            exportedBy: {
              id: currentUser.id,
              name: currentUser.fullName ?? currentUser.username ?? 'Developer',
              role: 'Developer',
            },
            action: 'export',
            summary,
            state,
          }
          state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : []
          state.resetLogs.unshift({
            id: `rst-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            userId: currentUser.id,
            userName: currentUser.fullName,
            userRole: 'Developer',
            action: 'database_export',
            modules: ['database_backup'],
            summary: { ...summary, exportedCollections: databaseBackupCollections.length },
            result: 'success',
            errors: [],
            observations: String(payload.observations ?? 'Descarga completa de base de datos.').trim(),
            ip: '',
            createdAt: new Date().toISOString(),
          })
          fs.writeFileSync(sharedDbPath, JSON.stringify(state, null, 2), 'utf8')
          const revision = getSharedDbRevision()

          const filename = `copetin-base-datos-${exportedAt.replace(/[:.]/g, '-')}.json`
          const responseBody = JSON.stringify(backup, null, 2)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
          res.setHeader('Content-Length', String(Buffer.byteLength(responseBody)))
          res.setHeader('X-Copetin-Exported-At', exportedAt)
          res.setHeader('X-Copetin-Summary-Total', String(summary.total ?? 0))
          res.setHeader('X-Copetin-Revision', String(revision ?? ''))
          res.end(responseBody)
          return
        }

        if (req.method === 'POST' && normalizedPath === '/database/import') {
          if (!fs.existsSync(sharedDbPath)) {
            sendJson(res, 404, { error: 'La base de datos aun no esta inicializada.' })
            return
          }
          if (String(req.headers['x-copetin-confirmation'] ?? '').trim().toUpperCase() !== 'IMPORTAR') {
            sendJson(res, 400, { error: 'Debes escribir IMPORTAR para reemplazar la base.' })
            return
          }

          const currentState = JSON.parse(fs.readFileSync(sharedDbPath, 'utf8'))
          const currentUser = assertDeveloperDatabaseAccess(currentState, {
            code: req.headers['x-copetin-reset-code'],
            userId: req.headers['x-copetin-user-id'],
            resetSecurityCode,
          })
          const rawBody = await readRawBody(req)
          const importedState = extractBackupState(JSON.parse(rawBody))
          const importedDevelopers = (Array.isArray(importedState.users) ? importedState.users : [])
            .filter((user) => !user.deletedAt && user.status === 'active' && isDeveloperUser(user))
          if (!importedDevelopers.length) {
            sendJson(res, 400, { error: 'La base importada no tiene ningun usuario developer activo.' })
            return
          }

          const nextState = { ...importedState }
          nextState.users = Array.isArray(nextState.users) ? nextState.users : []
          if (!nextState.users.some((user) => user.id === currentUser.id && isDeveloperUser(user))) {
            nextState.users.push({
              ...currentUser,
              status: 'active',
              deletedAt: null,
              isCurrentUser: true,
              updatedAt: new Date().toISOString(),
            })
          }
          nextState.users = nextState.users.map((user) => ({ ...user, isCurrentUser: user.id === currentUser.id }))
          const importLog = {
            id: `rst-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            userId: currentUser.id,
            userName: currentUser.fullName,
            userRole: 'Developer',
            action: 'database_import',
            modules: ['database_backup'],
            summary: { ...countBackupRows(nextState), importedCollections: databaseBackupCollections.length },
            result: 'success',
            errors: [],
            observations: decodeURIComponent(String(req.headers['x-copetin-observations'] ?? '')).trim() || 'Importacion completa de base de datos.',
            ip: '',
            createdAt: new Date().toISOString(),
          }
          const preservedLogs = [
            ...(Array.isArray(nextState.resetLogs) ? nextState.resetLogs : []),
            ...(Array.isArray(currentState.resetLogs) ? currentState.resetLogs : []),
          ]
          const seenLogIds = new Set()
          const uniqueLogs = preservedLogs.filter((log) => {
            const id = String(log?.id ?? '').trim()
            if (id && seenLogIds.has(id)) return false
            if (id) seenLogIds.add(id)
            return true
          })
          nextState.resetLogs = [importLog, ...uniqueLogs].slice(0, 500)
          fs.writeFileSync(sharedDbPath, JSON.stringify(nextState, null, 2), 'utf8')
          sendJson(res, 200, {
            ok: true,
            log: importLog,
            summary: importLog.summary,
            message: 'Base de datos importada correctamente.',
            revision: getSharedDbRevision(),
          })
          return
        }

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

        const economicLedgerMatch = normalizedPath.match(/^\/contracts\/([^/]+)\/economic-ledger$/)
        if (req.method === 'PUT' && economicLedgerMatch) {
          const body = await readBody(req)
          const payload = JSON.parse(body)
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            sendJson(res, 400, { error: 'La solicitud debe enviarse como objeto JSON.' })
            return
          }
          if (!fs.existsSync(sharedDbPath)) {
            sendJson(res, 404, { error: 'La base de datos aun no esta inicializada.' })
            return
          }

          const state = JSON.parse(fs.readFileSync(sharedDbPath, 'utf8'))
          const { state: nextState, contract } = patchContractEconomicLedger(
            state,
            decodeURIComponent(economicLedgerMatch[1]),
            payload,
          )
          fs.writeFileSync(sharedDbPath, JSON.stringify(nextState, null, 2), 'utf8')
          server.config.logger.info(
            `[economic-ledger] Guardado local: contrato ${contract?.contractCode ?? contract?.id ?? 'desconocido'}, filas ${contract?.economicLedger?.length ?? 0}, primer monto ${contract?.economicLedger?.[0]?.amountBs ?? 0}`,
          )
          sendJson(res, 200, {
            ok: true,
            contract,
            revision: getSharedDbRevision(),
            updatedAt: fs.statSync(sharedDbPath).mtime.toISOString(),
          })
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
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    define: {
      'import.meta.env.APP_INTERNAL_KEY': JSON.stringify(env.APP_INTERNAL_KEY ?? ''),
      'import.meta.env.RESET_SECURITY_CODE': JSON.stringify(env.RESET_SECURITY_CODE ?? ''),
    },
    server: {
      watch: {
        ignored: [
          '**/data/**',
          '**/*.write-backup',
          '**/*.tmp',
        ],
      },
    },
    plugins: [react(), sharedDemoDbPlugin(env)],
  }
})
