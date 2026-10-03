/**
 * Inserat abschalten beim Verkauf — mit einem Ersatz-Client, ohne Netzwerk
 * und ohne echte AutoScout24-Zugangsdaten. Prüft vor allem die Zusagen:
 * der Verkauf bleibt bestehen, wenn AutoScout24 scheitert; Fehler werden
 * sichtbar festgehalten; nichts wird doppelt abgeschaltet; ein aufgehobener
 * Verkauf schaltet das Inserat nicht von selbst wieder ein.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-listing-'))

const { closePool } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle, getVehicle, sellVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const { createInvoice } = await import('../src/services/invoices.js')
const { createCreditNote } = await import('../src/services/credit-notes.js')
const { updateTenantSettings } = await import('../src/services/tenant-settings.js')
const sync = await import('../src/services/autoscout24-sync.js')
const { getListings } = await import('../src/services/listings.js')
const { getDashboard } = await import('../src/services/dashboard.js')

function fakeClient() {
  const calls = []
  let failWith = null
  return {
    calls,
    failNext(message) { failWith = message },
    async deactivateListing(credentials, sellerId, listingId) {
      calls.push(['deactivate', listingId, sellerId, credentials.clientId])
      if (failWith) { const m = failWith; failWith = null; throw new Error(m) }
    },
    async activateListing(credentials, sellerId, listingId) { calls.push(['activate', listingId]) },
  }
}

test('Inserat beim Verkauf abschalten', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mk = async (name, withCredentials) => {
    const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`
    const id = (
      await adminPool.query(
        `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city, qr_iban)
         VALUES (gen_random_uuid(), $1, $1 || ' AG', $2, 'Weg 1', '3000', 'Bern', 'CH4431999123000889012') RETURNING id`,
        [name, slug],
      )
    ).rows[0].id
    if (withCredentials) await updateTenantSettings(id, { autoscout24ClientId: 'cid', autoscout24SellerId: '42', autoscout24ClientSecret: 'geheim' })
    return { id, slug }
  }
  const A = await mk('listing-a', true)
  const NOCRED = await mk('listing-nocred', false)
  const client = fakeClient()
  sync.configureAutoScout24Client(client)
  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    sync.configureAutoScout24Client(null)
    await app.close()
    for (const { id } of [A, NOCRED]) {
      await adminPool.query('UPDATE vehicles SET sold_via_document_id = NULL WHERE tenant_id = $1', [id])
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

  const mkParty = (tenantId) => createParty(tenantId, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const partyA = await mkParty(A.id)
  const lines = [{ description: 'Fahrzeug', quantity: 1, unitPriceRappen: 1_000_000 }]
  const listed = async (tenantId, listingId, over = {}) => {
    const v = await createVehicle(tenantId, { make: 'VW', model: 'Golf', purchasePriceRappen: 800_000, askingPriceRappen: 1_081_000, ...over })
    await adminPool.query('UPDATE vehicles SET autoscout24_listing_id = $1 WHERE id = $2', [listingId, v.id])
    return v
  }
  const reset = () => { client.calls.length = 0 }

  await t.test('Rechnung mit Fahrzeug: Inserat wird nach dem Verkauf deaktiviert, Zustand gespeichert', async () => {
    reset()
    const car = await listed(A.id, 'L-100')
    const invoice = await createInvoice(A.id, { partyId: partyA.id, vehicleId: car.id, lines })
    assert.deepEqual(invoice.listing, { status: 'deactivated' })
    assert.deepEqual(client.calls, [['deactivate', 'L-100', '42', 'cid']])
    const v = await getVehicle(A.id, car.id)
    assert.equal(v.status, 'sold')
    assert.equal(v.autoscout24Active, false)
    assert.equal(v.autoscout24LastError, null)
    assert.equal(v.autoscout24ListingId, 'L-100', 'deaktiviert, nicht gelöscht — wieder aktivierbar')
  })

  await t.test('Kein Inserat / schon deaktiviert / zweite Rechnung: kein Aufruf', async () => {
    reset()
    const plain = await createVehicle(A.id, { make: 'Audi', model: 'A3' })
    assert.deepEqual((await createInvoice(A.id, { partyId: partyA.id, vehicleId: plain.id, lines })).listing, { status: 'none' })
    assert.deepEqual((await createInvoice(A.id, { partyId: partyA.id, lines })).listing, { status: 'none' }, 'ohne Fahrzeug')

    const off = await listed(A.id, 'L-200')
    await adminPool.query('UPDATE vehicles SET autoscout24_active = false WHERE id = $1', [off.id])
    assert.deepEqual((await createInvoice(A.id, { partyId: partyA.id, vehicleId: off.id, lines })).listing, { status: 'already' })

    const car = await listed(A.id, 'L-300')
    await createInvoice(A.id, { partyId: partyA.id, vehicleId: car.id, lines })
    reset()
    const second = await createInvoice(A.id, { partyId: partyA.id, vehicleId: car.id, lines })
    assert.deepEqual(second.listing, { status: 'none' }, 'der Verkauf war schon abgeschlossen')
    assert.deepEqual(client.calls, [], 'kein zweiter Aufruf')
  })

  await t.test('AutoScout24 scheitert: Rechnung und Verkauf bleiben, Fehler wird festgehalten und angezeigt', async () => {
    reset()
    const car = await listed(A.id, 'L-400')
    client.failNext('AutoScout24-API-Fehler 503: Service Unavailable')
    const invoice = await createInvoice(A.id, { partyId: partyA.id, vehicleId: car.id, lines })
    assert.equal(invoice.soldVehicle, true, 'die Rechnung ist da, trotz des Fehlers')
    assert.equal(invoice.listing.status, 'failed')
    assert.match(invoice.listing.reason, /503/)

    const v = await getVehicle(A.id, car.id)
    assert.equal(v.status, 'sold')
    assert.match(v.autoscout24LastError, /503/)
    assert.notEqual(v.autoscout24Active, false, 'nicht als abgeschaltet verbucht')

    const row = (await getListings(A.id)).rows.find((r) => r.id === car.id)
    assert.equal(row.soldStillListed, true)
    assert.match(row.lastError, /503/)
    const dash = await getDashboard(A.id, 'inhaber', new Date())
    const warn = dash.soldStillListed.find((x) => x.id === car.id)
    assert.ok(warn)
    assert.match(warn.error, /503/)

    // Wiederholung (Schaltfläche «Jetzt deaktivieren»): klappt, löscht Fehler und Warnung
    await sync.deactivateAutoScout24Listing(A.id, car.id)
    const fixed = await getVehicle(A.id, car.id)
    assert.equal(fixed.autoscout24Active, false)
    assert.equal(fixed.autoscout24LastError, null)
    assert.equal((await getListings(A.id)).rows.find((r) => r.id === car.id).soldStillListed, false)
    assert.equal((await getDashboard(A.id, 'inhaber', new Date())).soldStillListed.some((x) => x.id === car.id), false)
  })

  await t.test('Verkauf von Hand schaltet ebenfalls ab (über die Route), auch hier ohne den Verkauf zu gefährden', async () => {
    reset()
    await createUser({ tenantId: A.id, email: 'chef@listing.ch', name: 'Chef', password: 'ChefPasswort123', role: 'inhaber' })
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: A.slug, email: 'chef@listing.ch', password: 'ChefPasswort123' } })
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const car = await listed(A.id, 'L-500')
    const ok = await app.inject({ method: 'POST', url: `/api/vehicles/${car.id}/sell`, headers: { cookie }, payload: { soldPriceRappen: 900_000 } })
    assert.equal(ok.statusCode, 200)
    assert.equal(ok.json().data.status, 'sold')
    assert.deepEqual(ok.json().data.listing, { status: 'deactivated' })
    assert.deepEqual(client.calls, [['deactivate', 'L-500', '42', 'cid']])

    const car2 = await listed(A.id, 'L-501')
    client.failNext('Netzwerkfehler')
    const failed = await app.inject({ method: 'POST', url: `/api/vehicles/${car2.id}/sell`, headers: { cookie }, payload: { soldPriceRappen: 900_000 } })
    assert.equal(failed.statusCode, 200, 'der Verkauf gelingt trotzdem')
    assert.equal(failed.json().data.status, 'sold')
    assert.equal(failed.json().data.listing.status, 'failed')

    // Ein abgelehnter Verkauf (schon verkauft) schaltet nichts ab
    reset()
    const again = await app.inject({ method: 'POST', url: `/api/vehicles/${car.id}/sell`, headers: { cookie }, payload: { soldPriceRappen: 1 } })
    assert.equal(again.statusCode, 400)
    assert.deepEqual(client.calls, [])

    // Der Zustand ist nicht von aussen setzbar
    const car3 = await listed(A.id, 'L-502')
    const patch = await app.inject({ method: 'PATCH', url: `/api/vehicles/${car3.id}`, headers: { cookie }, payload: { autoscout24Active: false, autoscout24LastError: 'x', notes: 'n' } })
    assert.equal(patch.statusCode, 200)
    const v3 = await getVehicle(A.id, car3.id)
    assert.equal(v3.autoscout24Active, null)
    assert.equal(v3.autoscout24LastError, null)
  })

  await t.test('Ohne Zugangsdaten: der Verkauf gilt, die Meldung sagt, warum das Inserat nicht abgeschaltet werden konnte', async () => {
    const party = await mkParty(NOCRED.id)
    const car = await listed(NOCRED.id, 'L-600')
    reset()
    const invoice = await createInvoice(NOCRED.id, { partyId: party.id, vehicleId: car.id, lines })
    assert.equal(invoice.soldVehicle, true)
    assert.equal(invoice.listing.status, 'failed')
    assert.match(invoice.listing.reason, /keine AutoScout24-Zugangsdaten/)
    assert.deepEqual(client.calls, [], 'ohne Zugangsdaten geht nichts ins Netz')
    assert.match((await getVehicle(NOCRED.id, car.id)).autoscout24LastError, /Zugangsdaten/)
  })

  await t.test('Verkauf aufgehoben: das Inserat bleibt deaktiviert, die Gutschrift sagt es; Aktivieren ist Handarbeit', async () => {
    const car = await listed(A.id, 'L-700')
    const invoice = await createInvoice(A.id, { partyId: partyA.id, vehicleId: car.id, lines })
    reset()
    const credit = await createCreditNote(A.id, null, invoice.id, { reason: 'Rückgabe', mode: 'full' })
    assert.equal(credit.vehicleEffect, 'released')
    assert.equal(credit.listingStaysInactive, true)
    assert.deepEqual(client.calls, [], 'es wird nichts von selbst wieder eingeschaltet')
    assert.equal((await getVehicle(A.id, car.id)).status, 'in_stock')

    await sync.activateAutoScout24Listing(A.id, car.id)
    assert.deepEqual(client.calls, [['activate', 'L-700']])
    assert.equal((await getVehicle(A.id, car.id)).autoscout24Active, true)

    // Teilgutschrift: Verkauf bleibt, also kein Hinweis
    const car2 = await listed(A.id, 'L-701')
    const inv2 = await createInvoice(A.id, { partyId: partyA.id, vehicleId: car2.id, lines })
    assert.equal((await createCreditNote(A.id, null, inv2.id, { reason: 'Nachlass', mode: 'partial', amountRappen: 10_000 })).listingStaysInactive, false)
  })

  await t.test('Mandanten: der Zustand eines Mandanten erscheint nirgends bei einem anderen', async () => {
    const other = await getListings(NOCRED.id)
    assert.ok(other.rows.every((r) => !String(r.listingId).startsWith('L-1') && r.id !== undefined))
    assert.equal(other.configured, false)
    assert.equal((await getListings(A.id)).configured, true)
  })
})
