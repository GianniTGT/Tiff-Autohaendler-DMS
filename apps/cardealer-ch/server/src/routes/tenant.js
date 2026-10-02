import { canEditCompanySettings } from '@tiff/core-auth'
import { getTenantSettings, updateTenantSettings } from '../services/tenant-settings.js'
import { setLogo, getLogo, removeLogo } from '../services/tenant-logo.js'

export async function registerTenantRoutes(app) {
  app.get('/api/tenant', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: { ...(await getTenantSettings(request.tenantId)), canEdit: canEditCompanySettings(request.role) },
  }))

  app.patch('/api/tenant', { preHandler: app.requireAuth }, async (request, reply) => {
    if (!canEditCompanySettings(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Nur der Inhaber darf die Betriebsdaten ändern.' })
    }
    try {
      return { ok: true, data: await updateTenantSettings(request.tenantId, request.body ?? {}) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.get('/api/tenant/logo', { preHandler: app.requireAuth }, async (request, reply) => {
    const logo = await getLogo(request.tenantId)
    if (!logo) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    reply.type(logo.contentType)
    reply.header('Cache-Control', 'private, no-cache')
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(logo.buffer)
  })

  app.post('/api/tenant/logo', { preHandler: app.requireAuth }, async (request, reply) => {
    if (!canEditCompanySettings(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Nur der Inhaber darf das Logo ändern.' })
    }
    try {
      return reply.code(201).send({ ok: true, data: await setLogo(request.tenantId, request.body) })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.delete('/api/tenant/logo', { preHandler: app.requireAuth }, async (request, reply) => {
    if (!canEditCompanySettings(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Nur der Inhaber darf das Logo ändern.' })
    }
    return { ok: true, removed: await removeLogo(request.tenantId) }
  })
}
