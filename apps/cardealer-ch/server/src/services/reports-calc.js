/**
 * Auswertungen — reine Rechenlogik (Muster: lib/statistics.js im
 * Manager-Repo). Beide Berichte zeigen Einkaufspreise und Gewinne und sind
 * deshalb nur für Rollen mit `canSeeCompanyTotals` gedacht (Route prüft).
 *
 * Gewinn = Verkaufspreis − Einkaufspreis − erfasste Kosten. Ein Fahrzeug ohne
 * Verkaufs- oder Einkaufspreis hat keinen berechenbaren Gewinn: es wird mit
 * `profitRappen: null` aufgeführt und aus den Summen herausgehalten, statt
 * als 0 oder als reiner Gewinn des Verkaufspreises zu zählen.
 */
import { dayKey, daysBetween } from './dashboard-calc.js'

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const label = (v) => [v.make, v.model].filter(Boolean).join(' ') || v.vin || 'Fahrzeug'

export const AGE_BUCKETS = Object.freeze([
  { key: 'd0_30', from: 0, to: 30 },
  { key: 'd31_60', from: 31, to: 60 },
  { key: 'd61_90', from: 61, to: 90 },
  { key: 'd91_plus', from: 91, to: Infinity },
])

/** Verkaufte Fahrzeuge einer Periode, mit Gewinn, Marge und Standzeit. */
export function salesReport(vehicles, costsByVehicle, { from, to }) {
  const sold = vehicles.filter((v) => {
    const day = dayKey(v.soldAt)
    return v.status === 'sold' && day && day >= from && day <= to
  })

  const rows = sold
    .map((v) => {
      const price = num(v.soldPriceRappen)
      const purchase = num(v.purchasePriceRappen)
      const costs = costsByVehicle.get(v.id) ?? 0
      const computable = price != null && purchase != null
      const profit = computable ? price - purchase - costs : null
      const bought = dayKey(v.purchasedAt)
      return {
        id: v.id,
        label: label(v),
        vin: v.vin ?? null,
        soldAt: dayKey(v.soldAt),
        daysInStock: bought ? daysBetween(bought, dayKey(v.soldAt)) : null,
        soldPriceRappen: price,
        purchasePriceRappen: purchase,
        costsRappen: costs,
        profitRappen: profit,
        marginPct: computable && price > 0 ? Math.round((profit / price) * 1000) / 10 : null,
      }
    })
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt))

  const counted = rows.filter((r) => r.profitRappen != null)
  const revenue = counted.reduce((s, r) => s + r.soldPriceRappen, 0)
  const profit = counted.reduce((s, r) => s + r.profitRappen, 0)
  const withDays = rows.filter((r) => r.daysInStock != null)

  return {
    from,
    to,
    rows,
    totals: {
      sold: rows.length,
      counted: counted.length,
      notComputable: rows.length - counted.length,
      revenueRappen: revenue,
      profitRappen: profit,
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      avgDaysInStock: withDays.length ? Math.round(withDays.reduce((s, r) => s + r.daysInStock, 0) / withDays.length) : null,
    },
  }
}

/** Fahrzeuge im Bestand nach Alter: Anzahl und gebundenes Kapital je Altersstufe. */
export function stockAgeReport(vehicles, costsByVehicle, today) {
  const lot = vehicles.filter((v) => v.status === 'in_stock' || v.status === 'reserved')
  const rows = lot.map((v) => {
    const since = dayKey(v.purchasedAt) ?? dayKey(v.createdAt)
    const days = since ? daysBetween(since, today) : 0
    const purchase = num(v.purchasePriceRappen) ?? 0
    return {
      id: v.id,
      label: label(v),
      days,
      investedRappen: purchase + (costsByVehicle.get(v.id) ?? 0),
      askingPriceRappen: num(v.askingPriceRappen),
    }
  })

  const buckets = AGE_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.days >= b.from && r.days <= b.to)
    return {
      key: b.key,
      count: inBucket.length,
      investedRappen: inBucket.reduce((s, r) => s + r.investedRappen, 0),
    }
  })

  return {
    today,
    total: { count: rows.length, investedRappen: rows.reduce((s, r) => s + r.investedRappen, 0) },
    buckets,
    oldest: [...rows].sort((a, b) => b.days - a.days).slice(0, 10),
  }
}
