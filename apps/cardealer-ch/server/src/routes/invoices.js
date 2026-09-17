import { createInvoice, getInvoice } from '../services/invoices.js'
import { renderInvoicePdfBuffer } from '../services/invoice-pdf.js'
import { archivePdf, getArchivedPdf, ArchiveIntegrityError } from '../services/archive.js'
import { recordPayment, listPayments } from '../services/payments.js'
import { importCamt054 } from '../services/camt054-import.js'
import { listOverdueInvoices, createReminder, getReminder } from '../services/reminders.js'
import { computeVatReport } from '../services/vat-report.js'

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

    // Schon archiviert? Dann kommt genau das PDF zurück, das damals
    // ausgestellt wurde — aus dem Objektspeicher, nicht neu gerendert (siehe
    // archive.js für den Grund: PDF-Rendering-Code darf sich ändern, ohne
    // dass historische Belege sich dadurch "ändern").
    const archived = await getArchivedPdf(request.tenantId, invoice.id)
    let buffer = archived
    if (!buffer) {
      buffer = await renderInvoicePdfBuffer(invoice)
      try {
        await archivePdf(request.tenantId, { documentId: invoice.id, userId: request.userId, pdfBuffer: buffer })
      } catch (err) {
        if (err instanceof ArchiveIntegrityError) {
          request.log.error(err)
          return reply.code(500).send({ ok: false, error: 'ARCHIVE_INTEGRITY_MISMATCH' })
        }
        throw err
      }
    }

    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${invoice.number}.pdf"`)
    return reply.send(buffer)
  })

  app.get('/api/invoices/:id/payments', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await listPayments(request.tenantId, request.params.id),
  }))

  app.post('/api/invoices/:id/payments', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const result = await recordPayment(request.tenantId, { ...request.body, documentId: request.params.id })
      return reply.code(201).send({ ok: true, data: result })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.post('/api/payments/camt054', { preHandler: app.requireAuth }, async (request, reply) => {
    const xml = request.body?.xml
    if (!xml) return reply.code(400).send({ ok: false, error: 'MISSING_XML' })
    try {
      const results = await importCamt054(request.tenantId, xml)
      return { ok: true, data: results }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.get('/api/invoices-overdue', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await listOverdueInvoices(request.tenantId, request.query.asOf),
  }))

  app.post('/api/invoices/:id/reminders', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const reminder = await createReminder(request.tenantId, {
        invoiceId: request.params.id,
        asOfDate: request.body?.asOfDate,
      })
      return reply.code(201).send({ ok: true, data: reminder })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.get('/api/reminders/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const reminder = await getReminder(request.tenantId, request.params.id)
    if (!reminder) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: reminder }
  })

  app.get('/api/reports/vat', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const report = await computeVatReport(request.tenantId, { from: request.query.from, to: request.query.to })
      return { ok: true, data: report }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })
}
