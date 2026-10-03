/**
 * Verkaufsabschluss über die Rechnung: Rechnung mit Fahrzeug ⇒ Fahrzeug
 * verkauft; Gutschrift ⇒ Preis gemindert oder Verkauf aufgehoben.
 *
 * Verkaufspreis = Brutto-Rechnungstotal (inkl. MWST). Das passt zum
 * Angebotspreis, der im Schweizer Handel ebenfalls brutto ist, und zur
 * manuellen Erfassung ("Verkauf abschliessen", Vorgabe Angebotspreis). Enthält
 * die Rechnung weitere Positionen (Zubehör, Service), zählen sie zum Preis —
 * wer das Fahrzeug allein bewerten will, korrigiert den Verkaufspreis im
 * Fahrzeug.
 *
 * Die Funktionen arbeiten auf dem Client der laufenden Transaktion: Rechnung
 * und Fahrzeugstatus ändern sich gemeinsam oder gar nicht.
 */

/** Ist ein offener Auftrag auf dem Fahrzeug? Dann kehrt es als «reserviert» zurück, nicht als «auf Lager». */
async function hasOpenOrder(client, vehicleId) {
  const r = await client.query("SELECT 1 FROM documents WHERE type = 'order' AND vehicle_id = $1 AND status IN ('issued', 'delivered') LIMIT 1", [vehicleId])
  return r.rows.length > 0
}

/**
 * Markiert das Fahrzeug einer frisch ausgestellten Rechnung als verkauft.
 * Nichts passiert, wenn es schon verkauft oder abgeschrieben ist (z. B. eine zweite Rechnung zum selben Fahrzeug).
 * @returns {Promise<boolean>} true, wenn der Verkauf hier abgeschlossen wurde
 */
export async function markSoldByInvoice(client, invoice) {
  if (!invoice.vehicle_id) return false
  const vehicle = (await client.query('SELECT status FROM vehicles WHERE id = $1 FOR UPDATE', [invoice.vehicle_id])).rows[0]
  if (!vehicle || (vehicle.status !== 'in_stock' && vehicle.status !== 'reserved')) return false
  await client.query(
    `UPDATE vehicles
        SET status = 'sold', sold_price_rappen = $1, sold_at = $2, buyer_party_id = $3, sold_via_document_id = $4
      WHERE id = $5`,
    [invoice.total_rappen, String(invoice.issue_date).slice(0, 10), invoice.party_id, invoice.id, invoice.vehicle_id],
  )
  return true
}

/**
 * Wirkung einer Gutschrift auf das Fahrzeug, das diese Rechnung verkauft hat.
 *  - vollständig gutgeschrieben: Verkauf aufgehoben (zurück auf Lager bzw. reserviert)
 *  - teilweise: Verkaufspreis um den Gutschriftsbetrag gemindert (Preisnachlass)
 * Ein Fahrzeug, das nicht über diese Rechnung verkauft wurde, bleibt unberührt.
 * @returns {Promise<'released'|'adjusted'|null>}
 */
export async function adjustSaleForCredit(client, invoice, { creditTotalRappen, fullyCredited }) {
  if (!invoice.vehicle_id) return null
  const vehicle = (await client.query('SELECT status, sold_price_rappen, sold_via_document_id FROM vehicles WHERE id = $1 FOR UPDATE', [invoice.vehicle_id])).rows[0]
  if (!vehicle || vehicle.status !== 'sold' || vehicle.sold_via_document_id !== invoice.id) return null

  if (fullyCredited) {
    const next = (await hasOpenOrder(client, invoice.vehicle_id)) ? 'reserved' : 'in_stock'
    await client.query(
      `UPDATE vehicles
          SET status = $1, sold_price_rappen = NULL, sold_at = NULL, buyer_party_id = NULL, sold_via_document_id = NULL
        WHERE id = $2`,
      [next, invoice.vehicle_id],
    )
    return 'released'
  }
  await client.query('UPDATE vehicles SET sold_price_rappen = GREATEST(0, sold_price_rappen - $1) WHERE id = $2', [creditTotalRappen, invoice.vehicle_id])
  return 'adjusted'
}
