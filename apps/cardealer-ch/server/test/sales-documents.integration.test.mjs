/**
 * Belegkette Offerte → Auftrag → Lieferschein → Rechnung gegen echtes
 * PostgreSQL: Nummern, Summen, Statuswechsel, Reservierung, Ablauf, Archiv,
 * Mandantentrennung, Rollen über HTTP. Übersprungen ohne
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
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-sales-'))

const { closePool, withTenant } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const sales = await import('../src/services/sales-documents.js')
const { getInvoice } = await import('../src/services/invoices.js')
const { listArchive, verifyArchived, buildArchiveExport } = await import('../src/services/archive-browser.js')

test('Belegkette', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mk = async (name) => {
    const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`
    const id = (
      await adminPool.query(
        `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city, qr_iban)
         VALUES (gen_random_uuid(), $1, $1 || ' AG', $2, 'Weg 1', '3000', 'Bern', 'CH4431999123000889012') RETURNING id`,
        [name, slug],
      )
    ).rows[0].id
    return { id, slug }
  }
  const A = await mk('sales-a')
  const B = await mk('sales-b')
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
      for (const table of ['number_sequences', 'vehicles', 'parties', 'sessions', 'users']) await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const year = new Date().getFullYear()
  const party = await createParty(A.id, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const car = await createVehicle(A.id, { make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000007', mileageKm: 90000, serialNumber: '123.456.789', askingPriceRappen: 1_300_000 })
  const lines = [
    { description: 'VW Golf, WVWZZZ1KZAW000007', quantity: 1, unitPriceRappen: 1_200_000 },
    { description: 'Wintersatz', quantity: 2, unitPriceRappen: 50_000 },
  ]
  const vehicleStatus = async (id) => (await adminPool.query('SELECT status FROM vehicles WHERE id = $1', [id])).rows[0].status
  const docStatus = async (id) => (await adminPool.query('SELECT status FROM documents WHERE id = $1', [id])).rows[0].status

  let offer
  await t.test('Offerte ausstellen: Nummer, Summen mit MWST, gültig bis +30 Tage, archiviert', async () => {
    offer = await sales.createSalesDocument(A.id, null, 'offer', { partyId: party.id, vehicleId: car.id, lines, note: 'Inkl. Service' })
    assert.equal(offer.number, `OF-${year}-00001`)
    assert.equal(offer.type, 'offer')
    assert.equal(offer.status, 'issued')
    assert.equal(Number(offer.subtotal_rappen), 1_300_000)
    assert.equal(Number(offer.vat_rappen), Math.round(1_200_000 * 0.081) + Math.round(100_000 * 0.081))
    assert.equal(Number(offer.total_rappen), Number(offer.subtotal_rappen) + Number(offer.vat_rappen))
    assert.equal(offer.lines.length, 2)
    assert.equal(Number(offer.lines[1].quantity), 2)
    assert.deepEqual(offer.archive, { archived: true })
    const days = (new Date(String(offer.due_date).slice(0, 10)) - new Date(String(offer.issue_date).slice(0, 10))) / 86_400_000
    assert.equal(days, 30)
    assert.equal(offer.expired, false)
    assert.equal((await verifyArchived(A.id, offer.id)).ok, true)
    assert.equal(await vehicleStatus(car.id), 'in_stock', 'eine Offerte reserviert nichts')
  })

  await t.test('Eingaben werden geprüft', async () => {
    const bad = (over, pattern) => assert.rejects(sales.createSalesDocument(A.id, null, 'offer', { partyId: party.id, lines, ...over }), pattern)
    await bad({ partyId: undefined }, /Kunden/)
    await bad({ partyId: '00000000-0000-0000-0000-000000000000' }, /Kunde wurde nicht gefunden/)
    await bad({ vehicleId: '00000000-0000-0000-0000-000000000000' }, /Fahrzeug wurde nicht gefunden/)
    await bad({ lines: [] }, /mindestens eine Position/)
    await bad({ lines: [{ description: '', unitPriceRappen: 100 }] }, /Beschreibung/)
    await bad({ lines: [{ description: 'x', quantity: 0, unitPriceRappen: 100 }] }, /Menge/)
    await bad({ lines: [{ description: 'x', quantity: 1, unitPriceRappen: 1.5 }] }, /ganze Zahl in Rappen/)
    await bad({ lines: [{ description: 'x', quantity: 1, unitPriceRappen: -1 }] }, /ganze Zahl in Rappen/)
    await bad({ validUntil: '2020-01-01' }, /Vergangenheit/)
    await assert.rejects(sales.createSalesDocument(A.id, null, 'delivery_note', { partyId: party.id, lines }), /Unbekannte Belegart/)
    assert.equal((await sales.listSalesDocuments(A.id, { type: 'offer' })).length, 1, 'abgelehnte Eingaben haben nichts erzeugt')
  })

  let order
  await t.test('Offerte → Auftrag: eigene Nummer, gleiche Summen, Offerte angenommen, Fahrzeug reserviert', async () => {
    await assert.rejects(sales.convertSalesDocument(A.id, null, offer.id, 'delivery_note'), /lässt sich kein/)
    await assert.rejects(sales.convertSalesDocument(A.id, null, offer.id, 'invoice'), /lässt sich kein/)
    order = await sales.convertSalesDocument(A.id, null, offer.id, 'order', { note: 'Lieferung Ende Monat' })
    assert.equal(order.number, `AU-${year}-00001`)
    assert.equal(order.predecessor.number, offer.number)
    assert.equal(Number(order.total_rappen), Number(offer.total_rappen))
    assert.equal(order.note, 'Lieferung Ende Monat')
    assert.deepEqual(order.lines.map((l) => [l.description, Number(l.quantity), Number(l.unit_price_rappen)]), lines.map((l) => [l.description, l.quantity, l.unitPriceRappen]))
    assert.equal(await docStatus(offer.id), 'accepted')
    assert.equal(await vehicleStatus(car.id), 'reserved')
    assert.equal(order.archive.archived, true)
    await assert.rejects(sales.convertSalesDocument(A.id, null, offer.id, 'order'), /schon ein Auftrag/)
    const reloaded = await sales.getSalesDocument(A.id, offer.id)
    assert.deepEqual(reloaded.successors.map((s) => s.number), [order.number])
  })

  let deliveryNote
  await t.test('Auftrag → Lieferschein (einmal), PDF mit Fahrzeugdaten', async () => {
    deliveryNote = await sales.convertSalesDocument(A.id, null, order.id, 'delivery_note', { note: '2 Schlüssel' })
    assert.equal(deliveryNote.number, `LS-${year}-00001`)
    assert.equal(deliveryNote.vehicle.vin, 'WVWZZZ1KZAW000007')
    assert.equal(await docStatus(order.id), 'delivered')
    await assert.rejects(sales.convertSalesDocument(A.id, null, order.id, 'delivery_note'), /schon einen Lieferschein/)
    assert.equal(deliveryNote.archive.archived, true)
    assert.equal((await verifyArchived(A.id, deliveryNote.id)).ok, true)
    await assert.rejects(sales.setSalesDocumentStatus(A.id, order.id, 'cancelled'), /nicht mehr stornieren/)
  })

  let invoice
  await t.test('Lieferschein → Rechnung: Vorgänger, gleiche Positionen, Kette abgeschlossen, nur einmal', async () => {
    invoice = await sales.convertSalesDocument(A.id, null, deliveryNote.id, 'invoice')
    const full = await getInvoice(A.id, invoice.id)
    assert.equal(full.predecessor_id, deliveryNote.id)
    assert.equal(Number(full.total_rappen), Number(offer.total_rappen))
    assert.equal(full.lines.length, 2)
    assert.equal(invoice.archive.archived, true, JSON.stringify(invoice.archive))
    assert.equal(await docStatus(deliveryNote.id), 'invoiced')
    assert.equal(await docStatus(order.id), 'invoiced')
    await assert.rejects(sales.convertSalesDocument(A.id, null, deliveryNote.id, 'invoice'), /schon die Rechnung/)
    await assert.rejects(sales.convertSalesDocument(A.id, null, order.id, 'invoice'), /schon die Rechnung/)
    const list = await sales.listSalesDocuments(A.id, { type: 'order' })
    assert.equal(list[0].invoiceNumber, null, 'die Rechnung hängt am Lieferschein, nicht direkt am Auftrag')
    const dn = (await sales.listSalesDocuments(A.id, { type: 'delivery_note' }))[0]
    assert.equal(dn.invoiceNumber, full.number)
  })

  await t.test('Auftrag direkt → Rechnung; Stornieren gibt das Fahrzeug nur frei, wenn kein anderer Auftrag besteht', async () => {
    const car2 = await createVehicle(A.id, { make: 'Audi', model: 'A3' })
    const o1 = await sales.createSalesDocument(A.id, null, 'order', { partyId: party.id, vehicleId: car2.id, lines })
    const o2 = await sales.createSalesDocument(A.id, null, 'order', { partyId: party.id, vehicleId: car2.id, lines })
    assert.equal(await vehicleStatus(car2.id), 'reserved')
    assert.equal((await sales.setSalesDocumentStatus(A.id, o1.id, 'cancelled')).status, 'cancelled')
    assert.equal(await vehicleStatus(car2.id), 'reserved', 'der zweite Auftrag hält die Reservierung')
    await sales.setSalesDocumentStatus(A.id, o2.id, 'cancelled')
    assert.equal(await vehicleStatus(car2.id), 'in_stock')
    await assert.rejects(sales.setSalesDocumentStatus(A.id, o2.id, 'cancelled'), /schon storniert/)
    await assert.rejects(sales.convertSalesDocument(A.id, null, o2.id, 'delivery_note'), /stornierter/)

    const o3 = await sales.createSalesDocument(A.id, null, 'order', { partyId: party.id, lines })
    const inv = await sales.convertSalesDocument(A.id, null, o3.id, 'invoice')
    assert.equal((await getInvoice(A.id, inv.id)).predecessor_id, o3.id)
    assert.equal(await docStatus(o3.id), 'invoiced')
  })

  await t.test('Verkauf abgeschlossen: eine Stornierung stellt ein verkauftes Fahrzeug nicht zurück', async () => {
    const car3 = await createVehicle(A.id, { make: 'Opel', model: 'Astra' })
    const o = await sales.createSalesDocument(A.id, null, 'order', { partyId: party.id, vehicleId: car3.id, lines })
    await adminPool.query("UPDATE vehicles SET status = 'sold' WHERE id = $1", [car3.id])
    await sales.setSalesDocumentStatus(A.id, o.id, 'cancelled')
    assert.equal(await vehicleStatus(car3.id), 'sold')
  })

  await t.test('Offerte ablehnen; abgelaufene Offerten lassen sich nicht mehr wandeln', async () => {
    const o = await sales.createSalesDocument(A.id, null, 'offer', { partyId: party.id, lines })
    assert.equal((await sales.setSalesDocumentStatus(A.id, o.id, 'declined')).status, 'declined')
    await assert.rejects(sales.convertSalesDocument(A.id, null, o.id, 'order'), /abgelehnter/)
    await assert.rejects(sales.setSalesDocumentStatus(A.id, o.id, 'declined'), /offene Offerte/)

    const old = await sales.createSalesDocument(A.id, null, 'offer', { partyId: party.id, lines })
    await adminPool.query("UPDATE documents SET due_date = current_date - 1 WHERE id = $1", [old.id])
    assert.equal((await sales.getSalesDocument(A.id, old.id)).expired, true)
    assert.equal((await sales.listSalesDocuments(A.id, { type: 'offer' })).find((x) => x.id === old.id).expired, true)
    await assert.rejects(sales.convertSalesDocument(A.id, null, old.id, 'order'), /abgelaufen/)
    await assert.rejects(sales.setSalesDocumentStatus(A.id, old.id, 'cancelled'), /nicht möglich/)
  })

  await t.test('Archiv: alle Belegarten erscheinen, sind nicht löschbar, Export legt Ordner an', async () => {
    const rows = await listArchive(A.id)
    for (const type of ['offer', 'order', 'delivery_note', 'invoice']) assert.ok(rows.some((r) => r.type === type && r.archived), type)
    await assert.rejects(withTenant(A.id, (c) => c.query('DELETE FROM documents WHERE id = $1', [offer.id])), /nicht gelöscht werden/)
    const { zip } = await buildArchiveExport(A.id)
    for (const folder of ['Offerten/', 'Auftraege/', 'Lieferscheine/', 'Rechnungen/']) assert.ok(zip.includes(Buffer.from(folder)), folder)
  })

  await t.test('Mandant B sieht und wandelt nichts', async () => {
    assert.deepEqual(await sales.listSalesDocuments(B.id), [])
    assert.equal(await sales.getSalesDocument(B.id, offer.id), null)
    assert.equal(await sales.convertSalesDocument(B.id, null, order.id, 'invoice'), null)
    assert.equal(await sales.setSalesDocumentStatus(B.id, order.id, 'cancelled'), null)
    await assert.rejects(sales.createSalesDocument(B.id, null, 'offer', { partyId: party.id, lines }), /Kunde wurde nicht gefunden/)
    assert.equal(await sales.convertSalesDocument(A.id, null, invoice.id, 'order'), null, 'eine Rechnung ist kein Beleg der Kette')
  })

  await t.test('Über HTTP: Werkstatt gesperrt, Verkauf darf; keine Betriebsdaten in der Antwort; PDFs', async () => {
    const cookies = {}
    for (const [role, pw] of [['inhaber', 'ChefPasswort123'], ['verkauf', 'VerkaufPasswort1'], ['werkstatt', 'WerkstattPass123']]) {
      await createUser({ tenantId: A.id, email: `${role}@sales.ch`, name: role, password: pw, role })
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: A.slug, email: `${role}@sales.ch`, password: pw } })
      cookies[role] = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    }
    const call = (role, method, url, payload) => app.inject({ method, url, headers: role ? { cookie: cookies[role] } : {}, payload })
    const body = { partyId: party.id, lines }

    for (const [method, url, payload] of [['GET', '/api/sales-documents'], ['POST', '/api/offers', body], ['POST', '/api/orders', body], ['GET', `/api/sales-documents/${offer.id}/pdf`]]) {
      assert.equal((await call(null, method, url, payload)).statusCode, 401, `${url} ohne Anmeldung`)
      assert.equal((await call('werkstatt', method, url, payload)).statusCode, 403, `${url} als Werkstatt`)
    }

    const created = await call('verkauf', 'POST', '/api/offers', body)
    assert.equal(created.statusCode, 201)
    assert.equal('tenant' in created.json().data, false, 'keine Betriebsdaten (QR-IBAN) in der Antwort')
    assert.equal(created.json().data.archive.archived, true)

    const detail = await call('verkauf', 'GET', `/api/sales-documents/${order.id}`)
    assert.equal(detail.json().data.predecessor.number, offer.number)
    assert.equal('tenant' in detail.json().data, false)

    for (const id of [offer.id, order.id, deliveryNote.id]) {
      const pdf = await call('verkauf', 'GET', `/api/sales-documents/${id}/pdf`)
      assert.equal(pdf.statusCode, 200)
      assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-')
    }

    const list = await call('verkauf', 'GET', '/api/sales-documents?type=order')
    assert.ok(list.json().data.every((d) => d.type === 'order'))
    assert.equal((await call('verkauf', 'GET', '/api/sales-documents?type=foo')).statusCode, 400)
    assert.equal((await call('verkauf', 'GET', '/api/sales-documents/keine-uuid')).statusCode, 400)

    const conv = await call('verkauf', 'POST', `/api/sales-documents/${created.json().data.id}/convert`, { to: 'order' })
    assert.equal(conv.statusCode, 201)
    assert.equal((await call('verkauf', 'POST', `/api/sales-documents/${created.json().data.id}/convert`, { to: 'order' })).statusCode, 400)
    assert.equal((await call('verkauf', 'POST', `/api/sales-documents/${conv.json().data.id}/status`, { status: 'cancelled' })).statusCode, 200)
    assert.equal((await call('verkauf', 'POST', '/api/sales-documents/00000000-0000-0000-0000-000000000000/convert', { to: 'order' })).statusCode, 404)
  })
})
