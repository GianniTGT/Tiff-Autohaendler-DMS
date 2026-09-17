/**
 * Integrationstest gegen echtes PostgreSQL — camt.054 einlesen, über die
 * QR-Referenz der richtigen Rechnung zuordnen, Zahlung buchen.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { getOutstandingAmount } from '../src/services/payments.js'
import { importCamt054 } from '../src/services/camt054-import.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

function camtXml({ reference, amount, date, creditDebitIndicator = 'CRDT' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="CHF">${amount}</Amt>
        <CdtDbtInd>${creditDebitIndicator}</CdtDbtInd>
        <ValDt><Dt>${date}</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`
}

test('camt.054-Import: Zuordnung über QR-Referenz, Idempotenz, unzuordenbare Einträge', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'camt-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, qr_iban, address_street, address_zip, address_city)
       VALUES (gen_random_uuid(), 'A', 'A AG', $1, 'CH4431999123000889012', 'Teststrasse 1', '3000', 'Bern')
       RETURNING id`,
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
    issueDate: '2026-08-01',
    lines: [{ description: 'X', quantity: 1, unitPriceRappen: 1_000_000 }],
  })
  // total = 1'081'000 Rappen = CHF 10'810.00

  await t.test('eine Gutschrift mit passender QR-Referenz schliesst die Rechnung', async () => {
    const xml = camtXml({ reference: invoice.qr_reference, amount: '10810.00', date: '2026-08-05' })
    const results = await importCamt054(tenantId, xml)
    assert.equal(results.length, 1)
    assert.equal(results[0].matched, true)
    assert.equal(results[0].documentId, invoice.id)
    assert.equal(results[0].outstandingRappen, 0)

    const outstanding = await getOutstandingAmount(tenantId, invoice.id)
    assert.equal(outstanding, 0)
  })

  await t.test('dieselbe Datei erneut eingelesen bucht nicht doppelt', async () => {
    const xml = camtXml({ reference: invoice.qr_reference, amount: '10810.00', date: '2026-08-05' })
    const results = await importCamt054(tenantId, xml)
    assert.equal(results[0].matched, false)
    assert.equal(results[0].reason, 'ALREADY_IMPORTED')

    const outstanding = await getOutstandingAmount(tenantId, invoice.id)
    assert.equal(outstanding, 0) // unverändert, keine zweite Buchung
  })

  await t.test('eine Referenz ohne passende Rechnung wird als unzuordenbar gemeldet, nie verworfen', async () => {
    const xml = camtXml({ reference: '999999999999999999999999999', amount: '50.00', date: '2026-08-06' })
    const results = await importCamt054(tenantId, xml)
    assert.equal(results[0].matched, false)
    assert.equal(results[0].reason, 'NO_MATCHING_INVOICE')
  })

  await t.test('eine Belastung (DBIT) wird nie als Zahlungseingang gebucht', async () => {
    const xml = camtXml({ reference: invoice.qr_reference, amount: '100.00', date: '2026-08-07', creditDebitIndicator: 'DBIT' })
    const results = await importCamt054(tenantId, xml)
    assert.equal(results[0].matched, false)
    assert.equal(results[0].reason, 'DEBIT_ENTRY')
  })
})
