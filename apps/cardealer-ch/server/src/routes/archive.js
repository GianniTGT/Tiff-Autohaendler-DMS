import { canSeeCompanyTotals } from '@tiff/core-auth'
import { listArchive, verifyArchived, buildArchiveExport } from '../services/archive-browser.js'
import { getArchivedPdf } from '../services/archive.js'
import { withTenant } from '@tiff/core-db'

/** Belegarchiv: Liste, Integritätsprüfung und das archivierte PDF eines Dokuments (Verträge; Rechnungen/Mahnungen haben eigene Wege). */
export async function registerArchiveRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.get('/api/archive', auth, async (request) => ({ ok: true, data: await listArchive(request.tenantId) }))

  app.get('/api/archive/export.zip', auth, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Der Archiv-Export ist nur für Inhaber und Buchhaltung.' })
    }
    const { zip } = await buildArchiveExport(request.tenantId)
    reply.type('application/zip')
    reply.header('Content-Disposition', `attachment; filename="belegarchiv-${new Date().toISOString().slice(0, 10)}.zip"`)
    return reply.send(zip)
  })

  app.get('/api/documents/:id/verify', auth, async (request, reply) => {
    const result = await verifyArchived(request.tenantId, request.params.id)
    return result ? { ok: true, data: result } : reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
  })

  app.get('/api/documents/:id/pdf', auth, async (request, reply) => {
    const doc = await withTenant(request.tenantId, async (client) =>
      (await client.query('SELECT number FROM documents WHERE id = $1', [request.params.id])).rows[0],
    )
    const buffer = doc ? await getArchivedPdf(request.tenantId, request.params.id) : null
    if (!buffer) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${doc.number}.pdf"`)
    return reply.send(buffer)
  })
}
