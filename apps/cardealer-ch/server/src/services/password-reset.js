/**
 * Passwort vergessen → Link per E-Mail → neues Passwort. Die Person braucht dafür niemanden im
 * Betrieb; der Inhaber kann unter Benutzer weiterhin von Hand ein Passwort setzen.
 *
 * Sicherheit, kurz:
 *  - Die Antwort auf «Passwort vergessen?» ist immer dieselbe, ob es das Konto gibt oder nicht —
 *    niemand kann so E-Mail-Adressen eines Betriebs erraten.
 *  - In der Datenbank liegt nur der SHA-256 des Tokens (Migration 22); der Token selbst steht nur im
 *    Link. Eine Stunde gültig, einmal verwendbar, pro Person nur der jüngste Antrag.
 *  - Der Link trägt die Mandanten-ID voran (`<tenantId>.<token>`), damit die Prüfung — wie alles —
 *    innerhalb des Mandanten läuft (Row Level Security) und nicht quer über alle.
 *  - Ein neues Passwort beendet alle Sitzungen der Person, wie beim Setzen durch den Inhaber.
 *  - Höchstens 5 Anträge pro Adresse und Viertelstunde (im Speicher) — gegen Mail-Flut.
 */
import { createHash, randomBytes } from 'node:crypto'
import { withTenant } from '@tiff/core-db'
import { hashPassword } from '@tiff/core-auth'
import { findTenantIdBySlug } from './auth.js'
import { sendMail } from './mail.js'

export const RESET_LIFETIME_MS = 60 * 60 * 1000
const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT = 5

export class PasswordResetError extends Error {}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const recent = new Map() // email -> [timestamps]
function rateLimited(email, now = Date.now()) {
  const key = String(email).toLowerCase()
  const stamps = (recent.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS)
  if (stamps.length >= RATE_LIMIT) return true
  stamps.push(now)
  recent.set(key, stamps)
  return false
}

export function resetMailText({ name, link, tenantName }) {
  return [
    `Guten Tag ${name}`,
    '',
    `Für Ihr Konto im Tiff Autohändler Manager (${tenantName}) wurde ein neues Passwort angefordert.`,
    'Öffnen Sie diesen Link und wählen Sie ein neues Passwort (mindestens 10 Zeichen):',
    '',
    link,
    '',
    'Der Link gilt eine Stunde und nur einmal. Haben Sie nichts angefordert, ignorieren Sie diese E-Mail —',
    'Ihr Passwort bleibt, wie es ist.',
    '',
    'Tiff Software Solutions · info@tiff-software-solutions.com',
  ].join('\n')
}

/**
 * Antrag — antwortet immer gleich. `baseUrl` ist die Adresse der App (ohne Pfad), aus APP_BASE_URL oder dem
 * Host der Anfrage.
 * @returns {Promise<{requested: true}>}
 */
export async function requestPasswordReset({ tenantSlug, email, baseUrl }, { send = sendMail, now = Date.now } = {}) {
  if (!tenantSlug || !email) return { requested: true }
  if (rateLimited(email, now())) return { requested: true }
  const tenantId = await findTenantIdBySlug(String(tenantSlug).trim())
  if (!tenantId) return { requested: true }

  await withTenant(tenantId, async (client) => {
    const user = (await client.query('SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND active', [String(email).trim()])).rows[0]
    if (!user) return
    const tenant = (await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]
    const token = randomBytes(32).toString('base64url')
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [user.id])
    await client.query(
      'INSERT INTO password_resets (id, tenant_id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
      [tenantId, user.id, sha256(token), new Date(now() + RESET_LIFETIME_MS)],
    )
    const link = `${String(baseUrl).replace(/\/+$/, '')}/?reset=${tenantId}.${token}`
    await send({
      to: user.email,
      subject: 'Neues Passwort für den Tiff Autohändler Manager',
      text: resetMailText({ name: user.name, link, tenantName: tenant?.name ?? tenantSlug }),
    })
  })
  return { requested: true }
}

/**
 * Neues Passwort setzen. @throws {PasswordResetError} bei ungültigem oder abgelaufenem Link,
 * @throws {Error} bei zu kurzem Passwort (Meldung aus core-auth).
 */
export async function resetPassword({ token: combined, password }) {
  const [tenantId, token] = String(combined ?? '').split('.')
  if (!tenantId || !token) throw new PasswordResetError('Der Link ist ungültig.')
  const passwordHash = await hashPassword(String(password ?? ''))

  const done = await withTenant(tenantId, async (client) => {
    const row = (
      await client.query('SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE', [sha256(token)])
    ).rows[0]
    if (!row) return false
    const updated = await client.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND active RETURNING id', [passwordHash, row.user_id])
    if (updated.rows.length === 0) return false
    await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id])
    await client.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id])
    return true
  }).catch(() => false) // ungültige Mandanten-ID im Link: dasselbe wie ein ungültiger Token

  if (!done) throw new PasswordResetError('Der Link ist ungültig, abgelaufen oder wurde schon verwendet. Bitte neu anfordern.')
  return { ok: true }
}
