import { canSeeCompanyTotals } from '@tiff/core-auth'
import { listArchive, verifyArchived, createArchiveExport } from '../services/archive-browser.js'
import { getArchivedPdf, archiveIfComplete, archivePdf } from '../services/archive.js'
import { getInvoice } from '../services/invoices.js'
import { getReminder } from '../services/reminders.js'
import { getCreditNote } from '../services/credit-notes.js'
import { getSalesDocument } from '../services/sales-documents.js'
import { renderInvoicePdfBuffer, renderReminderPdfBuffer, renderCreditNotePdfBuffer, renderSalesDocumentPdfBuffer, withLogo } from '../services/invoice-pdf.js'
import { withTenant } from '@tiff/core-db'

/** Belegarchiv: Liste, Integritätsprüfung und das archivierte PDF eines Dokuments (Verträge; Rechnungen/Mahnungen haben eigene Wege). */
export async function registerArchiveRoutes(app) {
  const auth = { preHandler: [app.requireAuth, app.requireBilling] }

  app.get('/api/archive', auth, async (request) => ({ ok: true, data: await listArchive(request.tenantId) }))

  app.get('/api/archive/export.zip', auth, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Der Archiv-Export ist nur für Inhaber und Buchhaltung.' })
    }
    // Als Datenstrom: auch ein Archiv mit tausenden PDFs belegt nie mehr Speicher als eine Datei.
    const { stream } = await createArchiveExport(request.tenantId)
    reply.type('application/zip')
    reply.header('Content-Disposition', `attachment; filename="belegarchiv-${new Date().toISOString().slice(0, 10)}.zip"`)
    return reply.send(stream)
  })

  /** "Jetzt archivieren": legt Rechnung oder Mahnung ab, wenn sie vollständig ist, und sagt sonst, was fehlt. */
  app.post('/api/documents/:id/archive', auth, async (request, reply) => {
    const row = await withTenant(request.tenantId, async (client) =>
      (await client.query('SELECT type, pdf_hash FROM documents WHERE id = $1', [request.params.id])).rows[0],
    )
    if (!row) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    if (row.pdf_hash) return { ok: true, data: { archived: true } }
    if (!['invoice', 'reminder', 'credit_note', 'offer', 'order', 'delivery_note'].includes(row.type)) {
      return reply.code(400).send({ ok: false, error: 'Dieser Beleg kann nicht nachträglich archiviert werden.' })
    }
    const sales = ['offer', 'order', 'delivery_note'].includes(row.type)
    const load = sales ? getSalesDocument : { invoice: getInvoice, reminder: getReminder, credit_note: getCreditNote }[row.type]
    const render = sales ? renderSalesDocumentPdfBuffer : { invoice: renderInvoicePdfBuffer, reminder: renderReminderPdfBuffer, credit_note: renderCreditNotePdfBuffer }[row.type]
    const document = await withLogo(request.tenantId, await load(request.tenantId, request.params.id))
    // Offerte, Auftrag und Lieferschein brauchen keinen QR-Zahlteil: nur Rechnung und Mahnung werden darauf geprüft.
    if (sales || row.type === 'credit_note') {
      try {
        await archivePdf(request.tenantId, { documentId: document.id, userId: request.userId, pdfBuffer: await render(document) })
        return { ok: true, data: { archived: true } }
      } catch (err) {
        return { ok: true, data: { archived: false, reason: err.message } }
      }
    }
    return { ok: true, data: await archiveIfComplete(request.tenantId, request.userId, document, render) }
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
