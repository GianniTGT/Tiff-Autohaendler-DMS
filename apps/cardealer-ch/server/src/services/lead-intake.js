/**
 * Anfragen von der Website des Betriebs — ohne Sitzung, mit Schlüssel.
 *
 *  - Der Schlüssel wird einmal angezeigt und nur als SHA-256 gespeichert; wer
 *    die Datenbank liest, kann damit keine Anfragen einschleusen.
 *  - Ein Schlüssel kann nur Anfragen anlegen, nichts lesen und nichts
 *    ändern — er öffnet genau eine Tür.
 *  - Fehlermeldungen unterscheiden nicht zwischen "falscher Slug" und
 *    "falscher Schlüssel" (kein Abtasten, welche Betriebe es gibt).
 *  - Ein verstecktes Feld (`website`) fängt einfache Spam-Bots: Wer es
 *    ausfüllt, bekommt ein "ok", aber es entsteht keine Anfrage.
 *  - Begrenzung pro Betrieb und Adresse (RateLimiter, im Speicher dieses
 *    Prozesses — bei mehreren Servern wäre ein gemeinsamer Speicher nötig).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { withTenant, withoutTenant } from '@tiff/core-db'
import { createLead } from './leads.js'

export const KEY_PREFIX = 'tld_'
const PUBLIC_TYPES = ['inquiry', 'test_drive', 'trade_in', 'financing']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class IntakeError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex')

/** Erzeugt einen neuen Schlüssel (ersetzt den alten). Der Klartext wird nur hier zurückgegeben. */
export async function generateLeadKey(tenantId) {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url')
  await withTenant(tenantId, (client) => client.query('UPDATE tenants SET lead_key_hash = $1 WHERE id = $2', [hashKey(key), tenantId]))
  return key
}

export async function revokeLeadKey(tenantId) {
  await withTenant(tenantId, (client) => client.query('UPDATE tenants SET lead_key_hash = NULL WHERE id = $1', [tenantId]))
}

/** Erlaubte Website-Adresse: nur `https://host[:port]` (oder localhost für Tests), kein Pfad. */
export function normalizeOrigin(value) {
  if (value == null || String(value).trim() === '') return null
  let url
  try {
    url = new URL(String(value).trim())
  } catch {
    throw new Error('Das ist keine gültige Adresse (z.B. https://www.meine-garage.ch).')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Die Website-Adresse muss mit https:// beginnen.')
  if (url.pathname !== '/' || url.search || url.hash || url.username) throw new Error('Nur die Adresse der Website angeben, ohne Pfad (z.B. https://www.meine-garage.ch).')
  return url.origin
}

/** Gleitendes Fenster: höchstens `limit` Anfragen je Schlüssel in `windowMs`. */
export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() }) {
    Object.assign(this, { limit, windowMs, now, hits: new Map() })
  }

  /** @returns {boolean} true = erlaubt */
  allow(key) {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k)
    return true
  }
}

const defaultLimiter = new RateLimiter({ limit: 10, windowMs: 60_000 })

async function lookup(slug) {
  const result = await withoutTenant((client) =>
    client.query('SELECT id, lead_key_hash, lead_allowed_origin FROM tenant_lead_intake WHERE slug = $1', [String(slug)]),
  )
  return result.rows[0] ?? null
}

/** Nur für CORS: die erlaubte Adresse dieses Betriebs, ohne den Schlüssel zu prüfen. */
export async function allowedOriginFor(slug) {
  return (await lookup(slug))?.lead_allowed_origin ?? null
}

const clean = (v, max) => (v == null ? '' : String(v).trim().slice(0, max))

/**
 * @param {object} input { slug, key, payload, clientId, limiter }
 * @returns {Promise<{ok: true, accepted: boolean}>} `accepted: false` bei Spam-Falle — der Aufrufer meldet trotzdem "ok"
 * @throws {IntakeError}
 */
export async function acceptPublicLead({ slug, key, payload, clientId = 'unknown', limiter = defaultLimiter }) {
  const tenant = await lookup(slug)
  const given = Buffer.from(hashKey(key ?? ''), 'hex')
  const expected = Buffer.from(tenant?.lead_key_hash ?? '0'.repeat(64), 'hex')
  // Immer vergleichen (auch ohne Betrieb), damit die Antwortzeit nichts verrät.
  const valid = given.length === expected.length && timingSafeEqual(given, expected) && Boolean(tenant)
  if (!valid) throw new IntakeError(401, 'Ungültiger Schlüssel.')

  if (!limiter.allow(`${tenant.id}:${clientId}`)) throw new IntakeError(429, 'Zu viele Anfragen. Bitte später erneut versuchen.')

  const body = payload && typeof payload === 'object' ? payload : {}
  if (clean(body.website, 200)) return { ok: true, accepted: false } // Spam-Falle

  const name = clean(body.name, 120)
  const email = clean(body.email, 200)
  const phone = clean(body.phone, 50)
  const message = clean(body.message, 4000)
  const type = body.type == null || body.type === '' ? 'inquiry' : String(body.type)
  if (!PUBLIC_TYPES.includes(type)) throw new IntakeError(400, 'Unbekannte Anfrageart.')
  if (!name) throw new IntakeError(400, 'Bitte einen Namen angeben.')
  if (!email && !phone) throw new IntakeError(400, 'Bitte E-Mail oder Telefon angeben.')

  // Fahrzeug nur verknüpfen, wenn es diesem Betrieb gehört — sonst stillschweigend ohne.
  let vehicleId = null
  if (body.vehicleId && UUID.test(String(body.vehicleId))) {
    const found = await withTenant(tenant.id, (client) => client.query('SELECT 1 FROM vehicles WHERE id = $1', [body.vehicleId]))
    if (found.rows.length > 0) vehicleId = body.vehicleId
  }

  try {
    await createLead(tenant.id, { name, email: email || undefined, phone: phone || undefined, message: message || undefined, type, vehicleId, source: 'website' })
  } catch (err) {
    throw new IntakeError(400, err.message)
  }
  return { ok: true, accepted: true }
}
