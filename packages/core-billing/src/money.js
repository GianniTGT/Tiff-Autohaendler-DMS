/**
 * Geld, ausschliesslich CHF, ausschliesslich Rappen als Ganzzahl.
 *
 * Anders als lib/locale.js im US-Repo (Tiff-Cardealer-Manager) gibt es hier
 * keinen Region-Umschalter — dieses Produkt kennt nur die Schweiz. Und anders
 * als dessen `REAL`-Spalten in SQLite wird hier nie mit Franken als
 * Fliesskommazahl gerechnet: `12.10` ist im Binärsystem nicht exakt
 * darstellbar, und der Fehler zeigt sich als Rappen-Differenz in der
 * MWST-Abrechnung, die niemand mehr findet (SCHWEIZ-SAAS.md §4.1).
 *
 * Jede Funktion hier nimmt und liefert Rappen (bigint oder number, ganzzahlig).
 * Nur an der Anzeige-Kante wird nach Franken formatiert.
 */

const LOCALE = 'de-CH'

/** Rappen -> "CHF 12'500.00". `null`/`undefined` wird zu einem Gedankenstrich,
 * nicht zu "CHF 0.00" — ein Fahrzeug ohne erfassten Preis kostet nicht nichts. */
export function formatMoney(rappen, { blank = '—' } = {}) {
  if (rappen == null || !Number.isFinite(Number(rappen))) return blank
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(rappen) / 100)
}

/** Franken-Eingabe (z.B. aus einem Formularfeld "12500.50") -> Rappen. */
export function francsToRappen(value) {
  if (value == null || value === '') return null
  return Math.round(Number(value) * 100)
}

export function rappenToFrancs(rappen) {
  if (rappen == null) return null
  return Number(rappen) / 100
}

/**
 * 5-Rappen-Rundung — nur beim Barzahlungs-Kassieren, nie auf der Rechnung
 * selbst (SCHWEIZ-SAAS.md §4.1: "wer die Rechnung rundet, hat die
 * Buchhaltung gegen sich"). Diese Funktion ist deshalb bewusst nicht Teil von
 * formatMoney() — sie muss explizit an der Kasse aufgerufen werden.
 */
export function roundToFiveRappen(rappen) {
  return Math.round(Number(rappen) / 5) * 5
}

export function sumRappen(values) {
  return values.reduce((total, v) => total + (v == null ? 0 : Number(v)), 0)
}
