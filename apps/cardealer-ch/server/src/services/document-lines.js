/**
 * Positionen und Summen für alle Belege der Kette (Offerte, Auftrag,
 * Lieferschein, Rechnung): eine Stelle, damit die MWST überall gleich
 * gerechnet wird. Preise sind Nettopreise (exkl. MWST); die MWST wird pro
 * Position aufgerechnet, mit dem am Belegdatum gültigen Satz (tax_rates).
 */
import { findTaxRate } from '@tiff/core-billing'

const badInput = (message) => Object.assign(new Error(message), { statusCode: 400 })

/**
 * @param {object} client  Postgres-Client innerhalb withTenant()
 * @param {object[]} lines [{ description, quantity, unitPriceRappen, taxCode }]
 * @returns {Promise<{computedLines: object[], subtotalRappen: number, vatRappen: number, totalRappen: number}>}
 */
export async function priceLines(client, lines, effectiveDate) {
  if (!Array.isArray(lines) || lines.length === 0) throw badInput('Ein Beleg braucht mindestens eine Position.')
  const taxRates = (await client.query('SELECT * FROM tax_rates')).rows

  let subtotalRappen = 0
  let vatRappen = 0
  const computedLines = lines.map((line, index) => {
    const position = index + 1
    if (!line?.description || !String(line.description).trim()) throw badInput(`Position ${position}: Beschreibung fehlt.`)
    const quantity = line.quantity == null || line.quantity === '' ? 1 : Number(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) throw badInput(`Position ${position}: Die Menge muss grösser als 0 sein.`)
    if (!Number.isInteger(line.unitPriceRappen) || line.unitPriceRappen < 0) {
      throw badInput(`Position ${position}: Der Preis muss eine ganze Zahl in Rappen (≥ 0) sein.`)
    }
    const rate = findTaxRate(taxRates, line.taxCode ?? 'standard', effectiveDate)
    if (!rate) throw new Error(`Kein gültiger MWST-Satz für '${line.taxCode ?? 'standard'}' am ${effectiveDate}.`)

    const lineTotal = Math.round(quantity * line.unitPriceRappen)
    const lineVat = Math.round((lineTotal * Number(rate.rate_percent)) / 100)
    subtotalRappen += lineTotal
    vatRappen += lineVat
    return { ...line, description: String(line.description).trim(), quantity, position, lineTotal, taxRateId: rate.id }
  })
  return { computedLines, subtotalRappen, vatRappen, totalRappen: subtotalRappen + vatRappen }
}

export async function insertLines(client, documentId, computedLines) {
  for (const line of computedLines) {
    await client.query(
      `INSERT INTO document_lines (id, document_id, position, description, quantity, unit_price_rappen, tax_rate_id, line_total_rappen)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
      [documentId, line.position, line.description, line.quantity, line.unitPriceRappen, line.taxRateId, line.lineTotal],
    )
  }
}
