import { test } from 'node:test'
import assert from 'node:assert/strict'
import { salesReport, stockAgeReport } from '../src/services/reports-calc.js'

const car = (over) => ({
  id: 'x', make: 'VW', model: 'Golf', vin: 'V', status: 'sold',
  purchasePriceRappen: '1000000', soldPriceRappen: '1300000', purchasedAt: '2026-06-01', soldAt: '2026-08-10', createdAt: '2026-06-01', ...over,
})
const range = { from: '2026-01-01', to: '2026-12-31' }

test('Gewinn = Verkauf − Einkauf − Kosten, Marge auf den Verkaufspreis, Standzeit in Tagen', () => {
  const r = salesReport([car({ id: 'a' })], new Map([['a', 50_000]]), range)
  assert.equal(r.rows[0].profitRappen, 250_000)
  assert.equal(r.rows[0].marginPct, 19.2)
  assert.equal(r.rows[0].daysInStock, 70)
  assert.equal(r.totals.profitRappen, 250_000)
  assert.equal(r.totals.revenueRappen, 1_300_000)
  assert.equal(r.totals.avgDaysInStock, 70)
})

test('Nur verkaufte Fahrzeuge der Periode; Grenzen zählen mit', () => {
  const vehicles = [
    car({ id: 'in', soldAt: '2026-12-31' }),
    car({ id: 'out', soldAt: '2027-01-01' }),
    car({ id: 'early', soldAt: '2025-12-31' }),
    car({ id: 'stock', status: 'in_stock', soldAt: null }),
  ]
  assert.deepEqual(salesReport(vehicles, new Map(), range).rows.map((r) => r.id), ['in'])
})

test('Ohne Einkaufs- oder Verkaufspreis: kein Gewinn, nicht in den Summen — nie als 0 oder als reiner Erlös', () => {
  const vehicles = [car({ id: 'ok' }), car({ id: 'noPurchase', purchasePriceRappen: null }), car({ id: 'noSale', soldPriceRappen: null })]
  const r = salesReport(vehicles, new Map(), range)
  assert.equal(r.totals.sold, 3)
  assert.equal(r.totals.counted, 1)
  assert.equal(r.totals.notComputable, 2)
  assert.equal(r.totals.profitRappen, 300_000)
  assert.equal(r.rows.find((x) => x.id === 'noPurchase').profitRappen, null)
  assert.equal(r.rows.find((x) => x.id === 'noPurchase').marginPct, null)
})

test('Verlust wird als negativer Gewinn gezeigt', () => {
  const r = salesReport([car({ id: 'l', soldPriceRappen: '900000' })], new Map([['l', 20_000]]), range)
  assert.equal(r.rows[0].profitRappen, -120_000)
  assert.equal(r.totals.marginPct, -13.3)
})

test('Leere Periode: keine Division durch null', () => {
  const r = salesReport([], new Map(), range)
  assert.equal(r.totals.marginPct, null)
  assert.equal(r.totals.avgDaysInStock, null)
  assert.equal(r.totals.profitRappen, 0)
})

test('Lagerbestand nach Alter: Stufen, Kapital inkl. Kosten, nur Bestand', () => {
  const today = '2026-10-03'
  const vehicles = [
    car({ id: 'new', status: 'in_stock', purchasedAt: '2026-09-20', soldPriceRappen: null }),
    car({ id: 'mid', status: 'reserved', purchasedAt: '2026-08-10', soldPriceRappen: null }),
    car({ id: 'old', status: 'in_stock', purchasedAt: '2026-03-01', soldPriceRappen: null }),
    car({ id: 'sold' }),
  ]
  const r = stockAgeReport(vehicles, new Map([['old', 100_000]]), today)
  assert.equal(r.total.count, 3)
  assert.deepEqual(r.buckets.map((b) => [b.key, b.count]), [['d0_30', 1], ['d31_60', 1], ['d61_90', 0], ['d91_plus', 1]])
  assert.equal(r.buckets[3].investedRappen, 1_100_000)
  assert.equal(r.oldest[0].id, 'old')
})

test('Grenzen der Altersstufen: 30/31, 60/61, 90/91 Tage', () => {
  const today = '2026-10-03'
  const at = (days) => {
    const d = new Date(Date.UTC(2026, 9, 3) - days * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  const vehicles = [30, 31, 60, 61, 90, 91].map((d) => car({ id: `d${d}`, status: 'in_stock', purchasedAt: at(d), soldPriceRappen: null }))
  const r = stockAgeReport(vehicles, new Map(), today)
  assert.deepEqual(r.buckets.map((b) => b.count), [1, 2, 2, 1])
})
