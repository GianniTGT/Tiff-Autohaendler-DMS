import { canSeeCompanyTotals } from '@tiff/core-auth'
import { createInvoice, getInvoice, listInvoices, listRemindersForInvoice } from '../services/invoices.js'
import { renderInvoicePdfBuffer, renderReminderPdfBuffer } from '../services/invoice-pdf.js'
import { archivePdf, getArchivedPdf, ArchiveIntegrityError } from '../services/archive.js'
import { recordPayment, listPayments } from '../services/payments.js'
import { importCamt054 } from '../services/camt054-import.js'
import { listOverdueInvoices, createReminder, getReminder } from '../services/reminders.js'
import { computeVatReport } from '../services/vat-report.js'

export async function registerInvoiceRoutes(app) {
  app.get('/api/invoices', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await listInvoices(request.tenantId),
  }))

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

  // Rechnung und Mahnung teilen sich den Weg: einmal archiviert, kommt das PDF
  // beim nächsten Abruf aus dem Speicher, nie aus einer erneuten Erzeugung
  // (archive.js: PDF-Rendering-Code darf sich ändern, ohne dass historische
  // Belege sich dadurch "ändern").
  async function sendArchivedPdf(request, reply, document, render) {
    if (!document) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    let buffer = await getArchivedPdf(request.tenantId, document.id)
    if (!buffer) {
      buffer = await render(document)
      try {
        await archivePdf(request.tenantId, { documentId: document.id, userId: request.userId, pdfBuffer: buffer })
      } catch (err) {
        if (err instanceof ArchiveIntegrityError) {
          request.log.error(err)
          return reply.code(500).send({ ok: false, error: 'ARCHIVE_INTEGRITY_MISMATCH' })
        }
        throw err
      }
    }
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${document.number}.pdf"`)
    return reply.send(buffer)
  }

  app.get('/api/invoices/:id/pdf', { preHandler: app.requireAuth }, async (request, reply) =>
    sendArchivedPdf(request, reply, await getInvoice(request.tenantId, request.params.id), renderInvoicePdfBuffer),
  )

  app.get('/api/reminders/:id/pdf', { preHandler: app.requireAuth }, async (request, reply) =>
    sendArchivedPdf(request, reply, await getReminder(request.tenantId, request.params.id), renderReminderPdfBuffer),
  )

  app.get('/api/invoices/:id/reminders', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await listRemindersForInvoice(request.tenantId, request.params.id),
  }))

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
    if (!canSeeCompanyTotals(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Die MWST-Auswertung ist nur für Inhaber und Buchhaltung sichtbar.' })
    }
    try {
      const report = await computeVatReport(request.tenantId, { from: request.query.from, to: request.query.to })
      return { ok: true, data: report }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })
}
