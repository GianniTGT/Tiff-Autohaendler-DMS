/**
 * Regressionstests zu den Befunden eines unabhängigen Reviews: jeder Test
 * hält einen konkreten Fehler fest, der real gefunden wurde.
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
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-fixes-'))

const { francsToRappen } = await import('@tiff/core-billing')
const { closePool } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle, updateVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const users = await import('../src/services/users.js')
const { csvCell } = await import('../src/services/archive-browser.js')
const { RateLimiter, acceptPublicLead, generateLeadKey } = await import('../src/services/lead-intake.js')

test('Betragseingabe: Schweizer Schreibweisen ja, NaN nie (sonst würde ein Preis still gelöscht)', () => {
  assert.equal(francsToRappen('12500.50'), 1_250_050)
  assert.equal(francsToRappen("12'500"), 1_250_000)
  assert.equal(francsToRappen('12’500.00'), 1_250_000)
  assert.equal(francsToRappen('12 500,5'), 1_250_050)
  assert.equal(francsToRappen(''), null)
  assert.equal(francsToRappen(null), null)
  assert.equal(francsToRappen(14900), 1_490_000)
  for (const bad of ['abc', '12.345', '1e3', '12,50,5', 'CHF 100']) {
    assert.throws(() => francsToRappen(bad), /kein gültiger Betrag/, bad)
  }
  assert.throws(() => francsToRappen(NaN), /Ungültig/)
  // genau der Fehlerfall des Reviews: JSON macht aus NaN ein null
  assert.equal(JSON.stringify({ v: NaN }), '{"v":null}')
})

test('CSV: Formelzeichen am Anfang werden entschärft', () => {
  assert.equal(csvCell('=HYPERLINK("http://böse")'), `"'=HYPERLINK(""http://böse"")"`)
  assert.equal(csvCell('+41 79 123'), `"'+41 79 123"`)
  assert.equal(csvCell('-1+1'), `"'-1+1"`)
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`)
  assert.equal(csvCell('\tTab'), `"'\tTab"`)
  assert.equal(csvCell('Hans Muster'), '"Hans Muster"')
  assert.equal(csvCell('mit = in der Mitte'), '"mit = in der Mitte"')
  assert.equal(csvCell(null), '""')
})

test('Anfragen-Eingang: Versuche werden vor der Schlüsselprüfung begrenzt', async () => {
  const attempts = new RateLimiter({ limit: 3, windowMs: 60_000 })
  const call = () => acceptPublicLead({ slug: 'gibt-es-nicht', key: 'x', payload: {}, clientId: '1.2.3.4', attemptLimiter: attempts }).catch((e) => e.status)
  assert.deepEqual([await call(), await call(), await call(), await call()].filter((c) => c === 429).length >= 1, true)
  assert.equal(await call(), 429)
})

test('Review-Befunde', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'fix-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city) VALUES (gen_random_uuid(), 'Fix', 'Fix AG', $1, 'Weg 1', '3000', 'Bern') RETURNING id`,
      [slug],
    )
  ).rows[0].id
  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    await app.close()
    for (const table of ['audit_log', 'document_lines', 'documents', 'number_sequences', 'vehicles', 'parties', 'sessions', 'users']) {
      if (table === 'document_lines') await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
      else await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId])
    }
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const cookies = {}
  const roles = { inhaber: 'ChefPasswort123', verkauf: 'VerkaufPasswort1', werkstatt: 'WerkstattPass123' }
  for (const [role, password] of Object.entries(roles)) {
    await createUser({ tenantId, email: `${role}@fix.ch`, name: role, password, role })
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: slug, email: `${role}@fix.ch`, password } })
    cookies[role] = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  }
  const call = (role, method, url, payload) => app.inject({ method, url, headers: { cookie: cookies[role] }, payload })

  await t.test('Preis leeren setzt auch die fiktive Vorsteuer zurück (Beweislage gegenüber der ESTV)', async () => {
    const car = await createVehicle(tenantId, { make: 'VW', model: 'Golf', purchasePriceRappen: 1_000_000, purchaseFrom: 'private', purchasedAt: '2026-05-01' })
    assert.ok(Number(car.notionalInputTaxRappen) > 0)
    const cleared = await updateVehicle(tenantId, car.id, { purchasePriceRappen: null })
    assert.equal(cleared.purchasePriceRappen, null)
    assert.equal(Number(cleared.notionalInputTaxRappen), 0, 'ohne Preis keine fiktive Vorsteuer')

    const back = await updateVehicle(tenantId, car.id, { purchasePriceRappen: 1_000_000 })
    assert.ok(Number(back.notionalInputTaxRappen) > 0)
    const fromPrivate = await updateVehicle(tenantId, car.id, { purchaseFrom: null })
    assert.equal(Number(fromPrivate.notionalInputTaxRappen), 0, 'Herkunft geleert: nicht mehr Privatkauf')
    const unrelated = await updateVehicle(tenantId, car.id, { notes: 'nur eine Notiz' })
    assert.equal(unrelated.purchasePriceRappen, '1000000', 'nicht genannte Felder bleiben')
  })

  await t.test('Geldfelder: nur ganze Rappen — NaN/null aus dem Formular darf keinen Preis löschen', async () => {
    const car = await createVehicle(tenantId, { make: 'Audi', purchasePriceRappen: 500_000 })
    for (const bad of [1.5, -1, 'abc', NaN]) {
      await assert.rejects(updateVehicle(tenantId, car.id, { purchasePriceRappen: bad }), /ganze Rappen/, String(bad))
      await assert.rejects(createVehicle(tenantId, { askingPriceRappen: bad }), /ganze Rappen/, String(bad))
    }
    // über HTTP: JSON.stringify(NaN) ist null — das ist beabsichtigtes Leeren, das Frontend darf es nur bei leerem Feld senden
    const res = await call('inhaber', 'PATCH', `/api/vehicles/${car.id}`, { purchasePriceRappen: 'abc' })
    assert.equal(res.statusCode, 400)
    assert.equal((await call('inhaber', 'GET', `/api/vehicles/${car.id}`)).json().data.purchasePriceRappen, '500000')
  })

  await t.test('Anmeldung ohne Beachtung der Gross-/Kleinschreibung der E-Mail', async () => {
    await users.addUser(tenantId, { name: 'Anna', email: 'Anna@Fix.ch', password: 'AnnaPasswort1234', role: 'verkauf' })
    for (const email of ['Anna@Fix.ch', 'anna@fix.ch', 'ANNA@FIX.CH']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: slug, email, password: 'AnnaPasswort1234' } })
      assert.equal(res.statusCode, 200, email)
    }
  })

  await t.test('Ungültige IDs/Datumswerte: 400 ohne SQL-Text statt 500', async () => {
    for (const url of ['/api/vehicles/keine-uuid', '/api/vehicles/keine-uuid/costs', '/api/invoices/xyz', '/api/invoices-overdue?asOf=gestern']) {
      const res = await call('inhaber', 'GET', url)
      assert.ok([400, 404].includes(res.statusCode), `${url}: ${res.statusCode}`)
      assert.equal(/invalid input|syntax|uuid|SELECT|ungültige Eingabesyntax/i.test(res.body) && res.statusCode >= 500, false)
      assert.equal(/ungültige Eingabesyntax|invalid input syntax/i.test(res.body), false, `kein SQL-Text in ${url}`)
    }
    const res = await call('inhaber', 'PATCH', '/api/users/keine-uuid', { active: false })
    assert.equal(res.statusCode, 400)
    assert.equal(res.json().error, 'Ungültige Eingabe.')
  })

  await t.test('Werkstatt: keine Einkaufspreise, keine Wirtschaftlichkeit, kein Rechnungswesen — Verkauf sieht sie', async () => {
    const car = await createVehicle(tenantId, { make: 'BMW', model: '320d', purchasePriceRappen: 2_000_000, askingPriceRappen: 2_600_000 })
    const listed = (role) => call(role, 'GET', '/api/vehicles').then((r) => r.json().data.find((v) => v.id === car.id))
    assert.equal((await listed('verkauf')).purchasePriceRappen, '2000000')
    const asWorkshop = await listed('werkstatt')
    assert.equal(asWorkshop.make, 'BMW')
    for (const field of ['purchasePriceRappen', 'soldPriceRappen', 'purchaseVatRappen', 'notionalInputTaxRappen']) {
      assert.equal(field in asWorkshop, false, `${field} nicht für die Werkstatt`)
    }
    const detail = (await call('werkstatt', 'GET', `/api/vehicles/${car.id}`)).json().data
    assert.equal('purchasePriceRappen' in detail, false)

    assert.equal((await call('werkstatt', 'GET', `/api/vehicles/${car.id}/economics`)).statusCode, 403)
    assert.equal((await call('verkauf', 'GET', `/api/vehicles/${car.id}/economics`)).statusCode, 200)
    for (const [method, url] of [
      ['GET', '/api/invoices'], ['GET', '/api/archive'], ['GET', '/api/invoices-overdue'],
      ['GET', `/api/vehicles/${car.id}/contracts`], ['GET', `/api/vehicles/${car.id}/ankaufsvertrag.pdf`],
    ]) {
      assert.equal((await call('werkstatt', method, url)).statusCode, 403, `${method} ${url}`)
    }
    assert.equal((await call('werkstatt', 'POST', `/api/vehicles/${car.id}/sell`, { soldPriceRappen: 1 })).statusCode, 403)
    assert.equal((await call('werkstatt', 'POST', '/api/invoices', { lines: [] })).statusCode, 403)

    // Werkstatt darf Technisches ändern, aber keine Preise oder den Status setzen
    const patched = await call('werkstatt', 'PATCH', `/api/vehicles/${car.id}`, { mileageKm: 91000, purchasePriceRappen: 1, askingPriceRappen: 1, status: 'sold' })
    assert.equal(patched.statusCode, 200)
    const real = await listVehiclesAdmin(car.id)
    assert.equal(real.mileage_km, 91000)
    assert.equal(real.purchase_price_rappen, '2000000', 'Preis blieb')
    assert.equal(real.asking_price_rappen, '2600000')
    assert.equal(real.status, 'in_stock')
    // Kosten gehören zur Werkstatt
    assert.equal((await call('werkstatt', 'POST', `/api/vehicles/${car.id}/costs`, { kind: 'part', description: 'Filter', amountRappen: 3000 })).statusCode, 201)
  })

  async function listVehiclesAdmin(id) {
    return (await adminPool.query('SELECT * FROM vehicles WHERE id = $1', [id])).rows[0]
  }

  await t.test('PDF-Abruf einer unvollständigen Rechnung archiviert sie NICHT (kein Einfrieren des Mangels)', async () => {
    const party = await createParty(tenantId, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
    const created = await call('inhaber', 'POST', '/api/invoices', { partyId: party.id, lines: [{ description: 'Test', quantity: 1, unitPriceRappen: 100_000 }] })
    assert.equal(created.statusCode, 201)
    const id = created.json().data.id
    assert.equal(created.json().data.archive.archived, false, 'ohne QR-IBAN nicht archiviert')

    const pdf = await call('inhaber', 'GET', `/api/invoices/${id}/pdf`)
    assert.equal(pdf.statusCode, 200)
    assert.equal(pdf.headers['content-type'], 'application/pdf')
    const row = (await adminPool.query('SELECT pdf_hash, pdf_storage_key FROM documents WHERE id = $1', [id])).rows[0]
    assert.equal(row.pdf_hash, null, 'Abruf hat nichts festgeschrieben')

    const now = await call('inhaber', 'POST', `/api/documents/${id}/archive`)
    assert.equal(now.json().data.archived, false)
    assert.match(now.json().data.reason, /QR-IBAN/)

    // QR-IBAN nachträglich hinterlegt: diese alte Rechnung hat keine QR-Referenz und bleibt unarchiviert (klare Meldung, kein Absturz)
    await call('inhaber', 'PATCH', '/api/tenant', { qrIban: 'CH44 3199 9123 0008 8901 2' })
    const late = await call('inhaber', 'POST', `/api/documents/${id}/archive`)
    assert.equal(late.json().data.archived, false)
    assert.match(late.json().data.reason, /bevor eine QR-IBAN hinterlegt war/)
    assert.equal((await call('inhaber', 'GET', `/api/invoices/${id}/pdf`)).statusCode, 200, 'das PDF lässt sich trotzdem abrufen (mit Hinweis)')
    assert.equal((await adminPool.query('SELECT pdf_hash FROM documents WHERE id = $1', [id])).rows[0].pdf_hash, null)

    // Eine neue Rechnung ist vollständig: sofort archiviert, Hash stimmt
    const fresh = await call('inhaber', 'POST', '/api/invoices', { partyId: party.id, lines: [{ description: 'Neu', quantity: 1, unitPriceRappen: 100_000 }] })
    const freshId = fresh.json().data.id
    assert.equal(fresh.json().data.archive.archived, true, JSON.stringify(fresh.json().data.archive))
    assert.equal((await call('inhaber', 'GET', `/api/documents/${freshId}/verify`)).json().data.ok, true)
    assert.equal((await call('inhaber', 'POST', `/api/documents/${freshId}/archive`)).json().data.archived, true, 'zweimal ist harmlos')
    assert.equal((await call('inhaber', 'POST', '/api/documents/00000000-0000-0000-0000-000000000000/archive')).statusCode, 404)
  })

  await t.test('Letzter Inhaber: gleichzeitiges gegenseitiges Herabstufen lässt mindestens einen übrig', async () => {
    const a = await users.addUser(tenantId, { name: 'Owner A', email: 'oa@fix.ch', password: 'OwnerAPasswort12', role: 'inhaber' })
    const b = await users.addUser(tenantId, { name: 'Owner B', email: 'ob@fix.ch', password: 'OwnerBPasswort12', role: 'inhaber' })
    // alle anderen Inhaber (der Chef aus der Anmeldung) zuerst abstufen, damit nur A und B übrig sind
    const all = await users.listUsers(tenantId)
    for (const u of all.filter((x) => x.role === 'inhaber' && ![a.id, b.id].includes(x.id))) await users.updateUser(tenantId, a.id, u.id, { role: 'verkauf' })

    const results = await Promise.allSettled([
      users.updateUser(tenantId, a.id, b.id, { role: 'verkauf' }),
      users.updateUser(tenantId, b.id, a.id, { role: 'verkauf' }),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'genau eine Änderung geht durch')
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /mindestens ein aktiver Inhaber/)
    const owners = (await users.listUsers(tenantId)).filter((u) => u.role === 'inhaber' && u.active)
    assert.equal(owners.length, 1)
  })
})
