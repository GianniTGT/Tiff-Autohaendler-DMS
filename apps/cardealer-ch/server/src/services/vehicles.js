/**
 * Fahrzeuge — Leitsatz aus ANFORDERUNGEN.md §9: "Fahrzeug rein, Rechnung
 * raus." CH-Felder wie in der Migration
 * packages/core-db/migrations/1700000000003_cardealer-vehicles.js begründet
 * (Stammnummer statt Meilen, kW statt PS, MFK statt US-Title).
 *
 * FIELD_MAP ist die einzige Stelle, die JS-camelCase auf DB-Spalten
 * abbildet — Erfassen und Ändern laufen beide darüber, damit nie zwei
 * Listen auseinanderlaufen können. Nur Felder aus dieser Liste können je in
 * eine SQL-Anweisung geraten; ein beliebiger Objekt-Key von aussen kann
 * keinen Spaltennamen einschleusen.
 */
import { withTenant } from '@tiff/core-db'
import { computeEconomics } from '@tiff/core-billing'

export const FIELD_MAP = Object.freeze({
  vin: 'vin',
  serialNumber: 'serial_number',
  certificationNumber: 'certification_number',
  make: 'make',
  model: 'model',
  trim: 'trim',
  modelYear: 'model_year',
  firstRegistrationDate: 'first_registration_date',
  bodyType: 'body_type',
  vehicleCategory: 'vehicle_category',
  conditionType: 'condition_type',
  fuelType: 'fuel_type',
  transmissionType: 'transmission_type',
  driveType: 'drive_type',
  bodyColor: 'body_color',
  bodyColorText: 'body_color_text',
  interiorColor: 'interior_color',
  interiorColorText: 'interior_color_text',
  doors: 'doors',
  seats: 'seats',
  powerKw: 'power_kw',
  displacementCcm: 'displacement_ccm',
  cylinders: 'cylinders',
  mileageKm: 'mileage_km',
  ownersCount: 'owners_count',
  lastInspectionDate: 'last_inspection_date',
  inspectionValidUntil: 'inspection_valid_until',
  soldWithInspection: 'sold_with_inspection',
  energyLabel: 'energy_label',
  co2Emission: 'co2_emission',
  consumptionCombined: 'consumption_combined',
  warrantyType: 'warranty_type',
  purchasePriceRappen: 'purchase_price_rappen',
  askingPriceRappen: 'asking_price_rappen',
  soldPriceRappen: 'sold_price_rappen',
  vatScheme: 'vat_scheme',
  purchaseFrom: 'purchase_from',
  status: 'status',
  purchasedAt: 'purchased_at',
  soldAt: 'sold_at',
  sellerPartyId: 'seller_party_id',
  buyerPartyId: 'buyer_party_id',
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

export async function listVehicles(tenantId, { status } = {}) {
  return withTenant(tenantId, async (client) => {
    const where = status ? 'WHERE status = $1' : ''
    const params = status ? [status] : []
    const result = await client.query(
      `SELECT * FROM vehicles ${where} ORDER BY created_at DESC`,
      params,
    )
    return result.rows.map(camelizeRow)
  })
}

export async function getVehicle(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT * FROM vehicles WHERE id = $1', [id])
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}

export async function createVehicle(tenantId, fields) {
  return withTenant(tenantId, async (client) => {
    const { columns, placeholders, values } = toRow(fields)
    const result = await client.query(
      `INSERT INTO vehicles (id, tenant_id, ${columns.join(', ')})
       VALUES (gen_random_uuid(), $${values.length + 1}, ${placeholders.join(', ')})
       RETURNING *`,
      [...values, tenantId],
    )
    return camelizeRow(result.rows[0])
  })
}

export async function updateVehicle(tenantId, id, fields) {
  return withTenant(tenantId, async (client) => {
    const { columns, values } = toRow(fields)
    if (columns.length === 0) {
      const result = await client.query('SELECT * FROM vehicles WHERE id = $1', [id])
      return result.rows[0] ? camelizeRow(result.rows[0]) : null
    }
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const result = await client.query(
      `UPDATE vehicles SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    )
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}

/** Wirtschaftlichkeit eines einzelnen Fahrzeugs — Einkauf/Teile/Arbeit/Sonstiges → Gewinn. */
export async function getVehicleEconomics(tenantId, id) {
  const vehicle = await getVehicle(tenantId, id)
  if (!vehicle) return null
  return computeEconomics({
    purchaseRappen: vehicle.purchasePriceRappen,
    askingPriceRappen: vehicle.askingPriceRappen,
    soldPriceRappen: vehicle.soldPriceRappen,
    writtenOff: vehicle.status === 'written_off',
  })
}
