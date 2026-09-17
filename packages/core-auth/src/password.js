/**
 * Passwort-Hashing mit scrypt (Node-Core, keine Abhängigkeit) — dasselbe
 * Verfahren wie `lib/auth.js` im US-Repo (Tiff-Cardealer-Manager), dort
 * bewährt und getestet. Format: `scrypt:<N>:<salt-hex>:<hash-hex>`, damit
 * die Kostenparameter mitwandern und sich künftig erhöhen lassen, ohne
 * bestehende Hashes ungültig zu machen.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const SCRYPT_N = 16384 // Kostenfaktor — 2^14, Node-Standard für interaktive Logins
const KEY_LENGTH = 64

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('Passwort muss mindestens 10 Zeichen haben.')
  }
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N })
  return `scrypt:${SCRYPT_N}:${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const [, nStr, saltHex, hashHex] = parts
  const n = Number(nStr)
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const derived = await scrypt(password, salt, expected.length, { N: n })
  return timingSafeEqual(derived, expected)
}
