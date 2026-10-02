import { canEditCompanySettings } from '@tiff/core-auth'
import { getTenantSettings, updateTenantSettings } from '../services/tenant-settings.js'

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
}
