/**
 * Benutzerverwaltung eines Betriebs. Es gibt keinen E-Mail-Versand (die
 * `invitations`-Tabelle ist vorbereitet, aber nichts verschickt sie): der
 * Inhaber legt eine Person mit einem Startpasswort an und gibt es persönlich
 * weiter.
 *
 * Zwei Sicherungen, die kein Formular ersetzen kann:
 *  - Der letzte aktive Inhaber kann weder deaktiviert noch herabgestuft
 *    werden — sonst sperrt sich ein Betrieb selbst aus.
 *  - Wer deaktiviert wird oder ein neues Passwort bekommt, verliert sofort
 *    alle Sitzungen (ANFORDERUNGEN.md §4: "eine deaktivierte Person muss
 *    sofort draussen sein").
 */
import { withTenant } from '@tiff/core-db'
import { hashPassword, ROLES, isAssignableRole } from '@tiff/core-auth'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function toUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, createdAt: row.created_at }
}

async function activeOwnerCount(client, exceptUserId) {
  const result = await client.query(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'inhaber' AND active AND id <> $1",
    [exceptUserId ?? '00000000-0000-0000-0000-000000000000'],
  )
  return Number(result.rows[0].n)
}

export async function listUsers(tenantId) {
  return withTenant(tenantId, async (client) => (await client.query('SELECT * FROM users ORDER BY created_at')).rows.map(toUser))
}

export async function addUser(tenantId, { name, email, password, role }) {
  if (!name || !String(name).trim()) throw new Error('Der Name fehlt.')
  if (!EMAIL.test(String(email ?? ''))) throw new Error('Die E-Mail-Adresse ist ungültig.')
  if (!isAssignableRole(role)) throw new Error(`Unbekannte Rolle (erlaubt: ${ROLES.join(', ')}).`)
  const passwordHash = await hashPassword(password) // wirft bei weniger als 10 Zeichen
  return withTenant(tenantId, async (client) => {
    const taken = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])
    if (taken.rows.length > 0) throw new Error('Diese E-Mail-Adresse wird in diesem Betrieb bereits verwendet.')
    const result = await client.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, String(email).trim(), String(name).trim(), passwordHash, role],
    )
    return toUser(result.rows[0])
  })
}

/**
 * @param {string} actingUserId  wer ändert — man kann sich nicht selbst deaktivieren
 * @param {object} fields { name, role, active, password }
 */
export async function updateUser(tenantId, actingUserId, id, fields) {
  if (fields.role !== undefined && !isAssignableRole(fields.role)) throw new Error('Unbekannte Rolle.')
  if (fields.name !== undefined && !String(fields.name).trim()) throw new Error('Der Name fehlt.')
  const passwordHash = fields.password === undefined ? null : await hashPassword(fields.password)

  return withTenant(tenantId, async (client) => {
    const existing = (await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0]
    if (!existing) return null

    const nextRole = fields.role ?? existing.role
    const nextActive = fields.active === undefined ? existing.active : Boolean(fields.active)

    if (id === actingUserId && !nextActive) throw new Error('Sie können sich nicht selbst deaktivieren.')
    const losesOwnerSeat = existing.role === 'inhaber' && existing.active && (nextRole !== 'inhaber' || !nextActive)
    if (losesOwnerSeat && (await activeOwnerCount(client, id)) === 0) {
      throw new Error('Es muss mindestens ein aktiver Inhaber bleiben.')
    }

    const result = await client.query(
      `UPDATE users SET name = $1, role = $2, active = $3, password_hash = COALESCE($4, password_hash)
        WHERE id = $5 RETURNING *`,
      [fields.name === undefined ? existing.name : String(fields.name).trim(), nextRole, nextActive, passwordHash, id],
    )

    // Sitzungen sofort beenden, wenn jemand gesperrt wird oder ein neues Passwort bekommt.
    if (!nextActive || passwordHash) await client.query('DELETE FROM sessions WHERE user_id = $1', [id])
    return toUser(result.rows[0])
  })
}
