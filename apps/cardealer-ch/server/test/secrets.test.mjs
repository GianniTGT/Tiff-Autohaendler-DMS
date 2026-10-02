import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptSecret, decryptSecret, isEncrypted } from '../src/services/secrets.js'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

test('Verschlüsseln und Entschlüsseln; jedes Mal ein anderer Geheimtext', () => {
  const env = { APP_SECRET_KEY: KEY_A }
  const a = encryptSecret('geheim', env)
  const b = encryptSecret('geheim', env)
  assert.equal(isEncrypted(a), true)
  assert.notEqual(a, b, 'zufälliger IV')
  assert.equal(a.includes('geheim'), false)
  assert.equal(decryptSecret(a, env), 'geheim')
  assert.equal(decryptSecret(b, env), 'geheim')
})

test('Falscher Schlüssel oder veränderter Geheimtext schlägt fehl, statt Müll zu liefern', () => {
  const stored = encryptSecret('geheim', { APP_SECRET_KEY: KEY_A })
  assert.throws(() => decryptSecret(stored, { APP_SECRET_KEY: KEY_B }))
  const parts = stored.split(':')
  parts[4] = Buffer.from('verfälscht').toString('base64')
  assert.throws(() => decryptSecret(parts.join(':'), { APP_SECRET_KEY: KEY_A }))
})

test('Klartext aus der Zeit davor wird weiter gelesen', () => {
  assert.equal(decryptSecret('altes-klartext-secret', { APP_SECRET_KEY: KEY_A }), 'altes-klartext-secret')
  assert.equal(decryptSecret(null), null)
})

test('Im Betrieb ohne Schlüssel wird nichts gespeichert; falsche Schlüssellänge wird abgelehnt', () => {
  assert.throws(() => encryptSecret('x', { NODE_ENV: 'production' }), /APP_SECRET_KEY fehlt/)
  assert.throws(() => encryptSecret('x', { APP_SECRET_KEY: 'zukurz' }), /32 Byte/)
  assert.equal(decryptSecret(encryptSecret('x', {}), {}), 'x', 'Entwicklung: fester Schlüssel')
})

test('Base64-Schlüssel funktioniert wie Hex', () => {
  const env = { APP_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') }
  assert.equal(decryptSecret(encryptSecret('x', env), env), 'x')
})
