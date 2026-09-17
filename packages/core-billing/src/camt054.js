/**
 * camt.054 — die Bank liefert Zahlungseingänge als ISO-20022-XML mit der
 * QR-Referenz. Reines Parsen hier (keine DB, kein Tenant) — der Abgleich mit
 * offenen Rechnungen läuft in apps/cardealer-ch/server/src/services/
 * camt054-import.js, das diese Funktion mit withTenant() kombiniert.
 *
 * ANFORDERUNGEN.md §9 (Phase 2): "Einlesen → Rechnung gefunden → bezahlt →
 * Mahnlauf weiss Bescheid." Nur Gutschriften (CRDT) mit einer strukturierten
 * Referenz (CdtrRefInf) sind für den Abgleich brauchbar — eine Belastung
 * (DBIT) oder ein Eingang ohne QR-Referenz kann nicht automatisch zugeordnet
 * werden und wird als "unreferenziert" zurückgegeben, nie stillschweigend
 * verworfen.
 */
import { XMLParser } from 'fast-xml-parser'

// parseTagValue: false ist Pflicht, nicht Geschmack — eine 27-stellige
// QRR-Referenz ist reine Ziffernfolge und würde sonst als JS-Zahl gelesen
// und dabei stillschweigend gerundet (weit jenseits von
// Number.MAX_SAFE_INTEGER). Beträge werden unten selbst mit Number()
// umgewandelt, wo Rundung gewollt und unschädlich ist.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false })

/** Camt.054 verschachtelt Ntry beliebig oft — ein Objekt oder ein Array, je nach Anzahl. */
function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function extractReference(entryDetail) {
  // CdtrRefInf (strukturiert, QRR/SCOR) hat Vorrang vor einer unstrukturierten Mitteilung.
  const strd = entryDetail?.RmtInf?.Strd
  const structured = asArray(strd)
    .map((s) => s?.CdtrRefInf?.Ref)
    .find(Boolean)
  if (structured) return { reference: String(structured), structured: true }

  const unstructured = entryDetail?.RmtInf?.Ustrd
  if (unstructured) return { reference: String(unstructured), structured: false }

  return { reference: null, structured: false }
}

/**
 * @param {string} xml
 * @returns {{amountRappen:number, currency:string, valueDate:string,
 *            creditDebitIndicator:'CRDT'|'DBIT', reference:string|null,
 *            referenceIsStructured:boolean}[]}
 */
export function parseCamt054(xml) {
  const doc = parser.parse(xml)
  const notification = doc?.Document?.BkToCstmrDbtCdtNtfctn
  if (!notification) {
    throw new Error('Keine camt.054-Struktur gefunden (Document > BkToCstmrDbtCdtNtfctn fehlt).')
  }

  const notifications = asArray(notification.Ntfctn)
  const entries = notifications.flatMap((n) => asArray(n.Ntry))

  return entries.map((entry) => {
    const amount = entry.Amt
    const amountValue = typeof amount === 'object' ? amount['#text'] : amount
    const currency = typeof amount === 'object' ? amount['@_Ccy'] : undefined
    const valueDate = entry.ValDt?.Dt ?? entry.BookgDt?.Dt ?? null

    const txDetails = asArray(entry.NtryDtls).flatMap((d) => asArray(d.TxDtls))
    const firstDetail = txDetails[0] ?? {}
    const { reference, structured } = extractReference(firstDetail)

    return {
      amountRappen: Math.round(Number(amountValue) * 100),
      currency,
      valueDate,
      creditDebitIndicator: entry.CdtDbtInd,
      reference,
      referenceIsStructured: structured,
    }
  })
}
