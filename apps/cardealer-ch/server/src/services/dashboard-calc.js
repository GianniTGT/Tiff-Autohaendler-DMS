/**
 * Übersicht — reine Rechenlogik, ohne Datenbankzugriff (Muster aus
 * lib/dashboard.js im US-Repo: die Zahlen sind eine Funktion der Fahrzeuge,
 * nicht des Bildschirms, und deshalb ohne Browser testbar).
 *
 * Firmen-Summen (Kapital, Gewinn) gibt es nur, wenn `canSeeTotals` gesetzt
 * ist — die Regel selbst steht in packages/core-auth/src/roles.js, hier
 * wird sie nur als Parameter entgegengenommen.
 */

export const AGEING_DAYS = 60
export const INSPECTION_WARN_DAYS = 30
export const NEEDS_DOING_LIMIT = 6

const ON_LOT = ['in_stock', 'reserved']

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 'YYYY-MM-DD' aus einem pg-Date (lokale Mitternacht) oder einem ISO-String. */
export function dayKey(value) {
  if (!value) return null
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

export function daysBetween(fromDay, toDay) {
  const a = Date.UTC(...fromDay.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
  const b = Date.UTC(...toDay.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
  return Math.round((b - a) / 86_400_000)
}

export const isOnLot = (v) => ON_LOT.includes(v.status)

export function vehicleLabel(v) {
  return [v.make, v.model].filter(Boolean).join(' ') || v.vin || 'Unbekanntes Fahrzeug'
}

/**
 * @param {object[]} vehicles  camelCase-Zeilen aus listVehicles()
 * @param {Map<string, number>} costsByVehicle  Summe aller Kosten je Fahrzeug, Rappen
 * @param {object} options { today: 'YYYY-MM-DD', canSeeTotals }
 */
export function summarizeDashboard(vehicles, costsByVehicle, { today, canSeeTotals }) {
  const counts = { inStock: 0, reserved: 0, sold: 0, writtenOff: 0, onLot: 0 }
  for (const v of vehicles) {
    if (v.status === 'in_stock') counts.inStock += 1
    else if (v.status === 'reserved') counts.reserved += 1
    else if (v.status === 'sold') counts.sold += 1
    else if (v.status === 'written_off') counts.writtenOff += 1
  }
  counts.onLot = counts.inStock + counts.reserved

  const lot = vehicles.filter(isOnLot)
  const year = today.slice(0, 4)
  const soldThisYear = vehicles.filter((v) => v.status === 'sold' && (dayKey(v.soldAt) ?? '').startsWith(year))

  let money = null
  let soldThisYearProfitRappen = null
  if (canSeeTotals) {
    const purchase = lot.reduce((s, v) => s + num(v.purchasePriceRappen), 0)
    const costs = lot.reduce((s, v) => s + (costsByVehicle.get(v.id) ?? 0), 0)
    const asking = lot.reduce((s, v) => s + num(v.askingPriceRappen), 0)
    money = {
      purchaseRappen: purchase,
      costsRappen: costs,
      investedRappen: purchase + costs,
      askingRappen: asking,
      projectedProfitRappen: asking - (purchase + costs),
    }
    soldThisYearProfitRappen = soldThisYear.reduce(
      (s, v) => s + num(v.soldPriceRappen) - num(v.purchasePriceRappen) - (costsByVehicle.get(v.id) ?? 0),
      0,
    )
  }

  const ageing = lot
    .map((v) => {
      const since = dayKey(v.purchasedAt) ?? dayKey(v.createdAt)
      return { id: v.id, label: vehicleLabel(v), days: since ? daysBetween(since, today) : 0 }
    })
    .filter((x) => x.days >= AGEING_DAYS)
    .sort((a, b) => b.days - a.days)

  const inspection = { expired: [], dueSoon: [] }
  for (const v of lot) {
    const until = dayKey(v.inspectionValidUntil)
    if (!until) continue
    const left = daysBetween(today, until)
    const entry = { id: v.id, label: vehicleLabel(v), validUntil: until, daysLeft: left }
    if (left < 0) inspection.expired.push(entry)
    else if (left <= INSPECTION_WARN_DAYS) inspection.dueSoon.push(entry)
  }
  inspection.expired.sort((a, b) => a.daysLeft - b.daysLeft)
  inspection.dueSoon.sort((a, b) => a.daysLeft - b.daysLeft)

  const needsDoing = []
  for (const v of lot) {
    const reasons = []
    if (v.askingPriceRappen == null) reasons.push('noAskingPrice')
    if (!v.inspectionValidUntil && !v.lastInspectionDate) reasons.push('noInspection')
    if (!v.vin && !v.serialNumber) reasons.push('noIdentifier')
    if (reasons.length) needsDoing.push({ id: v.id, label: vehicleLabel(v), reasons })
  }

  // Verkauft, aber das AutoScout24-Inserat läuft (oder ist nicht als abgeschaltet bestätigt): Interessenten
  // würden ein Auto anfragen, das nicht mehr da ist.
  const soldStillListed = vehicles
    .filter((v) => v.status === 'sold' && v.autoscout24ListingId && v.autoscout24Active !== false)
    .map((v) => ({ id: v.id, label: vehicleLabel(v), error: v.autoscout24LastError ?? null }))

  return {
    counts,
    soldStillListed,
    money,
    soldThisYear: { count: soldThisYear.length, profitRappen: soldThisYearProfitRappen },
    ageing,
    inspection,
    needsDoing: needsDoing.slice(0, NEEDS_DOING_LIMIT),
    needsDoingTotal: needsDoing.length,
  }
}
