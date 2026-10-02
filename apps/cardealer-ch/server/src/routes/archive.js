import { listArchive, verifyArchived } from '../services/archive-browser.js'
import { getArchivedPdf } from '../services/archive.js'
import { withTenant } from '@tiff/core-db'

/** Belegarchiv: Liste, Integritätsprüfung und das archivierte PDF eines Dokuments (Verträge; Rechnungen/Mahnungen haben eigene Wege). */
export async function registerArchiveRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.get('/api/archive', auth, async (request) => ({ ok: true, data: await listArchive(request.tenantId) }))

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
