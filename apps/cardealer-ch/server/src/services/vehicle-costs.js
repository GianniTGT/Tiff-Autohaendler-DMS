/**
 * Kosten pro Fahrzeug — Quelle für "investiert" und Gewinn/Marge
 * (packages/core-billing/src/economics.js: Teile, Arbeit, Sonstiges).
 */
import { withTenant } from '@tiff/core-db'

export const COST_KINDS = Object.freeze(['part', 'labor', 'transport', 'fee', 'detail'])

function toCost(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    kind: row.kind,
    description: row.description,
    amountRappen: Number(row.amount_rappen),
    incurredAt: row.incurred_at,
  }
}

export async function listCosts(tenantId, vehicleId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      'SELECT * FROM vehicle_costs WHERE vehicle_id = $1 ORDER BY incurred_at DESC, created_at DESC',
      [vehicleId],
    )
    return result.rows.map(toCost)
  })
}

export async function addCost(tenantId, vehicleId, { kind, description, amountRappen, incurredAt }) {
  if (!COST_KINDS.includes(kind)) throw new Error('Unbekannte Kostenart.')
  if (!description || !String(description).trim()) throw new Error('Eine Kostenposition braucht eine Beschreibung.')
  if (!Number.isInteger(amountRappen) || amountRappen < 0) throw new Error('Der Betrag muss eine ganze Zahl in Rappen sein.')

  return withTenant(tenantId, async (client) => {
    const vehicle = await client.query('SELECT 1 FROM vehicles WHERE id = $1', [vehicleId])
    if (vehicle.rows.length === 0) return null
    const result = await client.query(
      `INSERT INTO vehicle_costs (id, tenant_id, vehicle_id, kind, description, amount_rappen, incurred_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE))
       RETURNING *`,
      [tenantId, vehicleId, kind, String(description).trim(), amountRappen, incurredAt ?? null],
    )
    return toCost(result.rows[0])
  })
}

export async function deleteCost(tenantId, vehicleId, costId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('DELETE FROM vehicle_costs WHERE id = $1 AND vehicle_id = $2', [costId, vehicleId])
    return result.rowCount > 0
  })
}

/** Summen je Kostengruppe in der Form, die computeEconomics() erwartet. */
export function groupCosts(costs) {
  const sum = (kinds) => costs.filter((c) => kinds.includes(c.kind)).reduce((s, c) => s + c.amountRappen, 0)
  return {
    partsRappen: sum(['part']),
    laborRappen: sum(['labor']),
    otherRappen: sum(['transport', 'fee', 'detail']),
  }
}
