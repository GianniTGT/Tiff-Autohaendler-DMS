/**
 * Gutschriften gegen echtes PostgreSQL: Voll-/Teilgutschrift, Obergrenzen,
 * Wirkung auf Restbetrag/Mahnwesen/MWST-Auswertung, Archiv, Trigger,
 * Mandantentrennung und Rollen über HTTP. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-credit-'))

const { closePool, withTenant } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createInvoice, listInvoices } = await import('../src/services/invoices.js')
const { createParty } = await import('../src/services/parties.js')
const { createCreditNote, listCreditNotes, getCreditNote } = await import('../src/services/credit-notes.js')
const { recordPayment, listPayments } = await import('../src/services/payments.js')
const { createReminder, listOverdueInvoices } = await import('../src/services/reminders.js')
const { computeVatReport } = await import('../src/services/vat-report.js')
const { verifyArchived, listArchive, buildArchiveExport } = await import('../src/services/archive-browser.js')

test('Gutschriften', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mk = async (name) => {
    const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`
    const id = (
      await adminPool.query(
        `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city, vat_method)
         VALUES (gen_random_uuid(), $1, $1 || ' AG', $2, 'Weg 1', '3000', 'Bern', 'effective') RETURNING id`,
        [name, slug],
      )
    ).rows[0].id
    return { id, slug }
  }
  const A = await mk('credit-a')
  const B = await mk('credit-b')
  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    await app.close()
    for (const { id } of [A, B]) {
      await adminPool.query('DELETE FROM payments WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [id])
      await adminPool.query('UPDATE documents SET predecessor_id = NULL WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [id])
      for (const table of ['number_sequences', 'parties', 'sessions', 'users']) await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const party = await createParty(A.id, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const year = new Date().getFullYear()
  const newInvoice = (net = 1_000_000, over = {}) =>
    createInvoice(A.id, { partyId: party.id, issueDate: `${year}-01-10`, dueDate: `${year}-02-10`, lines: [{ description: 'Fahrzeug', quantity: 1, unitPriceRappen: net }], ...over })
  const row = async (id) => (await listInvoices(A.id)).find((r) => r.id === id)

  await t.test('Vollgutschrift: eigene Nummer, gleiche Beträge und MWST, verrechnet, archiviert', async () => {
    const invoice = await newInvoice()
    const total = Number(invoice.total_rappen)
    const credit = await createCreditNote(A.id, null, invoice.id, { reason: 'Fahrzeug zurückgegeben', mode: 'full' })

    assert.equal(credit.number, `GS-${year}-00001`)
    assert.equal(credit.type, 'credit_note')
    assert.equal(Number(credit.total_rappen), total)
    assert.equal(Number(credit.vat_rappen), Number(invoice.vat_rappen))
    assert.equal(credit.predecessor_id, invoice.id)
    assert.equal(credit.note, 'Fahrzeug zurückgegeben')
    assert.equal(credit.invoiceNumber, invoice.number)
    assert.equal(credit.lines.length, 1)
    assert.equal(credit.lines[0].description, 'Fahrzeug')
    assert.deepEqual(credit.archive, { archived: true })

    const after = await row(invoice.id)
    assert.equal(after.outstanding_rappen, 0)
    assert.equal(after.status, 'paid')
    assert.equal(after.credited_rappen, String(total))
    const payments = await listPayments(A.id, invoice.id)
    assert.deepEqual(payments.map((p) => [p.source, p.credit_note_id]), [['credit_note', credit.id]])

    assert.equal((await verifyArchived(A.id, credit.id)).ok, true)
    assert.equal((await listCreditNotes(A.id, invoice.id))[0].reason, 'Fahrzeug zurückgegeben')
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'nochmal', mode: 'full' }), /bereits vollständig gutgeschrieben/)
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'nochmal', mode: 'partial', amountRappen: 100 }), /bereits vollständig gutgeschrieben/)
  })

  await t.test('Teilgutschriften: MWST im Verhältnis, Obergrenze, danach keine Vollgutschrift mehr', async () => {
    const invoice = await newInvoice(1_000_000)
    const total = Number(invoice.total_rappen) // 1'081'000 bei 8.1 %
    const vat = Number(invoice.vat_rappen)

    const first = await createCreditNote(A.id, null, invoice.id, { reason: 'Preisnachlass', mode: 'partial', amountRappen: 200_000 })
    assert.equal(Number(first.total_rappen), 200_000)
    assert.equal(Number(first.vat_rappen), Math.round((200_000 * vat) / total))
    assert.equal(Number(first.subtotal_rappen) + Number(first.vat_rappen), 200_000)
    assert.equal(first.lines[0].description.startsWith('Teilgutschrift zu Rechnung'), true)
    assert.equal((await row(invoice.id)).outstanding_rappen, total - 200_000)
    assert.equal((await row(invoice.id)).status, 'issued', 'noch nicht ausgeglichen')

    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'x', mode: 'full' }), /teilweise gutgeschrieben/)
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'x', mode: 'partial', amountRappen: total - 200_000 + 1 }), /übersteigt/)

    const rest = await createCreditNote(A.id, null, invoice.id, { reason: 'Rest', mode: 'partial', amountRappen: total - 200_000 })
    assert.equal((await row(invoice.id)).outstanding_rappen, 0)
    assert.equal((await row(invoice.id)).status, 'paid')
    const sum = (await listCreditNotes(A.id, invoice.id)).reduce((s, c) => s + c.totalRappen, 0)
    assert.equal(sum, total, 'die Gutschriften ergeben genau die Rechnung')
    assert.equal(Number(first.vat_rappen) + Number(rest.vat_rappen) >= vat - 1 && Number(first.vat_rappen) + Number(rest.vat_rappen) <= vat + 1, true, 'MWST-Summe bis auf Rundung gleich')
  })

  await t.test('Eingaben werden geprüft', async () => {
    const invoice = await newInvoice()
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { mode: 'full' }), /Grund/)
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: '  ', mode: 'full' }), /Grund/)
    await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'x', mode: 'halb' }), /Art der Gutschrift/)
    for (const bad of [0, -5, 10.5, '100', undefined]) {
      await assert.rejects(createCreditNote(A.id, null, invoice.id, { reason: 'x', mode: 'partial', amountRappen: bad }), /ganze Zahl/, String(bad))
    }
    assert.equal(await createCreditNote(A.id, null, '00000000-0000-0000-0000-000000000000', { reason: 'x', mode: 'full' }), null)
    assert.equal((await listCreditNotes(A.id, invoice.id)).length, 0, 'abgelehnte Eingaben haben nichts erzeugt')
    assert.equal((await row(invoice.id)).outstanding_rappen, Number(invoice.total_rappen))
  })

  await t.test('Bereits bezahlte Rechnung gutschreiben: Restbetrag bleibt 0, nie negativ angezeigt', async () => {
    const invoice = await newInvoice(500_000)
    const total = Number(invoice.total_rappen)
    await recordPayment(A.id, { documentId: invoice.id, amountRappen: total, paidAt: `${year}-01-20` })
    await createCreditNote(A.id, null, invoice.id, { reason: 'Rückerstattung', mode: 'partial', amountRappen: 100_000 })
    const after = await row(invoice.id)
    assert.equal(after.outstanding_rappen, 0, 'Überzahlung wird nicht als negativer Restbetrag gezeigt')
    assert.equal(after.credited_rappen, '100000')
  })

  await t.test('Mahnwesen: eine voll gutgeschriebene Rechnung ist nicht mehr überfällig und nicht mehr mahnbar', async () => {
    const invoice = await newInvoice(800_000)
    assert.ok((await listOverdueInvoices(A.id, `${year}-06-01`)).some((i) => i.id === invoice.id), 'vorher überfällig')
    await createCreditNote(A.id, null, invoice.id, { reason: 'Storno', mode: 'full' })
    assert.equal((await listOverdueInvoices(A.id, `${year}-06-01`)).some((i) => i.id === invoice.id), false)
    await assert.rejects(createReminder(A.id, { invoiceId: invoice.id, asOfDate: `${year}-06-01` }), /bereits vollständig bezahlt/)

    // Teilgutschrift: Mahnung nur noch über den Rest
    const partial = await newInvoice(800_000)
    await createCreditNote(A.id, null, partial.id, { reason: 'Nachlass', mode: 'partial', amountRappen: 300_000 })
    const reminder = await createReminder(A.id, { invoiceId: partial.id, asOfDate: `${year}-06-01` })
    assert.equal(reminder.outstandingRappen, Number(partial.total_rappen) - 300_000)
  })

  await t.test('MWST-Auswertung: Gutschrift mindert Steuer und Umsatz in der Periode, in der sie ausgestellt wurde', async () => {
    const isolated = await mk('credit-vat')
    const p = await createParty(isolated.id, { kind: 'person', firstName: 'V', lastName: 'M', addressStreet: 'W 1', addressZip: '8000', addressCity: 'Z' })
    const inv = await createInvoice(isolated.id, { partyId: p.id, issueDate: '2025-03-01', lines: [{ description: 'x', quantity: 1, unitPriceRappen: 1_000_000 }] })
    const vatBefore = await computeVatReport(isolated.id, { from: '2025-01-01', to: '2025-12-31' })
    assert.equal(vatBefore.outputTaxRappen, Number(inv.vat_rappen))
    assert.equal(vatBefore.creditTotalRappen, 0)

    await createCreditNote(isolated.id, null, inv.id, { reason: 'Storno', mode: 'full' })
    const wholeRange = await computeVatReport(isolated.id, { from: '2025-01-01', to: '2099-12-31' })
    assert.equal(wholeRange.outputTaxRappen, 0, 'über beide Perioden hebt sich die Steuer auf')
    assert.equal(wholeRange.totalRevenueRappen, 0)
    assert.equal(wholeRange.creditTotalRappen, Number(inv.total_rappen))

    const periodOfCredit = await computeVatReport(isolated.id, { from: `${year}-01-01`, to: `${year}-12-31` })
    assert.equal(periodOfCredit.outputTaxRappen, -Number(inv.vat_rappen), 'in der Periode der Gutschrift negativ')
    assert.equal(periodOfCredit.creditVatRappen, Number(inv.vat_rappen))
    assert.equal((await computeVatReport(isolated.id, { from: '2025-01-01', to: '2025-12-31' })).outputTaxRappen, Number(inv.vat_rappen), 'die frühere Periode bleibt unverändert')

    await adminPool.query('DELETE FROM payments WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [isolated.id])
    await adminPool.query('UPDATE documents SET predecessor_id = NULL WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [isolated.id])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [isolated.id])
  })

  await t.test('Archiv: Gutschrift erscheint, ist nicht löschbar, Export enthält den Ordner; Mandant B sieht nichts', async () => {
    const credit = (await listArchive(A.id)).find((r) => r.type === 'credit_note')
    assert.ok(credit)
    assert.equal(credit.archived, true)
    await assert.rejects(withTenant(A.id, (c) => c.query('DELETE FROM documents WHERE id = $1', [credit.id])), /nicht gelöscht werden/)
    const { zip } = await buildArchiveExport(A.id)
    assert.ok(zip.includes(Buffer.from(`Gutschriften/${credit.number}.pdf`)))

    assert.deepEqual(await listArchive(B.id), [])
    const invoice = await newInvoice()
    assert.equal(await createCreditNote(B.id, null, invoice.id, { reason: 'fremd', mode: 'full' }), null)
    assert.equal(await getCreditNote(B.id, credit.id), null)
    assert.deepEqual(await listCreditNotes(B.id, invoice.id), [])
  })

  await t.test('Über HTTP: nur Inhaber und Buchhaltung; Werkstatt und Verkauf nicht; PDF kommt aus dem Archiv', async () => {
    const cookies = {}
    for (const [role, pw] of [['inhaber', 'ChefPasswort123'], ['buchhaltung', 'BuchPasswort1234'], ['verkauf', 'VerkaufPasswort1'], ['werkstatt', 'WerkstattPass123']]) {
      await createUser({ tenantId: A.id, email: `${role}@credit.ch`, name: role, password: pw, role })
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: A.slug, email: `${role}@credit.ch`, password: pw } })
      cookies[role] = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    }
    const call = (role, method, url, payload) => app.inject({ method, url, headers: { cookie: cookies[role] }, payload })
    const invoice = await newInvoice(300_000)
    const url = `/api/invoices/${invoice.id}/credit-notes`

    assert.equal((await call('werkstatt', 'POST', url, { reason: 'x', mode: 'full' })).statusCode, 403)
    assert.equal((await call('verkauf', 'POST', url, { reason: 'x', mode: 'full' })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url, payload: { reason: 'x', mode: 'full' } })).statusCode, 401)
    assert.equal((await call('buchhaltung', 'POST', url, { reason: '', mode: 'full' })).statusCode, 400)
    assert.equal((await call('inhaber', 'POST', `/api/invoices/keine-uuid/credit-notes`, { reason: 'x', mode: 'full' })).statusCode, 400)

    const created = await call('buchhaltung', 'POST', url, { reason: 'Kulanz', mode: 'partial', amountRappen: 50_000 })
    assert.equal(created.statusCode, 201)
    assert.equal(created.json().data.archive.archived, true)
    const id = created.json().data.id

    const pdf = await call('verkauf', 'GET', `/api/credit-notes/${id}/pdf`)
    assert.equal(pdf.statusCode, 200)
    assert.equal(pdf.headers['content-type'], 'application/pdf')
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-')
    assert.equal((await call('werkstatt', 'GET', `/api/credit-notes/${id}/pdf`)).statusCode, 403)
    assert.equal((await call('verkauf', 'GET', url)).json().data.length, 1, 'Verkauf darf lesen, nicht ausstellen')

    const tooMuch = await call('inhaber', 'POST', url, { reason: 'x', mode: 'partial', amountRappen: 10_000_000 })
    assert.equal(tooMuch.statusCode, 400)
    assert.match(tooMuch.json().error, /übersteigt/)
  })
})
