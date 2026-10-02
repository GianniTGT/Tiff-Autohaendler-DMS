/**
 * Betriebsdaten — Firma, Adresse, UID, MWST-Methode, QR-IBAN. Ohne diese
 * Angaben gibt es keinen QR-Zahlteil und keine MWST-Auswertung (siehe
 * invoice-pdf.js und vat-report.js).
 */
import { withTenant } from '@tiff/core-db'

export const FIELD_MAP = Object.freeze({
  name: 'name',
  legalName: 'legal_name',
  uid: 'uid',
  vatLiable: 'vat_liable',
  vatMethod: 'vat_method',
  netTaxRatePercent: 'net_tax_rate_percent',
  addressStreet: 'address_street',
  addressZip: 'address_zip',
  addressCity: 'address_city',
  qrIban: 'qr_iban',
  autoscout24ClientId: 'autoscout24_client_id',
  autoscout24SellerId: 'autoscout24_seller_id',
  // Geheimnis: nur schreibbar, wird nie zurückgegeben (siehe camelize).
  autoscout24ClientSecret: 'autoscout24_client_secret',
})

const WRITE_ONLY = new Set(['autoscout24ClientSecret'])

const VAT_METHODS = ['effective', 'net_tax_rate']

function camelize(row) {
  const out = {}
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (!WRITE_ONLY.has(key)) out[key] = row[column] ?? null
  }
  out.autoscout24HasSecret = Boolean(row.autoscout24_client_secret)
  out.hasLogo = Boolean(row.logo_storage_key)
  return out
}

export function normalizeIban(value) {
  return String(value).replace(/\s+/g, '').toUpperCase()
}

/** QR-IBAN: Schweizer IBAN (CH + 2 Prüfziffern + 17 Stellen), Instituts-ID 30000–31999. */
export function isValidQrIban(value) {
  const iban = normalizeIban(value)
  if (!/^CH\d{19}$/.test(iban)) return false
  const iid = Number(iban.slice(4, 9))
  if (iid < 30000 || iid > 31999) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let remainder = 0
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1
}

function validate(fields) {
  if ('legalName' in fields && !String(fields.legalName ?? '').trim()) throw new Error('Die Firma darf nicht leer sein.')
  if ('name' in fields && !String(fields.name ?? '').trim()) throw new Error('Der Name darf nicht leer sein.')
  if (fields.vatMethod != null && fields.vatMethod !== '' && !VAT_METHODS.includes(fields.vatMethod)) {
    throw new Error('Unbekannte MWST-Methode.')
  }
  if (fields.netTaxRatePercent != null && fields.netTaxRatePercent !== '') {
    const n = Number(fields.netTaxRatePercent)
    if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error('Der Saldosteuersatz muss zwischen 0 und 10 % liegen.')
  }
  if (fields.qrIban != null && fields.qrIban !== '' && !isValidQrIban(fields.qrIban)) {
    throw new Error('Das ist keine gültige QR-IBAN (CH…, Instituts-ID 30000–31999, Prüfziffer stimmt nicht).')
  }
  if (fields.uid != null && fields.uid !== '' && !/^CHE-\d{3}\.\d{3}\.\d{3}( MWST)?$/.test(fields.uid)) {
    throw new Error('Die UID muss das Format CHE-123.456.789 haben.')
  }
}

export async function getTenantSettings(tenantId) {
  return withTenant(tenantId, async (client) => {
    const row = (await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])).rows[0]
    return row ? camelize(row) : null
  })
}

export async function updateTenantSettings(tenantId, fields) {
  validate(fields)
  const columns = []
  const values = []
  for (const [key, value] of Object.entries(fields)) {
    const column = FIELD_MAP[key]
    if (!column || value === undefined) continue
    if (WRITE_ONLY.has(key) && value === '') continue // leer lassen heisst: Geheimnis behalten
    columns.push(column)
    values.push(key === 'qrIban' && value ? normalizeIban(value) : value === '' ? null : value)
  }
  if (columns.length === 0) return getTenantSettings(tenantId)
  return withTenant(tenantId, async (client) => {
    const set = columns.map((c, i) => `${c} = $${i + 1}`).join(', ')
    const result = await client.query(`UPDATE tenants SET ${set} WHERE id = $${values.length + 1} RETURNING *`, [
      ...values,
      tenantId,
    ])
    return camelize(result.rows[0])
  })
}
