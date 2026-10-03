import { canSeeCompanyTotals } from '@tiff/core-auth'
import { createCreditNote, getCreditNote, listCreditNotes } from '../services/credit-notes.js'
import { createInvoice, getInvoice, listInvoices, listRemindersForInvoice } from '../services/invoices.js'
import { renderInvoicePdfBuffer, renderReminderPdfBuffer, renderCreditNotePdfBuffer, withLogo, describeMissingQrBillData } from '../services/invoice-pdf.js'
import { archivePdf, getArchivedPdf, archiveIfComplete, ArchiveIntegrityError } from '../services/archive.js'
import { recordPayment, listPayments } from '../services/payments.js'
import { importCamt054 } from '../services/camt054-import.js'
import { listOverdueInvoices, createReminder, getReminder } from '../services/reminders.js'
import { computeVatReport } from '../services/vat-report.js'
import { clientMessage } from './http-errors.js'

export async function registerInvoiceRoutes(app) {
  const billing = { preHandler: [app.requireAuth, app.requireBilling] }
  app.get('/api/invoices', billing, async (request) => ({
    ok: true,
    data: await listInvoices(request.tenantId),
  }))

  app.post('/api/invoices', billing, async (request, reply) => {
    try {
      const invoice = await createInvoice(request.tenantId, request.body ?? {})
      // Der ausgestellte Beleg wird sofort abgelegt, wenn er vollständig ist (archive.js).
      const archive = await archiveIfComplete(
        request.tenantId,
        request.userId,
        await withLogo(request.tenantId, await getInvoice(request.tenantId, invoice.id)),
        renderInvoicePdfBuffer,
      )
      return reply.code(201).send({ ok: true, data: { ...invoice, archive } })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/invoices/:id', billing, async (request, reply) => {
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
      buffer = await render(await withLogo(request.tenantId, document))
      // Ein unvollständiger Beleg (keine QR-IBAN, Adresse fehlt) wird angezeigt, aber nicht festgeschrieben:
      // sonst friert der Abruf genau den Mangel ein, den archiveIfComplete() vermeiden soll.
      if (describeMissingQrBillData(document.tenant, document.party, document)) {
        reply.type('application/pdf')
        reply.header('Content-Disposition', `inline; filename="${document.number}.pdf"`)
        return reply.send(buffer)
      }
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

  app.get('/api/invoices/:id/pdf', billing, async (request, reply) =>
    sendArchivedPdf(request, reply, await getInvoice(request.tenantId, request.params.id), renderInvoicePdfBuffer),
  )

  app.get('/api/reminders/:id/pdf', billing, async (request, reply) =>
    sendArchivedPdf(request, reply, await getReminder(request.tenantId, request.params.id), renderReminderPdfBuffer),
  )

  app.get('/api/credit-notes/:id/pdf', billing, async (request, reply) =>
    sendArchivedPdf(request, reply, await getCreditNote(request.tenantId, request.params.id), renderCreditNotePdfBuffer),
  )

  app.get('/api/invoices/:id/credit-notes', billing, async (request) => ({
    ok: true,
    data: await listCreditNotes(request.tenantId, request.params.id),
  }))

  // Gutschriften mindern den Umsatz: nur wer Firmenzahlen sieht (Inhaber, Buchhaltung), stellt sie aus.
  app.post('/api/invoices/:id/credit-notes', billing, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Gutschriften stellen nur Inhaber und Buchhaltung aus.' })
    }
    try {
      const creditNote = await createCreditNote(request.tenantId, request.userId, request.params.id, request.body ?? {})
      return creditNote ? reply.code(201).send({ ok: true, data: creditNote }) : reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    } catch (err) {
      return reply.code(err.statusCode ?? 400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/invoices/:id/reminders', billing, async (request) => ({
    ok: true,
    data: await listRemindersForInvoice(request.tenantId, request.params.id),
  }))

  app.get('/api/invoices/:id/payments', billing, async (request) => ({
    ok: true,
    data: await listPayments(request.tenantId, request.params.id),
  }))

  app.post('/api/invoices/:id/payments', billing, async (request, reply) => {
    try {
      const result = await recordPayment(request.tenantId, { ...request.body, documentId: request.params.id })
      return reply.code(201).send({ ok: true, data: result })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.post('/api/payments/camt054', billing, async (request, reply) => {
    const xml = request.body?.xml
    if (!xml) return reply.code(400).send({ ok: false, error: 'MISSING_XML' })
    try {
      const results = await importCamt054(request.tenantId, xml)
      return { ok: true, data: results }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/invoices-overdue', billing, async (request) => ({
    ok: true,
    data: await listOverdueInvoices(request.tenantId, request.query.asOf),
  }))

  app.post('/api/invoices/:id/reminders', billing, async (request, reply) => {
    try {
      const reminder = await createReminder(request.tenantId, {
        invoiceId: request.params.id,
        asOfDate: request.body?.asOfDate,
      })
      const archive = await archiveIfComplete(
        request.tenantId,
        request.userId,
        await withLogo(request.tenantId, await getReminder(request.tenantId, reminder.id)),
        renderReminderPdfBuffer,
      )
      return reply.code(201).send({ ok: true, data: { ...reminder, archive } })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/reminders/:id', billing, async (request, reply) => {
    const reminder = await getReminder(request.tenantId, request.params.id)
    if (!reminder) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: reminder }
  })

  app.get('/api/reports/vat', billing, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) {
      return reply.code(403).send({ ok: false, error: 'Die MWST-Auswertung ist nur für Inhaber und Buchhaltung sichtbar.' })
    }
    try {
      const report = await computeVatReport(request.tenantId, { from: request.query.from, to: request.query.to })
      return { ok: true, data: report }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })
}
