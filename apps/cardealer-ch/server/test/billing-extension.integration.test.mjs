/**
 * Rechnungs-Ausbau: Betriebsdaten (QR-IBAN-Prüfung), Rechnungsliste mit
 * Restbetrag, Mahnungs-PDF, Vertrags-PDFs. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice, listInvoices, listRemindersForInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { createVehicle } from '../src/services/vehicles.js'
import { recordPayment } from '../src/services/payments.js'
import { createReminder, getReminder } from '../src/services/reminders.js'
import { renderReminderPdfBuffer } from '../src/services/invoice-pdf.js'
import { renderKaufvertrag, renderAnkaufsvertrag } from '../src/services/contracts.js'
import { isValidQrIban, getTenantSettings, updateTenantSettings } from '../src/services/tenant-settings.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
const VALID_QR_IBAN = 'CH4431999123000889012'

test('QR-IBAN-Prüfung', () => {
  assert.equal(isValidQrIban(VALID_QR_IBAN), true)
  assert.equal(isValidQrIban('CH44 3199 9123 0008 8901 2'), true, 'mit Leerzeichen')
  assert.equal(isValidQrIban('CH4431999123000889013'), false, 'falsche Prüfziffer')
  // Normale IBAN (Instituts-ID 00762) ist keine QR-IBAN.
  assert.equal(isValidQrIban('CH9300762011623852957'), false)
  assert.equal(isValidQrIban('DE89370400440532013000'), false)
  assert.equal(isValidQrIban(''), false)
})

test('Rechnungs-Ausbau', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city)
       VALUES (gen_random_uuid(), 'Ausbau', 'Ausbau AG', $1, 'Teststrasse 1', '3000', 'Bern') RETURNING id`,
      ['ausbau-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM payments WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('DELETE FROM archive_log WHERE tenant_id = $1', [tenantId]).catch(() => {})
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  await t.test('Betriebsdaten: speichern, normalisieren, ungültiges ablehnen', async () => {
    const saved = await updateTenantSettings(tenantId, {
      uid: 'CHE-123.456.788',
      vatLiable: true,
      vatMethod: 'effective',
      qrIban: 'CH44 3199 9123 0008 8901 2',
    })
    assert.equal(saved.qrIban, VALID_QR_IBAN)
    assert.equal(saved.vatMethod, 'effective')
    assert.equal((await getTenantSettings(tenantId)).uid, 'CHE-123.456.788')

    await assert.rejects(updateTenantSettings(tenantId, { qrIban: 'CH9300762011623852957' }), /QR-IBAN/)
    await assert.rejects(updateTenantSettings(tenantId, { uid: '123' }), /UID/)
    await assert.rejects(updateTenantSettings(tenantId, { vatMethod: 'foo' }), /MWST-Methode/)
    await assert.rejects(updateTenantSettings(tenantId, { netTaxRatePercent: 99 }), /Saldosteuersatz/)
    await assert.rejects(updateTenantSettings(tenantId, { legalName: ' ' }), /Firma/)
    assert.equal((await getTenantSettings(tenantId)).qrIban, VALID_QR_IBAN, 'abgelehnte Änderung lässt alles unverändert')
  })

  const party = await createParty(tenantId, {
    kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich',
  })

  await t.test('Rechnungsliste zeigt Bezahltes und Restbetrag, Mahnstufe', async (st) => {
    const invoice = await createInvoice(tenantId, {
      partyId: party.id,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      lines: [{ description: 'Test', quantity: 1, unitPriceRappen: 100_000 }],
    })
    const total = Number(invoice.total_rappen)
    let [row] = await listInvoices(tenantId)
    assert.equal(row.outstanding_rappen, total)
    assert.equal(row.last_reminder_level, null)

    await recordPayment(tenantId, { documentId: invoice.id, amountRappen: 30_000, paidAt: '2026-02-01' })
    ;[row] = await listInvoices(tenantId)
    assert.equal(row.paid_rappen, '30000')
    assert.equal(row.outstanding_rappen, total - 30_000)
    assert.equal(row.status, 'issued')

    const reminder = await createReminder(tenantId, { invoiceId: invoice.id, asOfDate: '2026-03-15' })
    ;[row] = await listInvoices(tenantId)
    assert.equal(row.last_reminder_level, 1)
    const reminders = await listRemindersForInvoice(tenantId, invoice.id)
    assert.deepEqual(reminders.map((r) => r.reminder_level), [1])

    await st.test('Mahnungs-PDF wird erzeugt', async () => {
      const pdf = await renderReminderPdfBuffer(await getReminder(tenantId, reminder.id))
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
      assert.ok(pdf.length > 1500)
    })

    await recordPayment(tenantId, { documentId: invoice.id, amountRappen: total - 30_000, paidAt: '2026-03-16' })
    ;[row] = await listInvoices(tenantId)
    assert.equal(row.status, 'paid')
    assert.equal(row.outstanding_rappen, 0)
  })

  await t.test('Vertrags-PDFs: Kauf- und Ankaufsvertrag', async () => {
    const car = await createVehicle(tenantId, {
      make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000002', mileageKm: 90000,
      purchasePriceRappen: 1_000_000, askingPriceRappen: 1_300_000,
      purchaseFrom: 'private', purchasedAt: '2026-05-01', sellerPartyId: party.id,
    })
    const kauf = await renderKaufvertrag(tenantId, car.id, { buyerPartyId: party.id, warrantyMonths: 12 })
    assert.equal(kauf.subarray(0, 5).toString(), '%PDF-')
    const ankauf = await renderAnkaufsvertrag(tenantId, car.id)
    assert.equal(ankauf.subarray(0, 5).toString(), '%PDF-')
    assert.equal(await renderKaufvertrag(tenantId, '00000000-0000-0000-0000-000000000000'), null)
  })
})
