/**
 * HTTP-Ebene: wer darf welchen Endpunkt? Läuft die echte Route-Registrierung
 * gegen echtes PostgreSQL (Fastify `inject`, kein Netzwerk) und prüft die
 * Rollenmatrix quer über alle sensiblen Endpunkte — dort, wo eine vergessene
 * Prüfung sonst unbemerkt bliebe. Dazu die Berichte und die Zähler der
 * Übersicht. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-http-'))

const { closePool } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle, sellVehicle } = await import('../src/services/vehicles.js')
const { addCost } = await import('../src/services/vehicle-costs.js')
const { createJob } = await import('../src/services/recon.js')

const PASSWORD = 'RollenTest12345'
const ROLES = ['inhaber', 'buchhaltung', 'verkauf', 'werkstatt']

test('Rollenmatrix über HTTP, Berichte, Zähler', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'http-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, vat_method) VALUES (gen_random_uuid(), 'Http', 'Http AG', $1, 'effective') RETURNING id`,
      [slug],
    )
  ).rows[0].id

  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    await app.close()
    for (const table of ['recon_jobs', 'vehicle_costs', 'vehicles', 'sessions', 'users']) {
      await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId])
    }
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  // Je Rolle eine angemeldete Person
  const cookies = {}
  for (const role of ROLES) {
    await createUser({ tenantId, email: `${role}@http.ch`, name: role, password: PASSWORD, role })
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: slug, email: `${role}@http.ch`, password: PASSWORD } })
    assert.equal(res.statusCode, 200, `Login ${role}`)
    cookies[role] = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  }
  const call = (role, method, url, payload) => app.inject({ method, url, headers: role ? { cookie: cookies[role] } : {}, payload })

  // Testdaten: ein verkauftes Fahrzeug mit Kosten, eines im Bestand mit Auftrag
  const sold = await createVehicle(tenantId, { make: 'VW', model: 'Golf', purchasePriceRappen: 1_000_000, askingPriceRappen: 1_300_000, purchasedAt: '2026-06-01' })
  await addCost(tenantId, sold.id, { kind: 'part', description: 'Teil', amountRappen: 50_000 })
  await sellVehicle(tenantId, sold.id, { soldPriceRappen: 1_300_000, soldAt: '2026-08-10' })
  const stock = await createVehicle(tenantId, { make: 'Audi', model: 'A3', purchasePriceRappen: 1_500_000, purchasedAt: '2026-01-01' })
  await createJob(tenantId, { vehicleId: stock.id, kind: 'part', description: 'Bremsen', dueDate: '2020-01-01' })

  await t.test('ohne Anmeldung ist jeder geschützte Endpunkt zu', async () => {
    for (const [method, url] of [
      ['GET', '/api/vehicles'], ['GET', '/api/dashboard'], ['GET', '/api/reports/sales?from=2026-01-01&to=2026-12-31'],
      ['GET', '/api/reports/stock'], ['GET', '/api/archive'], ['GET', '/api/archive/export.zip'], ['GET', '/api/users'],
      ['GET', '/api/tenant'], ['GET', '/api/calendar?from=2026-10-01&to=2026-10-31'], ['GET', '/api/leads'],
    ]) {
      assert.equal((await call(null, method, url)).statusCode, 401, `${method} ${url}`)
    }
  })

  await t.test('Rollenmatrix: nur Inhaber/Buchhaltung sehen Firmenzahlen und Export; nur Inhaber verwaltet', async () => {
    const expect = {
      //                                            inhaber buchhaltung verkauf werkstatt
      'GET /api/reports/sales?from=2026-01-01&to=2026-12-31': [200, 200, 403, 403],
      'GET /api/reports/stock': [200, 200, 403, 403],
      'GET /api/reports/vat?from=2026-01-01&to=2026-12-31': [200, 200, 403, 403],
      'GET /api/archive/export.zip': [200, 200, 403, 403],
      'GET /api/users': [200, 403, 403, 403],
      'PATCH /api/tenant': [200, 403, 403, 403],
      'POST /api/tenant/logo': [400, 403, 403, 403], // 400 = Rolle ok, aber kein Bild gesendet
      'GET /api/archive': [200, 200, 200, 403],
      'GET /api/calendar?from=2026-10-01&to=2026-10-31': [200, 200, 200, 200],
      'GET /api/vehicles': [200, 200, 200, 200],
      'GET /api/leads': [200, 200, 200, 200],
    }
    for (const [key, codes] of Object.entries(expect)) {
      const [method, url] = key.split(' ')
      for (const [i, role] of ROLES.entries()) {
        const payload = method === 'PATCH' ? { name: 'Http' } : method === 'POST' ? Buffer.from('kein Bild') : undefined
        const headers = { cookie: cookies[role], ...(method === 'POST' ? { 'content-type': 'application/octet-stream' } : {}) }
        const res = await app.inject({ method, url, headers, payload })
        assert.equal(res.statusCode, codes[i], `${key} als ${role}`)
      }
    }
  })

  await t.test('Übersicht: Summen nur mit Berechtigung; Zähler für Aufträge', async () => {
    const owner = (await call('inhaber', 'GET', '/api/dashboard')).json().data
    const seller = (await call('verkauf', 'GET', '/api/dashboard')).json().data
    assert.ok(owner.money)
    assert.equal(seller.money, null)
    assert.equal(seller.soldThisYear.profitRappen, null)
    assert.deepEqual(owner.openJobs, { open: 1, overdue: 1 })
    assert.deepEqual(seller.openJobs, { open: 1, overdue: 1 }, 'Aufträge enthalten keine Beträge')
  })

  await t.test('Verkaufsbericht über HTTP: Gewinn, Standzeit, Eingabeprüfung', async () => {
    const res = await call('buchhaltung', 'GET', '/api/reports/sales?from=2026-01-01&to=2026-12-31')
    const { rows, totals } = res.json().data
    assert.equal(rows.length, 1)
    assert.equal(rows[0].profitRappen, 250_000)
    assert.equal(rows[0].daysInStock, 70)
    assert.equal(totals.profitRappen, 250_000)
    assert.equal((await call('inhaber', 'GET', '/api/reports/sales?from=heute&to=2026-12-31')).statusCode, 400)
    assert.equal((await call('inhaber', 'GET', '/api/reports/sales?from=2026-12-31&to=2026-01-01')).statusCode, 400)
  })

  await t.test('Lagerbericht über HTTP: das Fahrzeug im Bestand erscheint, das verkaufte nicht', async () => {
    const report = (await call('inhaber', 'GET', '/api/reports/stock')).json().data
    assert.equal(report.total.count, 1)
    assert.equal(report.total.investedRappen, 1_500_000)
    assert.equal(report.buckets.find((b) => b.key === 'd91_plus').count, 1)
  })

  await t.test('gesperrte Person: Sitzung sofort ungültig', async () => {
    await adminPool.query("UPDATE users SET active = false WHERE tenant_id = $1 AND role = 'werkstatt'", [tenantId])
    assert.equal((await call('werkstatt', 'GET', '/api/vehicles')).statusCode, 401)
    assert.equal((await call('verkauf', 'GET', '/api/vehicles')).statusCode, 200)
  })
})
