/**
 * Login und Sitzungen.
 *
 * Das Henne-Ei-Problem und seine Lösung stehen in
 * packages/core-db/migrations/1700000000005_tenant-login-lookup.js: ein
 * Login kennt den Mandanten noch nicht, `withTenant()` verlangt ihn aber.
 * Der Ablauf hier hat deshalb zwei Phasen:
 *
 *  1. Mandanten-Slug -> Mandanten-ID, über die RLS-freie Sicht
 *     `tenant_login_lookup` (kein Passwort, keine Nutzdaten — nur die ID).
 *  2. Alles Weitere (Benutzer suchen, Passwort prüfen, Sitzung anlegen) läuft
 *     normal durch `withTenant(tenantId, ...)`.
 *
 * Der Sitzungs-Cookie kodiert `${tenantId}.${sessionId}` — die Mandanten-ID
 * darin ist kein Geheimnis (sie steht schon im Slug), sie ist nur der
 * Wegweiser, MIT welchem `app.tenant_id` die Sitzungstabelle abgefragt
 * werden muss. Das eigentliche Geheimnis ist die zufällige `sessionId`
 * (UUID v4, aus der DB) — wird sie gefälscht oder gehört sie zum falschen
 * Mandanten, liefert die RLS-geschützte Abfrage unten schlicht keine Zeile,
 * nie eine fremde. Siehe auch ANFORDERUNGEN.md §4 (Server-Session statt JWT
 * — eine deaktivierte Person muss sofort draussen sein, die Rolle wird bei
 * jeder Anfrage neu aus der DB gelesen, nie aus dem Cookie selbst).
 */
import { withTenant, withoutTenant } from '@tiff/core-db'
import { hashPassword, verifyPassword } from '@tiff/core-auth'

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000 // 12 Stunden

export class LoginError extends Error {}

export function encodeSessionCookie(tenantId, sessionId) {
  return `${tenantId}.${sessionId}`
}

export function decodeSessionCookie(value) {
  if (typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot < 0) return null
  const tenantId = value.slice(0, dot)
  const sessionId = value.slice(dot + 1)
  if (!tenantId || !sessionId) return null
  return { tenantId, sessionId }
}

/** @returns {Promise<string|null>} die Mandanten-ID, oder null wenn der Slug nicht existiert. */
export async function findTenantIdBySlug(slug) {
  const result = await withoutTenant((client) =>
    client.query('SELECT id FROM tenant_login_lookup WHERE slug = $1', [slug]),
  )
  return result.rows[0]?.id ?? null
}

/**
 * @throws {LoginError} bei falschem Slug, falscher E-Mail oder falschem Passwort —
 *   bewusst dieselbe Meldung für alle drei, damit ein Angreifer nicht
 *   unterscheiden kann, welcher Teil falsch war.
 */
export async function login({ tenantSlug, email, password }) {
  const tenantId = await findTenantIdBySlug(tenantSlug)
  if (!tenantId) throw new LoginError('Anmeldename oder Passwort ist falsch.')

  return withTenant(tenantId, async (client) => {
    const userResult = await client.query(
      'SELECT id, password_hash, role, active FROM users WHERE email = $1',
      [email],
    )
    const user = userResult.rows[0]
    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      throw new LoginError('Anmeldename oder Passwort ist falsch.')
    }

    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
    const sessionResult = await client.query(
      'INSERT INTO sessions (id, tenant_id, user_id, expires_at) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
      [tenantId, user.id, expiresAt],
    )

    return {
      tenantId,
      userId: user.id,
      role: user.role,
      sessionId: sessionResult.rows[0].id,
      expiresAt,
    }
  })
}

/**
 * @returns {Promise<{tenantId:string, userId:string, role:string}|null>}
 *   null bei fehlendem, abgelaufenem oder gefälschtem Cookie — nie ein Fehler,
 *   damit eine ungültige Sitzung immer denselben Weg nimmt wie keine Sitzung.
 */
export async function validateSessionCookie(cookieValue) {
  const decoded = decodeSessionCookie(cookieValue)
  if (!decoded) return null

  return withTenant(decoded.tenantId, async (client) => {
    const result = await client.query(
      `SELECT s.user_id, u.role, u.active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [decoded.sessionId],
    )
    const row = result.rows[0]
    if (!row || !row.active) return null
    return { tenantId: decoded.tenantId, userId: row.user_id, role: row.role }
  }).catch(() => null) // eine ungültige tenantId (z.B. keine gültige UUID) ist ebenfalls "keine Sitzung"
}

export async function logout(cookieValue) {
  const decoded = decodeSessionCookie(cookieValue)
  if (!decoded) return
  await withTenant(decoded.tenantId, (client) =>
    client.query('DELETE FROM sessions WHERE id = $1', [decoded.sessionId]),
  ).catch(() => {})
}

export async function createUser({ tenantId, email, name, password, role }) {
  const passwordHash = await hashPassword(password)
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      'INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id',
      [tenantId, email, name, passwordHash, role],
    )
    return result.rows[0].id
  })
}
