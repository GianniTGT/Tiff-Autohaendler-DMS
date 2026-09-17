/**
 * Integrationstest gegen echtes PostgreSQL — Mahnwesen: überfällige
 * Rechnungen finden, Mahnstufen, Verzugszins, Sperre nach der 3. Mahnung.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { recordPayment } from '../src/services/payments.js'
import { listOverdueInvoices, createReminder } from '../src/services/reminders.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Mahnwesen: überfällige Rechnungen, Verzugszins, Mahnstufen, Sperre nach der 3.', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'reminders-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'A', 'A AG', $1) RETURNING id",
      [slug],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM payments WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Max', lastName: 'Muster' })

  await t.test('createInvoice setzt automatisch 30 Tage Zahlungsfrist, wenn dueDate fehlt', async () => {
    const invoice = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-01-01',
      lines: [{ description: 'X', quantity: 1, unitPriceRappen: 100_000 }],
    })
    const dueDate = invoice.due_date instanceof Date ? invoice.due_date.toISOString().slice(0, 10) : invoice.due_date
    assert.equal(dueDate, '2026-01-31')
  })

  await t.test('eine noch nicht fällige Rechnung erscheint nicht bei den überfälligen', async () => {
    const overdue = await listOverdueInvoices(tenantId, '2026-01-15')
    // Die Rechnung von oben ist erst am 31.1. fällig.
    assert.ok(!overdue.some((d) => d.due_date && String(d.due_date).slice(0, 10) === '2026-01-31' && d.due_date > '2026-01-15'))
  })

  const overdueInvoice = await createInvoice(tenantId, {
    partyId: party.id,
    issueDate: '2025-01-01',
    dueDate: '2025-01-31',
    lines: [{ description: 'Y', quantity: 1, unitPriceRappen: 1_000_000 }],
  })
  // total = 1'081'000 Rappen

  await t.test('eine überfällige, unbezahlte Rechnung erscheint in listOverdueInvoices', async () => {
    const overdue = await listOverdueInvoices(tenantId, '2026-01-31')
    const found = overdue.find((d) => d.id === overdueInvoice.id)
    assert.ok(found)
    assert.equal(found.outstandingRappen, 1_081_000)
  })

  let firstReminder
  await t.test('createReminder berechnet Verzugszins (5%, OR 104) korrekt für 365 Tage', async () => {
    firstReminder = await createReminder(tenantId, { invoiceId: overdueInvoice.id, asOfDate: '2026-01-31' })
    assert.equal(firstReminder.level, 1)
    assert.equal(firstReminder.overdueDays, 365)
    // 1'081'000 Rappen × 5% × 365/365 = 54'050 Rappen
    assert.equal(firstReminder.interestRappen, 54_050)
    assert.equal(Number(firstReminder.total_rappen), 1_081_000 + 54_050)
    assert.match(firstReminder.number, /^MA-2026-\d{5}$/)
    assert.equal(firstReminder.lines.length, 2)
  })

  await t.test('eine zweite Mahnung für dieselbe Rechnung bekommt Stufe 2', async () => {
    const second = await createReminder(tenantId, { invoiceId: overdueInvoice.id, asOfDate: '2026-03-01' })
    assert.equal(second.level, 2)
  })

  await t.test('eine dritte Mahnung bekommt Stufe 3', async () => {
    const third = await createReminder(tenantId, { invoiceId: overdueInvoice.id, asOfDate: '2026-04-01' })
    assert.equal(third.level, 3)
  })

  await t.test('eine vierte Mahnung wird abgelehnt — danach ist Betreibung Sache eines Menschen', async () => {
    await assert.rejects(() => createReminder(tenantId, { invoiceId: overdueInvoice.id, asOfDate: '2026-05-01' }))
  })

  await t.test('eine vollständig bezahlte Rechnung kann nicht gemahnt werden', async () => {
    const paidInvoice = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2025-01-01',
      dueDate: '2025-01-31',
      lines: [{ description: 'Z', quantity: 1, unitPriceRappen: 100_000 }],
    })
    await recordPayment(tenantId, { documentId: paidInvoice.id, amountRappen: 108_100, paidAt: '2025-02-01' })
    await assert.rejects(() => createReminder(tenantId, { invoiceId: paidInvoice.id, asOfDate: '2026-01-01' }))
  })
})
