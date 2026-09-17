/**
 * MWST — Sätze und der fiktive Vorsteuerabzug beim Occasionshandel.
 *
 * Wichtigster Unterschied zur naiven Annahme "Margenbesteuerung": die Schweiz
 * hat die Margenbesteuerung für gebrauchte bewegliche Gegenstände per
 * 1.1.2018 abgeschafft und durch den fiktiven Vorsteuerabzug ersetzt
 * (MWSTG Art. 28a). Margenbesteuerung (Art. 24a) gilt nur noch für
 * Sammlerstücke/Oldtimer. Siehe SCHWEIZ-SAAS.md §4.3 und ANFORDERUNGEN.md §6.
 *
 * ACHTUNG: Diese Berechnung ist nach bestem Wissen aus MWSTG Art. 28a
 * nachgebaut, aber NICHT von einem Treuhänder bestätigt. Vor der ersten
 * echten Rechnung gegenprüfen (ANFORDERUNGEN.md §6/§10) — bis dahin gilt
 * dieses Modul als Entwurf, nicht als geprüfte Steuerlogik.
 */

/**
 * Sucht den zum Stichtag gültigen Satz aus der Datenbank-Tabelle tax_rates.
 * `rows` sind bereits geladene Zeilen (id, code, rate_percent, valid_from, valid_to).
 */
export function findTaxRate(rows, code, onDate = new Date()) {
  const iso = onDate instanceof Date ? onDate.toISOString().slice(0, 10) : onDate
  return rows.find((r) => {
    if (r.code !== code) return false
    if (r.valid_from > iso) return false
    if (r.valid_to && r.valid_to < iso) return false
    return true
  })
}

/**
 * Fiktiver Vorsteuerabzug beim Ankauf von einer Privatperson (kein MWST-Ausweis
 * auf dem Ankaufsbeleg). Formel: Kaufpreis × Satz / (100 + Satz).
 *
 * Beispiel (SCHWEIZ-SAAS.md §4.3): Kauf CHF 10'000 -> fiktive Vorsteuer
 * 10'000 × 8.1 / 108.1 = CHF 749.31.
 */
export function notionalInputTax(purchasePriceRappen, ratePercent) {
  if (purchasePriceRappen == null) return 0
  const rate = Number(ratePercent)
  return Math.round((Number(purchasePriceRappen) * rate) / (100 + rate))
}

/**
 * Umsatzsteuer auf dem Verkaufspreis (inkl. MWST) — dieselbe Formel wie oben,
 * angewendet auf den Verkaufspreis statt den Einkaufspreis.
 */
export function outputTax(salePriceRappen, ratePercent) {
  if (salePriceRappen == null) return 0
  const rate = Number(ratePercent)
  return Math.round((Number(salePriceRappen) * rate) / (100 + rate))
}

/**
 * Die an die ESTV geschuldete Steuer für ein Fahrzeug im Schema
 * 'notional_input_tax': Umsatzsteuer auf dem Verkauf minus fiktive Vorsteuer
 * auf dem Einkauf. Wirtschaftlich identisch mit einer Margenbesteuerung auf
 * der Handelsmarge, buchhalterisch und auf der Rechnung aber etwas anderes
 * (die Rechnung an den Kunden weist die volle MWST offen aus).
 */
export function payableTaxForVehicle({ purchasePriceRappen, salePriceRappen, ratePercent }) {
  const input = notionalInputTax(purchasePriceRappen, ratePercent)
  const output = outputTax(salePriceRappen, ratePercent)
  return output - input
}

/** MWST-Pflicht ab CHF 100'000 Jahresumsatz (SCHWEIZ-SAAS.md §4.2). */
export const VAT_LIABILITY_THRESHOLD_RAPPEN = 100_000 * 100

/** Saldosteuersatz zulässig bis rund CHF 5 Mio. Umsatz / CHF 108'000 Steuerschuld pro Jahr. */
export const NET_TAX_RATE_METHOD_LIMITS = Object.freeze({
  maxRevenueRappen: 5_000_000 * 100,
  maxTaxRappen: 108_000 * 100,
})

/**
 * Schweizer UID validieren — Format CHE-123.456.789 MWST/HR/... — inkl.
 * Prüfziffer (Modulo 11, EAN-13-artig). Eine falsche UID auf hundert
 * Rechnungen ist hundert Korrekturen (SCHWEIZ-SAAS.md §4.2), deshalb wird hier
 * geprüft statt nur auf das Format zu achten.
 */
export function isValidUid(uid) {
  const m = /^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})/.exec(String(uid || '').trim())
  if (!m) return false
  const digits = `${m[1]}${m[2]}${m[3]}`.split('').map(Number)
  const check = digits.pop()
  const weights = [5, 4, 3, 2, 7, 6, 5, 4]
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  const remainder = 11 - (sum % 11)
  const expected = remainder === 11 ? 0 : remainder === 10 ? null : remainder
  return expected !== null && expected === check
}
