import { createInvoice, getInvoice } from '../services/invoices.js'
import { renderInvoicePdf } from '../services/invoice-pdf.js'

export async function registerInvoiceRoutes(app) {
  app.post('/api/invoices', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const invoice = await createInvoice(request.tenantId, request.body ?? {})
      return reply.code(201).send({ ok: true, data: invoice })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.get('/api/invoices/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const invoice = await getInvoice(request.tenantId, request.params.id)
    if (!invoice) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: invoice }
  })

  app.get('/api/invoices/:id/pdf', { preHandler: app.requireAuth }, async (request, reply) => {
    const invoice = await getInvoice(request.tenantId, request.params.id)
    if (!invoice) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })

    const doc = renderInvoicePdf(invoice)
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${invoice.number}.pdf"`)
    reply.send(doc)
    doc.end()
    return reply
  })
}
