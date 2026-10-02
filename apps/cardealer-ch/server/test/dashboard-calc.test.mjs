import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeDashboard, daysBetween, dayKey } from '../src/services/dashboard-calc.js'

const today = '2026-10-03'
const v = (over) => ({
  id: over.id ?? 'x',
  status: 'in_stock',
  make: 'VW',
  model: 'Golf',
  vin: 'WVW1',
  purchasePriceRappen: '1000000',
  askingPriceRappen: '1300000',
  purchasedAt: '2026-09-20',
  inspectionValidUntil: '2027-05-01',
  ...over,
})

test('daysBetween rechnet in ganzen Kalendertagen', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-03'), 2)
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2)
})

test('dayKey liest pg-Dates in lokaler Zeit, nicht UTC', () => {
  assert.equal(dayKey(new Date(2026, 9, 3)), '2026-10-03')
  assert.equal(dayKey('2026-10-03T00:00:00.000Z'), '2026-10-03')
  assert.equal(dayKey(null), null)
})

test('Summen: Kapital = Einkauf + Kosten, Gewinn = Angebot − Kapital, nur für canSeeTotals', () => {
  const vehicles = [v({ id: 'a' }), v({ id: 'b', purchasePriceRappen: '500000', askingPriceRappen: '700000' })]
  const costs = new Map([['a', 50_000]])
  const full = summarizeDashboard(vehicles, costs, { today, canSeeTotals: true })
  assert.equal(full.money.purchaseRappen, 1_500_000)
  assert.equal(full.money.investedRappen, 1_550_000)
  assert.equal(full.money.askingRappen, 2_000_000)
  assert.equal(full.money.projectedProfitRappen, 450_000)

  const limited = summarizeDashboard(vehicles, costs, { today, canSeeTotals: false })
  assert.equal(limited.money, null)
  assert.equal(limited.soldThisYear.profitRappen, null)
})

test('Zähler und Verkauf dieses Jahr', () => {
  const vehicles = [
    v({ id: 'a' }),
    v({ id: 'b', status: 'reserved' }),
    v({ id: 'c', status: 'sold', soldAt: '2026-03-01', soldPriceRappen: '1500000' }),
    v({ id: 'd', status: 'sold', soldAt: '2025-12-31', soldPriceRappen: '900000' }),
  ]
  const s = summarizeDashboard(vehicles, new Map(), { today, canSeeTotals: true })
  assert.deepEqual(s.counts, { inStock: 1, reserved: 1, sold: 2, writtenOff: 0, onLot: 2 })
  assert.equal(s.soldThisYear.count, 1)
  assert.equal(s.soldThisYear.profitRappen, 500_000)
})

test('Standzeit ab 60 Tagen, älteste zuerst; verkaufte zählen nicht', () => {
  const vehicles = [
    v({ id: 'a', purchasedAt: '2026-07-01' }),
    v({ id: 'b', purchasedAt: '2026-05-01' }),
    v({ id: 'c', purchasedAt: '2026-09-25' }),
    v({ id: 'd', purchasedAt: '2026-01-01', status: 'sold' }),
  ]
  const s = summarizeDashboard(vehicles, new Map(), { today, canSeeTotals: false })
  assert.deepEqual(s.ageing.map((x) => x.id), ['b', 'a'])
})

test('MFK: abgelaufen vs. in 30 Tagen fällig', () => {
  const vehicles = [
    v({ id: 'a', inspectionValidUntil: '2026-09-30' }),
    v({ id: 'b', inspectionValidUntil: '2026-10-20' }),
    v({ id: 'c', inspectionValidUntil: '2026-12-01' }),
  ]
  const s = summarizeDashboard(vehicles, new Map(), { today, canSeeTotals: false })
  assert.deepEqual(s.inspection.expired.map((x) => x.id), ['a'])
  assert.deepEqual(s.inspection.dueSoon.map((x) => x.id), ['b'])
})

test('Zu erledigen: fehlender Preis, MFK, Identifikation — begrenzt, Gesamtzahl bleibt', () => {
  const vehicles = Array.from({ length: 8 }, (_, i) => v({ id: `p${i}`, askingPriceRappen: null }))
  vehicles.push(v({ id: 'ok' }))
  const s = summarizeDashboard(vehicles, new Map(), { today, canSeeTotals: false })
  assert.equal(s.needsDoing.length, 6)
  assert.equal(s.needsDoingTotal, 8)
  assert.deepEqual(s.needsDoing[0].reasons, ['noAskingPrice'])
})
