/**
 * Integrationstest gegen echtes PostgreSQL — Rechnung erstellen, MWST,
 * Nummernkreis, PDF (mit und ohne QR-IBAN). Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice, getInvoice } from '../src/services/invoices.js'
import { renderInvoicePdf } from '../src/services/invoice-pdf.js'
import { createParty } from '../src/services/parties.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

function collectPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

test('Rechnungen: MWST-Berechnung, Nummernkreis, PDF', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'invoices-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, uid, qr_iban, address_street, address_zip, address_city)
       VALUES (gen_random_uuid(), 'Testgarage', 'Testgarage AG', $1, 'CHE-123.456.788', 'CH4431999123000889012', 'Teststrasse 1', '3000', 'Bern')
       RETURNING id`,
      [slug],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Sabit', lastName: 'Kadriu', addressStreet: 'Herzwilstrasse 262', addressZip: '3173', addressCity: 'Oberwangen b. Bern' })

  await t.test('createInvoice berechnet Zwischensumme, MWST (8.1%) und Total korrekt', async () => {
    const invoice = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-01',
      lines: [
        { description: 'VW Golf, VIN ...001', quantity: 1, unitPriceRappen: 1_400_000 },
        { description: 'Aufbereitung', quantity: 2, unitPriceRappen: 15_000 },
      ],
    })
    // 1'400'000 + 2*15'000 = 1'430'000 Rappen netto
    assert.equal(invoice.subtotal_rappen, '1430000')
    // 8.1% von 1'430'000 = 115'830
    assert.equal(invoice.vat_rappen, '115830')
    assert.equal(invoice.total_rappen, '1545830')
    assert.match(invoice.number, /^RE-2026-\d{5}$/)
    assert.equal(invoice.qr_reference_type, 'QRR')
    assert.equal(invoice.qr_reference.length, 27)
  })

  await t.test('zwei Rechnungen im selben Jahr bekommen fortlaufende Nummern', async () => {
    const first = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-02',
      lines: [{ description: 'X', quantity: 1, unitPriceRappen: 100_00 }],
    })
    const second = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-03',
      lines: [{ description: 'Y', quantity: 1, unitPriceRappen: 100_00 }],
    })
    const firstSeq = Number(first.number.split('-')[2])
    const secondSeq = Number(second.number.split('-')[2])
    assert.equal(secondSeq, firstSeq + 1)
  })

  await t.test('createInvoice ohne Positionen wird abgelehnt', async () => {
    await assert.rejects(() => createInvoice(tenantId, { partyId: party.id, lines: [] }))
  })

  await t.test('getInvoice liefert Positionen, Partei und Mandant mit', async () => {
    const created = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-04',
      lines: [{ description: 'Z', quantity: 1, unitPriceRappen: 50_000 }],
    })
    const fetched = await getInvoice(tenantId, created.id)
    assert.equal(fetched.lines.length, 1)
    assert.equal(fetched.party.first_name, 'Sabit')
    assert.equal(fetched.tenant.legal_name, 'Testgarage AG')
  })

  await t.test('renderInvoicePdf erzeugt ein gültiges PDF mit QR-Zahlteil', async () => {
    const created = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-05',
      lines: [{ description: 'PDF-Test', quantity: 1, unitPriceRappen: 100_000 }],
    })
    const fetched = await getInvoice(tenantId, created.id)
    const doc = renderInvoicePdf(fetched)
    const buffer = await collectPdfBuffer(doc)
    assert.ok(buffer.length > 1000)
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  })

  await t.test('renderInvoicePdf funktioniert auch ohne QR-IBAN (Hinweis statt Absturz)', async () => {
    await adminPool.query('UPDATE tenants SET qr_iban = NULL WHERE id = $1', [tenantId])
    const created = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-06-06',
      lines: [{ description: 'Ohne QR-IBAN', quantity: 1, unitPriceRappen: 100_000 }],
    })
    assert.equal(created.qr_reference_type, 'NON')
    const fetched = await getInvoice(tenantId, created.id)
    const doc = renderInvoicePdf(fetched)
    const buffer = await collectPdfBuffer(doc)
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  })

  await t.test('renderInvoicePdf funktioniert auch mit QR-IBAN, wenn der Kundsch. die Adresse fehlt (Hinweis statt Absturz)', async () => {
    // Regression: eine Partei ohne Adresse lieferte hier `null` (nicht
    // `undefined`) an swissqrbill, dessen interner Cleaner an
    // `Object.entries(null)` abstürzte statt einen Fehler zu werfen.
    await adminPool.query('UPDATE tenants SET qr_iban = $1 WHERE id = $2', ['CH4431999123000889012', tenantId])
    const addresslessParty = await createParty(tenantId, { kind: 'person', firstName: 'Ohne', lastName: 'Adresse' })
    const created = await createInvoice(tenantId, {
      partyId: addresslessParty.id,
      issueDate: '2026-06-07',
      lines: [{ description: 'Ohne Kundenadresse', quantity: 1, unitPriceRappen: 100_000 }],
    })
    const fetched = await getInvoice(tenantId, created.id)
    const doc = renderInvoicePdf(fetched)
    const buffer = await collectPdfBuffer(doc)
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  })
})
