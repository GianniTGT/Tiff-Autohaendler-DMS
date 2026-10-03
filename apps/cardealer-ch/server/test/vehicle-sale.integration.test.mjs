/**
 * Verkaufsabschluss an der Rechnung: Rechnung mit Fahrzeug ⇒ verkauft;
 * Gutschrift ⇒ Preis gemindert oder Verkauf aufgehoben — nur, wenn genau
 * diese Rechnung das Fahrzeug verkauft hat. Übersprungen ohne
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
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-sale-'))

const { closePool } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle, getVehicle, getVehicleEconomics, sellVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const { createInvoice } = await import('../src/services/invoices.js')
const { createCreditNote } = await import('../src/services/credit-notes.js')
const sales = await import('../src/services/sales-documents.js')
const { currentStandardVatPercent } = await import('../src/services/vat-rate.js')

test('Verkaufsabschluss an der Rechnung', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'sale-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city, qr_iban)
       VALUES (gen_random_uuid(), 'Sale', 'Sale AG', $1, 'Weg 1', '3000', 'Bern', 'CH4431999123000889012') RETURNING id`,
      [slug],
    )
  ).rows[0].id
  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    await app.close()
    await adminPool.query('UPDATE vehicles SET sold_via_document_id = NULL WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM payments WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('UPDATE documents SET predecessor_id = NULL WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    for (const table of ['number_sequences', 'vehicle_costs', 'vehicles', 'parties', 'sessions', 'users']) await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const lines = [{ description: 'Fahrzeug', quantity: 1, unitPriceRappen: 1_000_000 }]
  const mkCar = (over = {}) => createVehicle(tenantId, { make: 'VW', model: 'Golf', purchasePriceRappen: 800_000, askingPriceRappen: 1_081_000, ...over })
  const invoiceFor = (vehicleId, over = {}) => createInvoice(tenantId, { partyId: party.id, vehicleId, lines, ...over })
  const row = async (id) => (await adminPool.query('SELECT * FROM vehicles WHERE id = $1', [id])).rows[0]

  await t.test('Rechnung mit Fahrzeug: verkauft, Preis = Brutto-Total, Datum, Käufer, auslösende Rechnung', async () => {
    const car = await mkCar()
    const invoice = await invoiceFor(car.id, { issueDate: '2026-09-15' })
    assert.equal(invoice.soldVehicle, true)
    const v = await row(car.id)
    assert.equal(v.status, 'sold')
    assert.equal(v.sold_price_rappen, String(invoice.total_rappen))
    assert.equal(Number(invoice.total_rappen), 1_081_000)
    assert.equal(String(v.sold_at.toISOString?.() ?? v.sold_at).slice(0, 10), '2026-09-15')
    assert.equal(v.buyer_party_id, party.id)
    assert.equal(v.sold_via_document_id, invoice.id)

    const read = await getVehicle(tenantId, car.id)
    assert.equal(read.soldViaInvoiceNumber, invoice.number)
    const economics = await getVehicleEconomics(tenantId, car.id)
    assert.equal(economics.realized, true)
    assert.equal(economics.profitRappen, 1_081_000 - 800_000)
  })

  await t.test('Ohne Fahrzeug passiert nichts; ein Fehler beim Rechnen lässt das Fahrzeug unverändert', async () => {
    const car = await mkCar()
    assert.equal((await invoiceFor(undefined)).soldVehicle, false)
    await assert.rejects(createInvoice(tenantId, { partyId: party.id, vehicleId: car.id, lines: [{ description: 'x', quantity: 1, unitPriceRappen: 1.5 }] }), /ganze Zahl in Rappen/)
    assert.equal((await row(car.id)).status, 'in_stock')
    assert.equal((await row(car.id)).sold_via_document_id, null)
  })

  await t.test('Zweite Rechnung zum selben Fahrzeug, manuell verkauft, abgeschrieben: unverändert', async () => {
    const car = await mkCar()
    const first = await invoiceFor(car.id)
    const second = await invoiceFor(car.id)
    assert.equal(second.soldVehicle, false)
    assert.equal((await row(car.id)).sold_via_document_id, first.id, 'der erste Verkauf bleibt massgebend')

    const manual = await mkCar()
    await sellVehicle(tenantId, manual.id, { soldPriceRappen: 900_000, soldAt: '2026-05-01' })
    assert.equal((await invoiceFor(manual.id)).soldVehicle, false)
    const m = await row(manual.id)
    assert.equal(m.sold_price_rappen, '900000')
    assert.equal(m.sold_via_document_id, null)

    const lost = await mkCar()
    await adminPool.query("UPDATE vehicles SET status = 'written_off' WHERE id = $1", [lost.id])
    assert.equal((await invoiceFor(lost.id)).soldVehicle, false)
    assert.equal((await row(lost.id)).status, 'written_off')
  })

  await t.test('Belegkette: Rechnung aus dem Auftrag schliesst den Verkauf ab (reserviert → verkauft)', async () => {
    const car = await mkCar()
    const order = await sales.createSalesDocument(tenantId, null, 'order', { partyId: party.id, vehicleId: car.id, lines })
    assert.equal((await row(car.id)).status, 'reserved')
    const invoice = await sales.convertSalesDocument(tenantId, null, order.id, 'invoice')
    const v = await row(car.id)
    assert.equal(v.status, 'sold')
    assert.equal(v.sold_via_document_id, invoice.id)
    assert.equal(v.sold_price_rappen, String(invoice.total_rappen))
  })

  await t.test('Teilgutschrift mindert den Verkaufspreis (und damit den Gewinn), Verkauf bleibt', async () => {
    const car = await mkCar()
    const invoice = await invoiceFor(car.id)
    const credit = await createCreditNote(tenantId, null, invoice.id, { reason: 'Preisnachlass', mode: 'partial', amountRappen: 81_000 })
    assert.equal(credit.vehicleEffect, 'adjusted')
    const v = await row(car.id)
    assert.equal(v.status, 'sold')
    assert.equal(v.sold_price_rappen, String(1_081_000 - 81_000))
    assert.equal((await getVehicleEconomics(tenantId, car.id)).profitRappen, 1_000_000 - 800_000)

    // Rest gutschreiben: Verkauf aufgehoben, Fahrzeug zurück auf Lager, alle Verkaufsfelder leer
    const rest = await createCreditNote(tenantId, null, invoice.id, { reason: 'Rückgabe', mode: 'partial', amountRappen: 1_000_000 })
    assert.equal(rest.vehicleEffect, 'released')
    const back = await row(car.id)
    assert.equal(back.status, 'in_stock')
    for (const col of ['sold_price_rappen', 'sold_at', 'buyer_party_id', 'sold_via_document_id']) assert.equal(back[col], null, col)
    assert.equal((await getVehicleEconomics(tenantId, car.id)).realized, false)
  })

  await t.test('Vollgutschrift hebt den Verkauf auf; mit offenem Auftrag kehrt das Fahrzeug «reserviert» zurück', async () => {
    const car = await mkCar()
    const invoice = await invoiceFor(car.id)
    const credit = await createCreditNote(tenantId, null, invoice.id, { reason: 'Storno', mode: 'full' })
    assert.equal(credit.vehicleEffect, 'released')
    assert.equal((await row(car.id)).status, 'in_stock')

    const car2 = await mkCar()
    const inv2 = await invoiceFor(car2.id)
    await sales.createSalesDocument(tenantId, null, 'order', { partyId: party.id, vehicleId: car2.id, lines }) // neuer Auftrag für den nächsten Kunden
    await createCreditNote(tenantId, null, inv2.id, { reason: 'Storno', mode: 'full' })
    assert.equal((await row(car2.id)).status, 'reserved')
  })

  await t.test('Gutschrift auf eine Rechnung, die das Fahrzeug nicht verkauft hat: Fahrzeug unberührt', async () => {
    const car = await mkCar()
    const first = await invoiceFor(car.id)
    const second = await invoiceFor(car.id)
    const credit = await createCreditNote(tenantId, null, second.id, { reason: 'Storno Service', mode: 'full' })
    assert.equal(credit.vehicleEffect, null)
    const v = await row(car.id)
    assert.equal(v.status, 'sold')
    assert.equal(v.sold_via_document_id, first.id)

    const manual = await mkCar()
    await sellVehicle(tenantId, manual.id, { soldPriceRappen: 900_000 })
    const inv = await invoiceFor(manual.id)
    assert.equal((await createCreditNote(tenantId, null, inv.id, { reason: 'x', mode: 'full' })).vehicleEffect, null)
    assert.equal((await row(manual.id)).status, 'sold')
    assert.equal((await row(manual.id)).sold_price_rappen, '900000')
  })

  await t.test('Über HTTP: die Verknüpfung lässt sich nicht von aussen setzen; Normalsatz nur mit Berechtigung', async () => {
    const cookies = {}
    for (const [role, pw] of [['verkauf', 'VerkaufPasswort1'], ['werkstatt', 'WerkstattPass123']]) {
      await createUser({ tenantId, email: `${role}@sale.ch`, name: role, password: pw, role })
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: slug, email: `${role}@sale.ch`, password: pw } })
      cookies[role] = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    }
    const car = await mkCar()
    const other = await invoiceFor((await mkCar()).id)
    const patched = await app.inject({ method: 'PATCH', url: `/api/vehicles/${car.id}`, headers: { cookie: cookies.verkauf }, payload: { soldViaDocumentId: other.id, notes: 'x' } })
    assert.equal(patched.statusCode, 200)
    assert.equal((await row(car.id)).sold_via_document_id, null)

    const rate = await app.inject({ method: 'GET', url: '/api/vat-rate', headers: { cookie: cookies.verkauf } })
    assert.equal(rate.json().data.standardPercent, 8.1)
    assert.equal((await app.inject({ method: 'GET', url: '/api/vat-rate', headers: { cookie: cookies.werkstatt } })).statusCode, 403)
    assert.equal(await currentStandardVatPercent(tenantId), 8.1)
  })
})
