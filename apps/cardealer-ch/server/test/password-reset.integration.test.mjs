/**
 * Passwort per E-Mail zurücksetzen — Mail-Transport ersetzt (kein SMTP nötig).
 * Zusagen: dieselbe Antwort für unbekannte Konten; Link aus der Mail setzt das Passwort und beendet
 * Sitzungen; Link nur einmal und nur eine Stunde; zu kurzes Passwort wird abgelehnt; ein neuer Antrag
 * macht den alten Link ungültig; die HTTP-Routen. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import Fastify from 'fastify'
import { closePool } from '@tiff/core-db'
import { registerRoutes } from '../src/routes/index.js'
import { createUser, login, validateSessionCookie, encodeSessionCookie } from '../src/services/auth.js'
import { configureMailTransport } from '../src/services/mail.js'
import { requestPasswordReset, resetPassword, RESET_LIFETIME_MS } from '../src/services/password-reset.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

function mailbox() {
  const sent = []
  return {
    sent,
    async sendMail(message) {
      sent.push(message)
      return { accepted: [message.to] }
    },
    lastLink() {
      const m = sent.at(-1)?.text.match(/https?:\/\/\S+\?reset=([^\s]+)/)
      return m ? m[1] : null
    },
  }
}

test('Passwort per E-Mail zurücksetzen', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'reset-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query("INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'R', 'R AG', $1) RETURNING id", [slug])
  ).rows[0].id
  const email = 'anna@reset.ch'
  await createUser({ tenantId, email, name: 'Anna', password: 'AltesPasswort1', role: 'verkauf' })
  const mails = mailbox()
  configureMailTransport(mails)

  t.after(async () => {
    configureMailTransport(null)
    for (const table of ['password_resets', 'sessions', 'users']) await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  await t.test('unbekannte Adresse oder Betrieb: dieselbe Antwort, keine Mail', async () => {
    assert.deepEqual(await requestPasswordReset({ tenantSlug: slug, email: 'niemand@reset.ch', baseUrl: 'http://app.test' }), { requested: true })
    assert.deepEqual(await requestPasswordReset({ tenantSlug: 'gibt-es-nicht', email, baseUrl: 'http://app.test' }), { requested: true })
    assert.equal(mails.sent.length, 0)
  })

  await t.test('Link aus der Mail setzt das Passwort, beendet Sitzungen, gilt nur einmal', async () => {
    const session = await login({ tenantSlug: slug, email, password: 'AltesPasswort1' })
    const cookie = encodeSessionCookie(session.tenantId, session.sessionId)
    assert.ok(await validateSessionCookie(cookie))

    await requestPasswordReset({ tenantSlug: slug, email: email.toUpperCase(), baseUrl: 'http://app.test/' })
    assert.equal(mails.sent.length, 1)
    assert.equal(mails.sent[0].to, email)
    assert.match(mails.sent[0].text, /http:\/\/app\.test\/\?reset=/)
    const token = mails.lastLink()
    assert.ok(token.startsWith(`${tenantId}.`))

    await assert.rejects(() => resetPassword({ token, password: 'kurz' }), /mindestens 10 Zeichen/)
    assert.deepEqual(await resetPassword({ token, password: 'NeuesPasswort22' }), { ok: true })

    assert.equal(await validateSessionCookie(cookie), null, 'alte Sitzung ist beendet')
    await assert.rejects(() => login({ tenantSlug: slug, email, password: 'AltesPasswort1' }))
    assert.ok(await login({ tenantSlug: slug, email, password: 'NeuesPasswort22' }))

    await assert.rejects(() => resetPassword({ token, password: 'NochEinPasswort3' }), /abgelaufen oder wurde schon verwendet/)
  })

  await t.test('abgelaufener Link, kaputter Link, fremder Mandant', async () => {
    const past = () => Date.now() - RESET_LIFETIME_MS - 1000
    await requestPasswordReset({ tenantSlug: slug, email, baseUrl: 'http://app.test' }, { now: past })
    await assert.rejects(() => resetPassword({ token: mails.lastLink(), password: 'NeuesPasswort33' }), /abgelaufen/)
    await assert.rejects(() => resetPassword({ token: 'kein-punkt', password: 'NeuesPasswort33' }), /ungültig/)
    await requestPasswordReset({ tenantSlug: slug, email, baseUrl: 'http://app.test' })
    const [, token] = mails.lastLink().split('.')
    await assert.rejects(() => resetPassword({ token: `00000000-0000-0000-0000-000000000000.${token}`, password: 'NeuesPasswort33' }), /ungültig/)
    await assert.rejects(() => resetPassword({ token: `nicht-uuid.${token}`, password: 'NeuesPasswort33' }), /ungültig/)
  })

  await t.test('ein neuer Antrag macht den alten Link ungültig', async () => {
    await requestPasswordReset({ tenantSlug: slug, email, baseUrl: 'http://app.test' })
    const first = mails.lastLink()
    await requestPasswordReset({ tenantSlug: slug, email, baseUrl: 'http://app.test' })
    const second = mails.lastLink()
    assert.notEqual(first, second)
    await assert.rejects(() => resetPassword({ token: first, password: 'NeuesPasswort44' }))
    assert.deepEqual(await resetPassword({ token: second, password: 'NeuesPasswort44' }), { ok: true })
  })

  await t.test('HTTP: /api/auth/forgot antwortet immer ok, /api/auth/reset setzt das Passwort', async () => {
    // Eigene Person: die Service-Tests oben haben das Kontingent (5 Anträge je Adresse und Viertelstunde) aufgebraucht.
    const email = 'ben@reset.ch'
    await createUser({ tenantId, email, name: 'Ben', password: 'AltesPasswort9', role: 'werkstatt' })
    const app = Fastify()
    await registerRoutes(app)
    await app.ready()
    try {
      const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { tenantSlug: slug, email }, headers: { host: 'app.test:5173' } })
      assert.equal(forgot.statusCode, 200)
      assert.deepEqual(forgot.json(), { ok: true })
      assert.match(mails.sent.at(-1).text, /http:\/\/app\.test:5173\/\?reset=/, 'Link aus dem Host der Anfrage, wenn APP_BASE_URL fehlt')

      const missing = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email } })
      assert.equal(missing.statusCode, 400)

      const bad = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token: 'x.y', password: 'NeuesPasswort55' } })
      assert.equal(bad.statusCode, 400)
      assert.match(bad.json().error, /ungültig/)

      const short = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token: mails.lastLink(), password: 'kurz' } })
      assert.equal(short.statusCode, 400)
      assert.match(short.json().error, /10 Zeichen/)

      const ok = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token: mails.lastLink(), password: 'NeuesPasswort55' } })
      assert.equal(ok.statusCode, 200)
      const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenantSlug: slug, email, password: 'NeuesPasswort55' } })
      assert.equal(loginRes.statusCode, 200)
    } finally {
      await app.close()
    }
  })
})
