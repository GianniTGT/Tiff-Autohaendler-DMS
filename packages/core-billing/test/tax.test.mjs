import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTaxRate, notionalInputTax, outputTax, payableTaxForVehicle, isValidUid } from '../src/tax.js'

const RATES = [
  { code: 'standard', rate_percent: 7.7, valid_from: '2018-01-01', valid_to: '2023-12-31' },
  { code: 'standard', rate_percent: 8.1, valid_from: '2024-01-01', valid_to: null },
]

test('findTaxRate picks the rate valid on the given date', () => {
  assert.equal(findTaxRate(RATES, 'standard', '2023-06-01').rate_percent, 7.7)
  assert.equal(findTaxRate(RATES, 'standard', '2024-06-01').rate_percent, 8.1)
})

test('notionalInputTax matches the SCHWEIZ-SAAS.md §4.3 worked example', () => {
  // Kauf CHF 10'000 -> fiktive Vorsteuer CHF 749.31
  assert.equal(notionalInputTax(1_000_000, 8.1), 74_931)
})

test('payableTaxForVehicle matches the worked example (CHF 299.72 owed)', () => {
  const owed = payableTaxForVehicle({
    purchasePriceRappen: 1_000_000, // CHF 10'000
    salePriceRappen: 1_400_000, // CHF 14'000
    ratePercent: 8.1,
  })
  assert.equal(owed, 29_972) // CHF 299.72
})

test('outputTax computes VAT included in the sale price', () => {
  assert.equal(outputTax(1_400_000, 8.1), 104_903)
})

test('isValidUid accepts a well-formed CHE UID with correct check digit', () => {
  assert.equal(isValidUid('CHE-123.456.788 MWST'), true)
})

test('isValidUid rejects a wrong check digit and garbage input', () => {
  assert.equal(isValidUid('CHE-123.456.789 MWST'), false)
  assert.equal(isValidUid('not-a-uid'), false)
  assert.equal(isValidUid(''), false)
})
