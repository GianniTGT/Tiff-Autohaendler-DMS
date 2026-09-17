import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, francsToRappen, rappenToFrancs, roundToFiveRappen, sumRappen } from '../src/money.js'

test('formatMoney formats Rappen as CHF with apostrophe thousands separator', () => {
  // Node's ICU build renders the de-CH currency-amount space as U+00A0 and
  // the thousands separator as U+0027 or U+2019 depending on the bundled ICU
  // data — check the digits and currency, not the exact code points.
  const formatted = formatMoney(1_250_000)
  assert.match(formatted, /^CHF\s12.500\.00$/)
})

test('formatMoney shows a dash for null instead of CHF 0.00', () => {
  assert.equal(formatMoney(null), '—')
  assert.equal(formatMoney(undefined), '—')
})

test('francsToRappen and rappenToFrancs round-trip', () => {
  assert.equal(francsToRappen('12500.50'), 1_250_050)
  assert.equal(rappenToFrancs(1_250_050), 12500.5)
})

test('roundToFiveRappen rounds to the nearest 5 Rappen', () => {
  assert.equal(roundToFiveRappen(1002), 1000)
  assert.equal(roundToFiveRappen(1003), 1005)
})

test('sumRappen ignores null entries', () => {
  assert.equal(sumRappen([100, null, 200, undefined]), 300)
})
