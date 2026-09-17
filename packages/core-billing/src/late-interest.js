/**
 * Verzugszins nach OR Art. 104 Abs. 1: 5% pro Jahr, sofern nichts anderes
 * vereinbart ist — kein Wert, den ein Mandant frei wählt (anders als der
 * MWST-Satz), deshalb hier als Konstante statt als Tabelle wie tax_rates.
 *
 * Zins läuft ab dem Tag NACH Fälligkeit (Verzug tritt erst danach ein), auf
 * dem zum Zeitpunkt noch offenen Betrag, einfache Verzinsung (keine
 * Zinseszinsen — üblich bei Mahnungen).
 */
export const STATUTORY_LATE_INTEREST_RATE_PERCENT = 5

const DAY_MS = 24 * 60 * 60 * 1000

/** Ganze Tage seit Fälligkeit — 0 oder weniger, wenn noch nicht überfällig. */
export function daysOverdue(dueDate, asOfDate) {
  const due = new Date(`${dueDate}T00:00:00Z`)
  const asOf = new Date(`${asOfDate}T00:00:00Z`)
  return Math.max(0, Math.round((asOf - due) / DAY_MS))
}

/**
 * @param {number} outstandingRappen
 * @param {string} dueDate ISO-Datum
 * @param {string} asOfDate ISO-Datum, i.d.R. heute
 * @param {number} [ratePercent] Default 5% (OR 104)
 */
export function calculateLateInterest(
  outstandingRappen,
  dueDate,
  asOfDate,
  ratePercent = STATUTORY_LATE_INTEREST_RATE_PERCENT,
) {
  const days = daysOverdue(dueDate, asOfDate)
  if (days <= 0 || outstandingRappen <= 0) return 0
  return Math.round((Number(outstandingRappen) * ratePercent * days) / 100 / 365)
}
