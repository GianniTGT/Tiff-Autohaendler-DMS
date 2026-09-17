/**
 * Integrationstest gegen echtes PostgreSQL — fiktiver Vorsteuerabzug wird
 * beim Fahrzeug automatisch berechnet, und die MWST-Auswertung
 * (effektiv/Saldosteuersatz) summiert korrekt. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createVehicle, updateVehicle } from '../src/services/vehicles.js'
import { createInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { computeVatReport } from '../src/services/vat-report.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Fiktiver Vorsteuerabzug wird beim Fahrzeug automatisch berechnet', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'vat-vehicle-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'A', 'A AG', $1) RETURNING id",
      [slug],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  await t.test('Privatkauf mit notional_input_tax berechnet die fiktive Vorsteuer selbst', async () => {
    const vehicle = await createVehicle(tenantId, {
      vin: 'V1',
      purchasePriceRappen: 1_000_000, // CHF 10'000
      purchaseFrom: 'private',
      vatScheme: 'notional_input_tax',
      purchasedAt: '2026-01-01',
    })
    // 10'000 × 8.1 / 108.1 = 749.31 CHF = 74'931 Rappen (SCHWEIZ-SAAS.md §4.3-Beispiel)
    assert.equal(Number(vehicle.notionalInputTaxRappen), 74_931)
  })

  await t.test('ein Händlerkauf bekommt keine fiktive Vorsteuer, auch mit demselben Preis', async () => {
    const vehicle = await createVehicle(tenantId, {
      vin: 'V2',
      purchasePriceRappen: 1_000_000,
      purchaseFrom: 'dealer',
      vatScheme: 'standard',
      purchasedAt: '2026-01-01',
    })
    assert.equal(Number(vehicle.notionalInputTaxRappen), 0)
  })

  await t.test('updateVehicle rechnet neu, wenn sich das Schema nachträglich ändert', async () => {
    const vehicle = await createVehicle(tenantId, {
      vin: 'V3',
      purchasePriceRappen: 500_000,
      purchaseFrom: 'private',
      vatScheme: 'standard', // noch nicht notional_input_tax
      purchasedAt: '2026-01-01',
    })
    assert.equal(Number(vehicle.notionalInputTaxRappen), 0)

    const updated = await updateVehicle(tenantId, vehicle.id, { vatScheme: 'notional_input_tax' })
    // 5'000 × 8.1 / 108.1 = 374.65... -> gerundet 37'465 Rappen
    assert.equal(Number(updated.notionalInputTaxRappen), 37_465)
    assert.equal(Number(updated.purchasePriceRappen), 500_000) // unverändert, nur vatScheme wurde mitgegeben
  })
})

test('MWST-Auswertung: effektiv und Saldosteuersatz', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'vat-report-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug, vat_method) VALUES (gen_random_uuid(), 'A', 'A AG', $1, 'effective') RETURNING id",
      [slug],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Max', lastName: 'Muster' })

  await createVehicle(tenantId, {
    vin: 'V1',
    purchasePriceRappen: 1_000_000,
    purchaseFrom: 'private',
    vatScheme: 'notional_input_tax',
    purchasedAt: '2026-02-01',
    soldAt: '2026-03-15',
  })

  await createInvoice(tenantId, {
    partyId: party.id,
    issueDate: '2026-03-15',
    lines: [{ description: 'Fahrzeugverkauf', quantity: 1, unitPriceRappen: 1_400_000 }],
  })
  // Rechnung: subtotal 1'400'000, MWST 8.1% = 113'400, total 1'513'400

  await t.test('effektiv: Umsatzsteuer minus fiktive Vorsteuer aus dem verkauften Fahrzeug', async () => {
    const report = await computeVatReport(tenantId, { from: '2026-01-01', to: '2026-03-31' })
    assert.equal(report.method, 'effective')
    assert.equal(report.outputTaxRappen, 113_400)
    assert.equal(report.notionalInputTaxRappen, 74_931)
    assert.equal(report.payableRappen, 113_400 - 74_931)
  })

  await t.test('ein Zeitraum ausserhalb der Belege liefert 0, nie einen Fehler', async () => {
    const report = await computeVatReport(tenantId, { from: '2020-01-01', to: '2020-12-31' })
    assert.equal(report.payableRappen, 0)
  })

  await t.test('Saldosteuersatz: Pauschalsatz auf den fakturierten Umsatz, kein Vorsteuerabzug', async () => {
    await adminPool.query("UPDATE tenants SET vat_method = 'net_tax_rate', net_tax_rate_percent = 2.2 WHERE id = $1", [tenantId])
    const report = await computeVatReport(tenantId, { from: '2026-01-01', to: '2026-03-31' })
    assert.equal(report.method, 'net_tax_rate')
    // 1'513'400 × 2.2% = 33'294.8 -> gerundet 33'295
    assert.equal(report.payableRappen, 33_295)
  })

  await t.test('Saldosteuersatz ohne hinterlegten Satz wird klar abgelehnt', async () => {
    await adminPool.query('UPDATE tenants SET net_tax_rate_percent = NULL WHERE id = $1', [tenantId])
    await assert.rejects(() => computeVatReport(tenantId, { from: '2026-01-01', to: '2026-03-31' }))
  })

  await t.test('ohne from/to wird sofort abgelehnt', async () => {
    await assert.rejects(() => computeVatReport(tenantId, {}))
  })
})
