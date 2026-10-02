/**
 * Öffentlicher Anfragen-Eingang der Website: Schlüssel, Spam-Falle, Begrenzung,
 * CORS, Mandantentrennung. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-intake-'))

const { closePool } = await import('@tiff/core-db')
const { registerRoutes } = await import('../src/routes/index.js')
const { createUser } = await import('../src/services/auth.js')
const { createVehicle } = await import('../src/services/vehicles.js')
const { listLeads } = await import('../src/services/leads.js')
const { RateLimiter, normalizeOrigin, hashKey, KEY_PREFIX } = await import('../src/services/lead-intake.js')

test('RateLimiter: gleitendes Fenster', () => {
  let now = 0
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now })
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow('a')), [true, true, true, false])
  assert.equal(limiter.allow('b'), true, 'anderer Schlüssel hat sein eigenes Fenster')
  now = 1001
  assert.equal(limiter.allow('a'), true, 'nach dem Fenster wieder frei')
})

test('Website-Adresse: nur https-Ursprung ohne Pfad', () => {
  assert.equal(normalizeOrigin('https://www.bit-automobile.ch'), 'https://www.bit-automobile.ch')
  assert.equal(normalizeOrigin('https://www.bit-automobile.ch/'), 'https://www.bit-automobile.ch')
  assert.equal(normalizeOrigin('http://localhost:8080'), 'http://localhost:8080')
  assert.equal(normalizeOrigin(''), null)
  assert.equal(normalizeOrigin(null), null)
  assert.throws(() => normalizeOrigin('http://www.bit-automobile.ch'), /https/)
  assert.throws(() => normalizeOrigin('https://www.bit-automobile.ch/kontakt'), /ohne Pfad/)
  assert.throws(() => normalizeOrigin('https://user:pw@x.ch'), /ohne Pfad/)
  assert.throws(() => normalizeOrigin('kein url'), /gültige Adresse/)
})

test('Anfragen-Eingang', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mk = async (name) => {
    const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`
    const id = (await adminPool.query("INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id", [name, slug])).rows[0].id
    return { id, slug }
  }
  const A = await mk('intake-a')
  const B = await mk('intake-b')
  const app = Fastify()
  await registerRoutes(app)
  await app.ready()

  t.after(async () => {
    await app.close()
    for (const { id } of [A, B]) {
      for (const table of ['leads', 'vehicles', 'sessions', 'users']) await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  await createUser({ tenantId: A.id, email: 'chef@a.ch', name: 'Chef', password: 'ChefPasswort123', role: 'inhaber' })
  await createUser({ tenantId: A.id, email: 'verkauf@a.ch', name: 'V', password: 'VerkaufPasswort1', role: 'verkauf' })
  const login = async (email, password) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: A.slug, email, password } })
    return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  }
  const owner = await login('chef@a.ch', 'ChefPasswort123')
  const seller = await login('verkauf@a.ch', 'VerkaufPasswort1')
  const car = await createVehicle(A.id, { make: 'VW', model: 'Golf' })
  const carB = await createVehicle(B.id, { make: 'Fremd', model: 'Auto' })

  const post = (slug, key, payload, headers = {}) =>
    app.inject({ method: 'POST', url: `/api/public/leads/${slug}`, headers: { ...(key ? { 'x-api-key': key } : {}), ...headers }, payload })

  let key
  await t.test('Schlüssel erzeugen: nur Inhaber; Klartext einmal, in der DB nur der Hash', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/tenant/lead-key', headers: { cookie: seller } })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: '/api/tenant/lead-key' })).statusCode, 401)
    const res = await app.inject({ method: 'POST', url: '/api/tenant/lead-key', headers: { cookie: owner } })
    assert.equal(res.statusCode, 201)
    key = res.json().data.key
    assert.ok(key.startsWith(KEY_PREFIX) && key.length > 40)
    const stored = (await adminPool.query('SELECT lead_key_hash FROM tenants WHERE id = $1', [A.id])).rows[0].lead_key_hash
    assert.equal(stored, hashKey(key))
    assert.equal(stored.includes(key), false)
    const settings = (await app.inject({ method: 'GET', url: '/api/tenant', headers: { cookie: owner } })).json().data
    assert.equal(settings.hasLeadKey, true)
    assert.equal(JSON.stringify(settings).includes(key), false, 'der Schlüssel wird nie wieder ausgeliefert')
  })

  await t.test('Anfrage mit gültigem Schlüssel wird angelegt (Quelle Website, Fahrzeug verknüpft)', async () => {
    const res = await post(A.slug, key, { name: 'Max Keller', email: 'max@example.ch', phone: '079 555 12 34', type: 'test_drive', message: 'Probefahrt?', vehicleId: car.id })
    assert.equal(res.statusCode, 201)
    const [lead] = await listLeads(A.id)
    assert.equal(lead.source, 'website')
    assert.equal(lead.type, 'test_drive')
    assert.equal(lead.status, 'new')
    assert.equal(lead.vehicleLabel, 'VW Golf')
  })

  await t.test('falscher Schlüssel, fehlender Schlüssel, fremder oder unbekannter Betrieb: immer dasselbe 401', async () => {
    const bodies = new Set()
    for (const [slug, k] of [[A.slug, 'tld_falsch'], [A.slug, null], [B.slug, key], ['gibt-es-nicht', key]]) {
      const res = await post(slug, k, { name: 'X', email: 'x@y.ch' })
      assert.equal(res.statusCode, 401, `${slug}/${k}`)
      bodies.add(res.body)
    }
    assert.equal(bodies.size, 1, 'gleiche Antwort — kein Abtasten')
    assert.deepEqual(await listLeads(B.id), [])
  })

  await t.test('Prüfung der Eingaben', async () => {
    const bad = async (payload, pattern) => {
      const res = await post(A.slug, key, payload)
      assert.equal(res.statusCode, 400, JSON.stringify(payload))
      assert.match(res.json().error, pattern)
    }
    await bad({ email: 'x@y.ch' }, /Namen/)
    await bad({ name: 'Max' }, /E-Mail oder Telefon/)
    await bad({ name: 'Max', email: 'x@y.ch', type: 'trade_in_xxl' }, /Anfrageart/)
    await bad({ name: 'Max', email: 'kaputt' }, /E-Mail/)
    await bad({ name: 'Max', email: 'x@y.ch', type: 'other' }, /Anfrageart/) // 'other' gibt es nur intern
  })

  await t.test('Fahrzeug eines anderen Betriebs wird nicht verknüpft; zu lange Texte werden gekürzt', async () => {
    const res = await post(A.slug, key, { name: 'N'.repeat(500), email: 'long@example.ch', message: 'm'.repeat(10_000), vehicleId: carB.id })
    assert.equal(res.statusCode, 201)
    const lead = (await listLeads(A.id)).find((l) => l.email === 'long@example.ch')
    assert.equal(lead.vehicleId, null)
    assert.equal(lead.name.length, 120)
    assert.equal(lead.message.length, 4000)
    const res2 = await post(A.slug, key, { name: 'Max2', email: 'm2@example.ch', vehicleId: 'keine-uuid' })
    assert.equal(res2.statusCode, 201)
  })

  await t.test('Spam-Falle: ausgefülltes Verstecktfeld meldet ok, legt aber nichts an', async () => {
    const before = (await listLeads(A.id)).length
    const res = await post(A.slug, key, { name: 'Bot', email: 'bot@spam.ch', website: 'http://spam.example' })
    assert.equal(res.statusCode, 201)
    assert.equal((await listLeads(A.id)).length, before)
  })

  await t.test('CORS: nur die hinterlegte Website-Adresse', async () => {
    const origin = 'https://www.garage-a.ch'
    const cors = (o) => app.inject({ method: 'OPTIONS', url: `/api/public/leads/${A.slug}`, headers: { origin: o } })
    assert.equal((await cors(origin)).headers['access-control-allow-origin'], undefined, 'noch nichts hinterlegt')

    const set = await app.inject({ method: 'PATCH', url: '/api/tenant', headers: { cookie: owner }, payload: { leadAllowedOrigin: 'https://www.garage-a.ch/kontakt' } })
    assert.equal(set.statusCode, 400)
    const ok = await app.inject({ method: 'PATCH', url: '/api/tenant', headers: { cookie: owner }, payload: { leadAllowedOrigin: origin } })
    assert.equal(ok.statusCode, 200)

    const pre = await cors(origin)
    assert.equal(pre.statusCode, 204)
    assert.equal(pre.headers['access-control-allow-origin'], origin)
    assert.match(pre.headers['access-control-allow-headers'], /X-Api-Key/i)
    assert.equal((await cors('https://boese-seite.example')).headers['access-control-allow-origin'], undefined)

    const real = await post(A.slug, key, { name: 'CORS Test', email: 'c@example.ch' }, { origin })
    assert.equal(real.statusCode, 201)
    assert.equal(real.headers['access-control-allow-origin'], origin)
    const foreign = await post(A.slug, key, { name: 'CORS Fremd', email: 'f@example.ch' }, { origin: 'https://boese-seite.example' })
    assert.equal(foreign.headers['access-control-allow-origin'], undefined)
  })

  await t.test('Begrenzung: ab der 11. Anfrage pro Minute gibt es 429', async () => {
    const codes = []
    for (let i = 0; i < 14; i++) codes.push((await post(A.slug, key, { name: `Flut ${i}`, email: `f${i}@example.ch` })).statusCode)
    assert.ok(codes.includes(429), codes.join(','))
    assert.equal(codes.at(-1), 429)
  })

  await t.test('Widerrufen: der alte Schlüssel ist sofort wertlos; ein neuer ersetzt den alten', async () => {
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/tenant/lead-key', headers: { cookie: seller } })).statusCode, 403)
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/tenant/lead-key', headers: { cookie: owner } })).statusCode, 200)
    assert.equal((await post(A.slug, key, { name: 'X', email: 'x@y.ch' })).statusCode, 401)

    const fresh1 = (await app.inject({ method: 'POST', url: '/api/tenant/lead-key', headers: { cookie: owner } })).json().data.key
    const fresh2 = (await app.inject({ method: 'POST', url: '/api/tenant/lead-key', headers: { cookie: owner } })).json().data.key
    assert.notEqual(fresh1, fresh2)
    assert.equal((await post(A.slug, fresh1, { name: 'X', email: 'x@y.ch' })).statusCode, 401, 'der ersetzte Schlüssel gilt nicht mehr')
  })
})
