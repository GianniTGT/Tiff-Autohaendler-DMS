/**
 * Kunden und Lieferanten — branchenneutral (SCHWEIZ-SAAS.md §3: eine Partei
 * ist eine Firma oder eine Person, kein "Käufer"/"Verkäufer"). Gleiches
 * FIELD_MAP-Muster wie services/vehicles.js — siehe dort für die Begründung.
 */
import { withTenant } from '@tiff/core-db'

export const FIELD_MAP = Object.freeze({
  kind: 'kind',
  companyName: 'company_name',
  firstName: 'first_name',
  lastName: 'last_name',
  uid: 'uid',
  email: 'email',
  phone: 'phone',
  addressStreet: 'address_street',
  addressZip: 'address_zip',
  addressCity: 'address_city',
  idDocumentType: 'id_document_type',
  idDocumentNumber: 'id_document_number',
  notes: 'notes',
})

function toRow(fields) {
  const columns = []
  const placeholders = []
  const values = []
  for (const [key, value] of Object.entries(fields)) {
    const column = FIELD_MAP[key]
    if (!column || value === undefined) continue
    columns.push(column)
    values.push(value)
    placeholders.push(`$${values.length}`)
  }
  return { columns, placeholders, values }
}

function camelizeRow(row) {
  const reverse = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]))
  const out = { id: row.id, tenantId: row.tenant_id, createdAt: row.created_at }
  for (const [column, value] of Object.entries(row)) {
    const key = reverse[column]
    if (key) out[key] = value
  }
  return out
}

export async function listParties(tenantId, { search } = {}) {
  return withTenant(tenantId, async (client) => {
    let where = ''
    const params = []
    if (search) {
      params.push(`%${search}%`)
      where = `WHERE company_name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`
    }
    const result = await client.query(`SELECT * FROM parties ${where} ORDER BY created_at DESC`, params)
    return result.rows.map(camelizeRow)
  })
}

export async function getParty(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT * FROM parties WHERE id = $1', [id])
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}

export async function createParty(tenantId, fields) {
  return withTenant(tenantId, async (client) => {
    const { columns, placeholders, values } = toRow(fields)
    const result = await client.query(
      `INSERT INTO parties (id, tenant_id, ${columns.join(', ')})
       VALUES (gen_random_uuid(), $${values.length + 1}, ${placeholders.join(', ')})
       RETURNING *`,
      [...values, tenantId],
    )
    return camelizeRow(result.rows[0])
  })
}

export async function updateParty(tenantId, id, fields) {
  return withTenant(tenantId, async (client) => {
    const { columns, values } = toRow(fields)
    if (columns.length === 0) {
      const result = await client.query('SELECT * FROM parties WHERE id = $1', [id])
      return result.rows[0] ? camelizeRow(result.rows[0]) : null
    }
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const result = await client.query(
      `UPDATE parties SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    )
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}
