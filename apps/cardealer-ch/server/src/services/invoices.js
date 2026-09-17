/**
 * Rechnungen — Belegkette reduziert auf den einen Fall, den Phase 1 nach
 * ANFORDERUNGEN.md §9 braucht ("Fahrzeug rein, Rechnung raus"): eine
 * Rechnung direkt erstellen, mit Positionen, MWST und Nummernkreis.
 * Offerte/Auftrag/Lieferschein/Mahnung/Gutschrift sind in der Tabelle
 * bereits vorgesehen (core-billing-Migration), aber noch nicht verdrahtet.
 */
import { withTenant } from '@tiff/core-db'
import { findTaxRate } from '@tiff/core-billing'
// Direkter Pfad, nicht der Paket-Barrel: qr-invoice.js hängt an `swissqrbill`
// und ist bewusst nicht in @tiff/core-billing/src/index.js re-exportiert,
// damit ein Vite-Bundle der Web-App es nie mitzieht (siehe der Kommentar
// dort). Serverseitiger Code darf und muss den direkten Pfad nehmen.
import { buildQrrReference } from '@tiff/core-billing/src/qr-invoice.js'

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const DOCUMENT_NUMBER_PREFIX = Object.freeze({
  offer: 'OF',
  order: 'AU',
  delivery_note: 'LS',
  invoice: 'RE',
  reminder: 'MA',
  credit_note: 'GS',
})

/**
 * Weist die nächste Nummer aus number_sequences zu — atomar über
 * INSERT ... ON CONFLICT, damit zwei gleichzeitige Rechnungen nie dieselbe
 * Nummer bekommen. `next_value` startet bei 2 (nicht 1), weil die erste
 * zugewiesene Nummer `next_value - 1` ist — so liefert derselbe Ausdruck für
 * die erste UND jede folgende Rechnung dieselbe, richtige Zahl.
 */
export async function nextDocumentNumber(client, tenantId, documentType, year) {
  const result = await client.query(
    `INSERT INTO number_sequences (id, tenant_id, document_type, year, next_value)
     VALUES (gen_random_uuid(), $1, $2, $3, 2)
     ON CONFLICT (tenant_id, document_type, year)
     DO UPDATE SET next_value = number_sequences.next_value + 1
     RETURNING next_value - 1 AS assigned`,
    [tenantId, documentType, year],
  )
  const sequence = result.rows[0].assigned
  const prefix = DOCUMENT_NUMBER_PREFIX[documentType]
  return { number: `${prefix}-${year}-${String(sequence).padStart(5, '0')}`, sequence }
}

/**
 * @param {object} lines [{ description, quantity, unitPriceRappen, taxCode }]
 *   `taxCode` default 'standard'. Preise sind Nettopreise (exkl. MWST) — die
 *   MWST wird pro Position aufgerechnet, nicht wie beim fiktiven
 *   Vorsteuerabzug auf dem Fahrzeug-Gesamtpreis herausgerechnet (das ist ein
 *   anderer Fall, siehe packages/core-billing/src/tax.js).
 */
export async function createInvoice(tenantId, { partyId, vehicleId, lines, issueDate, dueDate }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Eine Rechnung braucht mindestens eine Position.')
  }

  return withTenant(tenantId, async (client) => {
    const tenantResult = await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
    const tenant = tenantResult.rows[0]

    const taxRatesResult = await client.query('SELECT * FROM tax_rates')
    const taxRates = taxRatesResult.rows

    const effectiveIssueDate = issueDate ?? new Date().toISOString().slice(0, 10)
    // "zahlbar innert 30 Tagen" ist die in der Offerte an den Piloten
    // genannte Zahlungsfrist (business/offerte/offerte-bit-automobile.html)
    // und der branchenübliche CH-Standard — als Default, nicht als Zwang:
    // wer eine andere Frist braucht, gibt dueDate explizit mit.
    const effectiveDueDate = dueDate ?? addDays(effectiveIssueDate, 30)
    const year = Number(effectiveIssueDate.slice(0, 4))
    const { number } = await nextDocumentNumber(client, tenantId, 'invoice', year)

    let subtotalRappen = 0
    let vatRappen = 0
    const computedLines = lines.map((line, index) => {
      const rate = findTaxRate(taxRates, line.taxCode ?? 'standard', effectiveIssueDate)
      if (!rate) {
        throw new Error(`Kein gültiger MWST-Satz für '${line.taxCode ?? 'standard'}' am ${effectiveIssueDate}.`)
      }
      const lineTotal = Math.round(Number(line.quantity ?? 1) * Number(line.unitPriceRappen))
      const lineVat = Math.round((lineTotal * Number(rate.rate_percent)) / 100)
      subtotalRappen += lineTotal
      vatRappen += lineVat
      return { ...line, position: index + 1, lineTotal, taxRateId: rate.id }
    })
    const totalRappen = subtotalRappen + vatRappen

    let qrReferenceType = 'NON'
    let qrReference = null
    if (tenant.qr_iban) {
      // Verweis auf die eigene Rechnungsnummer, in Ziffern — provisorisch,
      // solange keine QR-IBAN mit Bank-Zuweisung besteht. Siehe
      // ANFORDERUNGEN.md §10: "Bank: QR-IBAN bestellen" ist ein offener
      // Punkt für den Piloten; sobald die Bank eine Referenzlogik vorgibt,
      // ersetzt diese Zeile die selbstgebaute.
      qrReferenceType = 'QRR'
      qrReference = buildQrrReference(`${year}${String(number).replace(/\D/g, '')}`)
    }

    const docResult = await client.query(
      `INSERT INTO documents
         (id, tenant_id, party_id, type, number, status, issue_date, due_date, vehicle_id,
          subtotal_rappen, vat_rappen, total_rappen, qr_reference_type, qr_reference)
       VALUES (gen_random_uuid(), $1, $2, 'invoice', $3, 'issued', $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        partyId ?? null,
        number,
        effectiveIssueDate,
        effectiveDueDate,
        vehicleId ?? null,
        subtotalRappen,
        vatRappen,
        totalRappen,
        qrReferenceType,
        qrReference,
      ],
    )
    const document = docResult.rows[0]

    for (const line of computedLines) {
      await client.query(
        `INSERT INTO document_lines
           (id, document_id, position, description, quantity, unit_price_rappen, tax_rate_id, line_total_rappen)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [document.id, line.position, line.description, line.quantity ?? 1, line.unitPriceRappen, line.taxRateId, line.lineTotal],
      )
    }

    return { ...document, lines: computedLines }
  })
}

export async function getInvoice(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const docResult = await client.query("SELECT * FROM documents WHERE id = $1 AND type = 'invoice'", [id])
    const document = docResult.rows[0]
    if (!document) return null
    const linesResult = await client.query(
      'SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position',
      [id],
    )
    let party = null
    if (document.party_id) {
      const partyResult = await client.query('SELECT * FROM parties WHERE id = $1', [document.party_id])
      party = partyResult.rows[0] ?? null
    }
    const tenantResult = await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
    return { ...document, lines: linesResult.rows, party, tenant: tenantResult.rows[0] }
  })
}
