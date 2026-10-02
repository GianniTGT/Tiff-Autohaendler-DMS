/**
 * Anfragen (Leads). Eine Anfrage kann zu einem Kunden gemacht werden
 * (convertLeadToParty) — danach zeigt sie auf diesen Kunden, damit sie bei
 * einer späteren Rechnung oder einem Vertrag wiederzufinden ist.
 */
import { withTenant } from '@tiff/core-db'

export const LEAD_TYPES = Object.freeze(['inquiry', 'test_drive', 'trade_in', 'financing', 'other'])
export const LEAD_STATUSES = Object.freeze(['new', 'contacted', 'test_drive', 'won', 'lost'])
export const LEAD_SOURCES = Object.freeze(['manual', 'website', 'autoscout24'])

function toLead(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    vehicleId: row.vehicle_id,
    partyId: row.party_id,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vehicleLabel: row.vehicle_label ?? null,
  }
}

const SELECT = `SELECT l.*, NULLIF(TRIM(CONCAT_WS(' ', v.make, v.model)), '') AS vehicle_label
                  FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id`

function validate(fields, { partial }) {
  if (!partial || fields.name !== undefined) {
    if (!fields.name || !String(fields.name).trim()) throw new Error('Eine Anfrage braucht einen Namen.')
  }
  if (fields.type !== undefined && !LEAD_TYPES.includes(fields.type)) throw new Error('Unbekannte Anfrageart.')
  if (fields.status !== undefined && !LEAD_STATUSES.includes(fields.status)) throw new Error('Unbekannter Status.')
  if (fields.source !== undefined && !LEAD_SOURCES.includes(fields.source)) throw new Error('Unbekannte Quelle.')
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw new Error('Die E-Mail-Adresse ist ungültig.')
  if (!partial && !fields.email && !fields.phone) throw new Error('Bitte E-Mail oder Telefon angeben — sonst ist die Anfrage nicht erreichbar.')
}

export async function listLeads(tenantId, { status } = {}) {
  return withTenant(tenantId, async (client) => {
    const result = status
      ? await client.query(`${SELECT} WHERE l.status = $1 ORDER BY l.created_at DESC`, [status])
      : await client.query(`${SELECT} ORDER BY l.created_at DESC`)
    return result.rows.map(toLead)
  })
}

export async function createLead(tenantId, fields) {
  validate(fields, { partial: false })
  return withTenant(tenantId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO leads (id, tenant_id, type, status, name, email, phone, message, vehicle_id, source, notes)
       VALUES (gen_random_uuid(), $1, $2, 'new', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        tenantId,
        fields.type ?? 'inquiry',
        String(fields.name).trim(),
        fields.email || null,
        fields.phone || null,
        fields.message || null,
        fields.vehicleId || null,
        fields.source ?? 'manual',
        fields.notes || null,
      ],
    )
    return toLead((await client.query(`${SELECT} WHERE l.id = $1`, [inserted.rows[0].id])).rows[0])
  })
}

export async function updateLead(tenantId, id, fields) {
  validate(fields, { partial: true })
  return withTenant(tenantId, async (client) => {
    const existing = (await client.query('SELECT * FROM leads WHERE id = $1', [id])).rows[0]
    if (!existing) return null
    const pick = (key, column) => (fields[key] === undefined ? existing[column] : fields[key] || null)
    await client.query(
      `UPDATE leads SET type = $1, status = $2, name = $3, email = $4, phone = $5, message = $6,
              vehicle_id = $7, notes = $8, updated_at = now() WHERE id = $9`,
      [
        fields.type ?? existing.type,
        fields.status ?? existing.status,
        fields.name === undefined ? existing.name : String(fields.name).trim(),
        pick('email', 'email'),
        pick('phone', 'phone'),
        pick('message', 'message'),
        pick('vehicleId', 'vehicle_id'),
        pick('notes', 'notes'),
        id,
      ],
    )
    return toLead((await client.query(`${SELECT} WHERE l.id = $1`, [id])).rows[0])
  })
}

export async function deleteLead(tenantId, id) {
  return withTenant(tenantId, async (client) => (await client.query('DELETE FROM leads WHERE id = $1', [id])).rowCount > 0)
}

/**
 * Legt aus der Anfrage einen Kunden an (Person) und verknüpft beide. Gibt es
 * schon einen Kunden mit derselben E-Mail, wird dieser verknüpft statt ein
 * Duplikat angelegt.
 */
export async function convertLeadToParty(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const lead = (await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id])).rows[0]
    if (!lead) return null
    if (lead.party_id) return { lead: toLead(lead), partyId: lead.party_id, created: false }

    let partyId = null
    if (lead.email) {
      partyId = (await client.query('SELECT id FROM parties WHERE lower(email) = lower($1) LIMIT 1', [lead.email])).rows[0]?.id ?? null
    }
    let created = false
    if (!partyId) {
      const [first, ...rest] = String(lead.name).trim().split(/\s+/)
      partyId = (
        await client.query(
          `INSERT INTO parties (id, tenant_id, kind, first_name, last_name, email, phone)
           VALUES (gen_random_uuid(), $1, 'person', $2, $3, $4, $5) RETURNING id`,
          [tenantId, first, rest.join(' ') || null, lead.email, lead.phone],
        )
      ).rows[0].id
      created = true
    }
    await client.query('UPDATE leads SET party_id = $1, updated_at = now() WHERE id = $2', [partyId, id])
    return { lead: toLead((await client.query(`${SELECT} WHERE l.id = $1`, [id])).rows[0]), partyId, created }
  })
}

export async function countNewLeads(tenantId) {
  return withTenant(tenantId, async (client) => Number((await client.query("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'")).rows[0].n))
}
