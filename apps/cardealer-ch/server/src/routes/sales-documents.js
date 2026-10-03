import {
  createSalesDocument,
  convertSalesDocument,
  setSalesDocumentStatus,
  getSalesDocument,
  listSalesDocuments,
} from '../services/sales-documents.js'
import { renderSalesDocumentPdfBuffer, withLogo } from '../services/invoice-pdf.js'
import { archivePdf, getArchivedPdf } from '../services/archive.js'
import { clientMessage } from './http-errors.js'

/**
 * Belegkette Offerte → Auftrag → Lieferschein → Rechnung. Wie das ganze Rechnungswesen nicht für die Werkstatt
 * (roles.js: canBill); der Server prüft das hier selbst, die Oberfläche blendet es nur aus.
 */
export async function registerSalesDocumentRoutes(app) {
  const billing = { preHandler: [app.requireAuth, app.requireBilling] }
  const fail = (reply, err) => reply.code(err.statusCode ?? 400).send({ ok: false, error: clientMessage(err) })
  const notFound = (reply) => reply.code(404).send({ ok: false, error: 'NOT_FOUND' })

  app.get('/api/sales-documents', billing, async (request, reply) => {
    try {
      return { ok: true, data: await listSalesDocuments(request.tenantId, { type: request.query.type }) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/sales-documents/:id', billing, async (request, reply) => {
    const doc = await getSalesDocument(request.tenantId, request.params.id)
    if (!doc) return notFound(reply)
    const { tenant, ...rest } = doc // der Betrieb gehört nicht in die Antwort (QR-IBAN, Zugangsdaten)
    return { ok: true, data: rest }
  })

  for (const [path, type] of [['/api/offers', 'offer'], ['/api/orders', 'order']]) {
    app.post(path, billing, async (request, reply) => {
      try {
        const doc = await createSalesDocument(request.tenantId, request.userId, type, request.body ?? {})
        const { tenant, ...rest } = doc
        return reply.code(201).send({ ok: true, data: rest })
      } catch (err) {
        return fail(reply, err)
      }
    })
  }

  app.post('/api/sales-documents/:id/convert', billing, async (request, reply) => {
    try {
      const doc = await convertSalesDocument(request.tenantId, request.userId, request.params.id, request.body?.to, { note: request.body?.note })
      if (!doc) return notFound(reply)
      const { tenant, ...rest } = doc
      return reply.code(201).send({ ok: true, data: rest })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/sales-documents/:id/status', billing, async (request, reply) => {
    try {
      const doc = await setSalesDocumentStatus(request.tenantId, request.params.id, request.body?.status)
      if (!doc) return notFound(reply)
      const { tenant, ...rest } = doc
      return { ok: true, data: rest }
    } catch (err) {
      return fail(reply, err)
    }
  })

  // Wie bei Rechnungen: einmal archiviert, kommt das PDF immer aus dem Speicher.
  app.get('/api/sales-documents/:id/pdf', billing, async (request, reply) => {
    const doc = await getSalesDocument(request.tenantId, request.params.id)
    if (!doc) return notFound(reply)
    let buffer = await getArchivedPdf(request.tenantId, doc.id)
    if (!buffer) {
      buffer = await renderSalesDocumentPdfBuffer(await withLogo(request.tenantId, doc))
      await archivePdf(request.tenantId, { documentId: doc.id, userId: request.userId, pdfBuffer: buffer })
    }
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${doc.number}.pdf"`)
    return reply.send(buffer)
  })
}
