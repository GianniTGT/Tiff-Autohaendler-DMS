/**
 * Integrationstest gegen echtes PostgreSQL — Zahlungen, Restbetrag,
 * automatisches Schliessen der Rechnung. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { recordPayment, getOutstandingAmount, listPayments } from '../src/services/payments.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Zahlungen: Restbetrag, Teilzahlung, vollständige Zahlung schliesst die Rechnung', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'payments-test-' + Math.random().toString(36).slice(2, 8)
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
  const invoice = await createInvoice(tenantId, {
    partyId: party.id,
    issueDate: '2026-07-01',
    lines: [{ description: 'X', quantity: 1, unitPriceRappen: 1_000_000 }],
  })
  // total = 1'000'000 + 8.1% = 1'081'000

  await t.test('vor jeder Zahlung ist die volle Summe offen', async () => {
    const outstanding = await getOutstandingAmount(tenantId, invoice.id)
    assert.equal(outstanding, 1_081_000)
  })

  await t.test('eine Teilzahlung reduziert den Restbetrag, schliesst die Rechnung aber nicht', async () => {
    const { outstandingRappen } = await recordPayment(tenantId, {
      documentId: invoice.id,
      amountRappen: 500_000,
      paidAt: '2026-07-10',
    })
    assert.equal(outstandingRappen, 581_000)
    const statusResult = await adminPool.query('SELECT status FROM documents WHERE id = $1', [invoice.id])
    assert.equal(statusResult.rows[0].status, 'issued')
  })

  await t.test('die restliche Zahlung schliesst die Rechnung (status = paid)', async () => {
    const { outstandingRappen } = await recordPayment(tenantId, {
      documentId: invoice.id,
      amountRappen: 581_000,
      paidAt: '2026-07-15',
    })
    assert.equal(outstandingRappen, 0)
    const statusResult = await adminPool.query('SELECT status FROM documents WHERE id = $1', [invoice.id])
    assert.equal(statusResult.rows[0].status, 'paid')
  })

  await t.test('listPayments zeigt beide Zahlungen in der richtigen Reihenfolge', async () => {
    const payments = await listPayments(tenantId, invoice.id)
    assert.equal(payments.length, 2)
    assert.equal(payments[0].amount_rappen, '500000')
    assert.equal(payments[1].amount_rappen, '581000')
  })

  await t.test('recordPayment ohne Pflichtfelder wird abgelehnt', async () => {
    await assert.rejects(() => recordPayment(tenantId, { documentId: invoice.id }))
  })
})
