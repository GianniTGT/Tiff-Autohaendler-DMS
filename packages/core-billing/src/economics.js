/**
 * Der finanzielle Kern eines Fahrzeugs: Einkauf + Teile + Arbeit + Sonstiges
 * → Gewinn, Marge, Deal-Gesundheit.
 *
 * Portiert aus `lib/economics.js` in Tiff-Cardealer-Manager (US) — dort reine
 * Mathematik ohne DB- oder Netzwerkzugriff, hier unverändert in dieser
 * Eigenschaft, nur auf Rappen (Ganzzahl) statt Dollar (Fliesskomma)
 * umgestellt (ANFORDERUNGEN.md §4).
 *
 * Übernommene Entscheidung aus dem US-Repo (dort 1.0.13, von Gianni
 * getroffen): eine verkaufende Person sieht die Wirtschaftlichkeit **des
 * einen Fahrzeugs** vor sich — ohne das kennt sie ihre eigene Preisuntergrenze
 * nicht. Was sie nicht sieht, sind die Firmen-Summen über alle Fahrzeuge; das
 * ist die einzige Stelle, an der die Rollen-Grenze noch greift, und sie steht
 * als benannte Funktion in packages/core-auth/src/roles.js
 * (`canSeeCompanyTotals`), nicht verstreut über Bildschirme.
 */

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Deal-Gesundheit nach Marge über dem Verkaufspreis. */
export const HEALTH_THRESHOLDS = Object.freeze({ good: 0.15, thin: 0.0 })

/**
 * Berechnet die Wirtschaftlichkeit eines Fahrzeugs. Alle Geldwerte in Rappen.
 *
 * @param {object} input
 * @param {number} input.purchaseRappen   Einkaufspreis
 * @param {number} [input.partsRappen]    Teile & Material
 * @param {number} [input.laborRappen]    Arbeit (Stunden × Ansatz)
 * @param {number} [input.otherRappen]    Transport, Gebühren, Aufbereitung
 * @param {number} [input.askingPriceRappen]
 * @param {number} [input.soldPriceRappen] tatsächlicher Verkaufspreis (hat Vorrang vor askingPrice)
 * @param {boolean} [input.writtenOff]
 * @param {number} [input.recoveryRappen] Versicherungserlös bei Totalschaden
 */
export function computeEconomics(input = {}) {
  const purchase = num(input.purchaseRappen)
  const parts = num(input.partsRappen)
  const labor = num(input.laborRappen)
  const other = num(input.otherRappen)

  // Der Ausgang eines abgeschriebenen Fahrzeugs ist das, was die Versicherung
  // bezahlt hat — nicht der Angebotspreis. Ohne diese Unterscheidung würde ein
  // Totalschaden einen gesunden geplanten Gewinn ausweisen.
  const writtenOff = Boolean(input.writtenOff)
  const recovery = num(input.recoveryRappen)

  const soldPrice = input.soldPriceRappen
  const realized = writtenOff || (soldPrice !== null && soldPrice !== undefined)
  const price = writtenOff
    ? recovery
    : num(soldPrice !== null && soldPrice !== undefined ? soldPrice : input.askingPriceRappen)

  const totalInvested = purchase + parts + labor + other
  const profit = price - totalInvested
  const marginPct = price > 0 ? Math.round((profit / price) * 10000) / 100 : 0
  const roiPct = totalInvested > 0 ? Math.round((profit / totalInvested) * 10000) / 100 : 0

  return {
    purchaseRappen: purchase,
    partsRappen: parts,
    laborRappen: labor,
    otherRappen: other,
    totalInvestedRappen: totalInvested,
    priceRappen: price,
    profitRappen: profit,
    marginPct,
    roiPct,
    // Ein Totalschaden ohne Erlös zeigt sonst 0% Marge statt des tatsächlichen
    // Totalverlusts — deshalb prüft dieser Fall `profit < 0`, nicht die Marge.
    health: writtenOff && profit < 0 ? 'loss' : dealHealth(marginPct / 100),
    realized,
    writtenOff,
  }
}

/** @returns {'good'|'thin'|'loss'} */
export function dealHealth(marginFraction) {
  if (!Number.isFinite(marginFraction) || marginFraction <= HEALTH_THRESHOLDS.thin) return 'loss'
  if (marginFraction >= HEALTH_THRESHOLDS.good) return 'good'
  return 'thin'
}

/**
 * Vorgeschlagener Preis, um eine Zielmarge zu erreichen.
 * price = totalInvested / (1 - targetMargin)
 * @param {number} totalInvestedRappen
 * @param {number} [targetMargin=0.20] Anteil, z.B. 0.20 = 20%
 * @param {number} [roundToRappen=5000] Aufrundung, Default CHF 50
 */
export function suggestedPrice(totalInvestedRappen, targetMargin = 0.2, roundToRappen = 5000) {
  const t = num(totalInvestedRappen)
  if (t <= 0) return 0
  if (!(targetMargin > 0 && targetMargin < 1)) return t
  const raw = t / (1 - targetMargin)
  return Math.ceil(raw / roundToRappen) * roundToRappen
}

/** Tage im Bestand bis heute (oder bis zum Verkauf). */
export function daysOnLot(acquiredDate, soldDate = null) {
  const start = new Date(acquiredDate)
  if (Number.isNaN(start.getTime())) return 0
  const end = soldDate ? new Date(soldDate) : new Date()
  return Math.max(0, Math.round((end - start) / 86400000))
}
