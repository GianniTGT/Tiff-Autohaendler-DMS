import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEconomics, dealHealth, suggestedPrice, daysOnLot } from '../src/economics.js'

test('computeEconomics computes profit and margin in Rappen', () => {
  const result = computeEconomics({
    purchaseRappen: 1_000_000,
    partsRappen: 50_000,
    laborRappen: 30_000,
    otherRappen: 20_000,
    soldPriceRappen: 1_400_000,
  })
  assert.equal(result.totalInvestedRappen, 1_100_000)
  assert.equal(result.profitRappen, 300_000)
  assert.equal(result.marginPct, 21.43)
  assert.equal(result.health, 'good')
  assert.equal(result.realized, true)
})

test('a written-off vehicle reports the insurance payout, not the asking price', () => {
  const result = computeEconomics({
    purchaseRappen: 1_000_000,
    writtenOff: true,
    recoveryRappen: 400_000,
    askingPriceRappen: 1_400_000, // muss ignoriert werden
  })
  assert.equal(result.priceRappen, 400_000)
  assert.equal(result.profitRappen, -600_000)
  assert.equal(result.health, 'loss')
})

test('a vehicle with no sale yet is not realized', () => {
  const result = computeEconomics({ purchaseRappen: 1_000_000, askingPriceRappen: 1_400_000 })
  assert.equal(result.realized, false)
})

test('dealHealth thresholds', () => {
  assert.equal(dealHealth(0.2), 'good')
  assert.equal(dealHealth(0.05), 'thin')
  assert.equal(dealHealth(-0.1), 'loss')
})

test('suggestedPrice rounds up to the nearest CHF 50', () => {
  assert.equal(suggestedPrice(1_100_000, 0.2), 1_375_000) // CHF 13'750.00, exakt auf 50 Franken
})

test('daysOnLot counts whole days between two dates', () => {
  assert.equal(daysOnLot('2026-01-01', '2026-01-11'), 10)
})
