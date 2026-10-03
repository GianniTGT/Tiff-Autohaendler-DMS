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
import { computeEconomics, findTaxRate, notionalInputTax } from '@tiff/core-billing'
import { listCosts, groupCosts } from './vehicle-costs.js'

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
  purchaseVatRappen: 'purchase_vat_rappen',
  notionalInputTaxRappen: 'notional_input_tax_rappen',
  status: 'status',
  purchasedAt: 'purchased_at',
  soldAt: 'sold_at',
  sellerPartyId: 'seller_party_id',
  buyerPartyId: 'buyer_party_id',
  autoscout24ListingId: 'autoscout24_listing_id',
  autoscout24SyncedAt: 'autoscout24_synced_at',
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
  out.soldViaDocumentId = row.sold_via_document_id ?? null
  out.soldViaInvoiceNumber = row.sold_via_number ?? null
  // Zustand des AutoScout24-Inserats: nur lesbar, nie über PATCH setzbar (nicht in FIELD_MAP).
  out.autoscout24Active = row.autoscout24_active ?? null
  out.autoscout24LastError = row.autoscout24_last_error ?? null
  return out
}

export async function listVehicles(tenantId, { status } = {}) {
  return withTenant(tenantId, async (client) => {
    const where = status ? 'WHERE status = $1' : ''
    const params = status ? [status] : []
    const result = await client.query(
      `SELECT v.*, (SELECT p.id FROM vehicle_photos p WHERE p.vehicle_id = v.id AND p.is_cover LIMIT 1) AS cover_photo_id
         FROM vehicles v ${where.replace('status', 'v.status')} ORDER BY v.created_at DESC`,
      params,
    )
    return result.rows.map((row) => ({ ...camelizeRow(row), coverPhotoId: row.cover_photo_id }))
  })
}

export async function getVehicle(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      'SELECT v.*, d.number AS sold_via_number FROM vehicles v LEFT JOIN documents d ON d.id = v.sold_via_document_id WHERE v.id = $1',
      [id],
    )
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}

/**
 * Fiktiver Vorsteuerabzug (MWSTG Art. 28a) — berechnet, nicht eingetippt.
 * Nur beim Privatkauf gültig, und der Satz gilt am Kaufdatum, nicht heute
 * (ANFORDERUNGEN.md §6, packages/core-billing/src/tax.js). Wer die Werte
 * beim Aufruf mitgibt, überschreibt trotzdem nichts von Hand — die Zahl ist
 * die Beweislage gegenüber der ESTV und muss aus der Formel kommen, nicht
 * aus einem Formularfeld, das jemand versehentlich ändert.
 */
async function computeNotionalInputTaxRappen(client, { vatScheme, purchaseFrom, purchasePriceRappen, purchasedAt }) {
  if (vatScheme !== 'notional_input_tax' || purchaseFrom !== 'private' || purchasePriceRappen == null) {
    return 0
  }
  const dateForRate = purchasedAt ?? new Date().toISOString().slice(0, 10)
  const taxRatesResult = await client.query('SELECT * FROM tax_rates')
  const rate = findTaxRate(taxRatesResult.rows, 'standard', dateForRate)
  return rate ? notionalInputTax(purchasePriceRappen, rate.rate_percent) : 0
}

const MONEY_FIELDS = ['purchasePriceRappen', 'askingPriceRappen', 'soldPriceRappen', 'purchaseVatRappen']

/** Geldfelder sind ganze Rappen oder leer — alles andere wäre ein stiller Datenfehler (z. B. NaN -> null). */
function badInput(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function assertMoneyFields(fields) {
  for (const key of MONEY_FIELDS) {
    const v = fields[key]
    if (v === undefined || v === null) continue
    if (!Number.isInteger(Number(v)) || Number(v) < 0 || v === '') {
      throw badInput(`${key}: Beträge müssen ganze Rappen (≥ 0) sein.`)
    }
  }
}

export async function createVehicle(tenantId, fields) {
  assertMoneyFields(fields)
  return withTenant(tenantId, async (client) => {
    const notionalInputTaxRappen = await computeNotionalInputTaxRappen(client, { ...fields, vatScheme: fields.vatScheme ?? 'notional_input_tax' })
    const { columns, placeholders, values } = toRow({ ...fields, notionalInputTaxRappen })
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
  assertMoneyFields(fields)
  return withTenant(tenantId, async (client) => {
    const existingResult = await client.query(
      'SELECT vat_scheme, purchase_from, purchase_price_rappen, purchased_at FROM vehicles WHERE id = $1',
      [id],
    )
    const existing = existingResult.rows[0]
    if (!existing) return null

    // Ein ausdrücklich gesendetes null (Feld geleert) gilt — es darf nicht auf den alten Wert zurückfallen,
    // sonst bliebe die fiktive Vorsteuer (Beweislage gegenüber der ESTV) für einen gelöschten Preis stehen.
    const merged = (key, column) => (fields[key] !== undefined ? fields[key] : existing[column])
    const notionalInputTaxRappen = await computeNotionalInputTaxRappen(client, {
      vatScheme: merged('vatScheme', 'vat_scheme'),
      purchaseFrom: merged('purchaseFrom', 'purchase_from'),
      purchasePriceRappen: merged('purchasePriceRappen', 'purchase_price_rappen'),
      purchasedAt: merged('purchasedAt', 'purchased_at'),
    })

    const { columns, values } = toRow({ ...fields, notionalInputTaxRappen })
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const result = await client.query(
      `UPDATE vehicles SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    )
    return result.rows[0] ? camelizeRow(result.rows[0]) : null
  })
}

/** Wirtschaftlichkeit eines einzelnen Fahrzeugs — Einkauf + erfasste Kosten → Gewinn. */
export async function getVehicleEconomics(tenantId, id) {
  const vehicle = await getVehicle(tenantId, id)
  if (!vehicle) return null
  const costs = groupCosts(await listCosts(tenantId, id))
  return computeEconomics({
    purchaseRappen: vehicle.purchasePriceRappen,
    askingPriceRappen: vehicle.askingPriceRappen,
    soldPriceRappen: vehicle.soldPriceRappen,
    writtenOff: vehicle.status === 'written_off',
    ...costs,
  })
}

/**
 * Verkauf abschliessen: Preis, Datum und Käufer festhalten, Status 'sold'.
 * Ein verkauftes Fahrzeug kann nicht ein zweites Mal verkauft werden — wer
 * den Preis korrigieren muss, tut das über PATCH.
 */
export async function sellVehicle(tenantId, id, { soldPriceRappen, soldAt, buyerPartyId }) {
  if (!Number.isInteger(soldPriceRappen) || soldPriceRappen <= 0) {
    throw new Error('Der Verkaufspreis muss grösser als 0 sein.')
  }
  return withTenant(tenantId, async (client) => {
    const existing = await client.query('SELECT status FROM vehicles WHERE id = $1', [id])
    if (!existing.rows[0]) return null
    if (existing.rows[0].status === 'sold') throw new Error('Dieses Fahrzeug ist bereits verkauft.')
    if (existing.rows[0].status === 'written_off') throw new Error('Ein abgeschriebenes Fahrzeug kann nicht verkauft werden.')
    const result = await client.query(
      `UPDATE vehicles
          SET status = 'sold', sold_price_rappen = $1, sold_at = COALESCE($2::date, CURRENT_DATE), buyer_party_id = $3
        WHERE id = $4 RETURNING *`,
      [soldPriceRappen, soldAt ?? null, buyerPartyId ?? null, id],
    )
    return camelizeRow(result.rows[0])
  })
}
