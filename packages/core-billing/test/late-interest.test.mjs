import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysOverdue, calculateLateInterest } from '../src/late-interest.js'

test('daysOverdue counts whole days after the due date', () => {
  assert.equal(daysOverdue('2026-01-01', '2026-01-31'), 30)
})

test('daysOverdue is 0, never negative, before or on the due date', () => {
  assert.equal(daysOverdue('2026-01-31', '2026-01-01'), 0)
  assert.equal(daysOverdue('2026-01-01', '2026-01-01'), 0)
})

test('calculateLateInterest applies 5% per annum, simple interest, on the outstanding amount', () => {
  // CHF 10'000 (1'000'000 Rappen), 365 Tage überfällig, 5% -> genau CHF 500
  const interest = calculateLateInterest(1_000_000, '2025-01-01', '2026-01-01')
  assert.equal(interest, 50_000)
})

test('calculateLateInterest is 0 when not yet overdue', () => {
  assert.equal(calculateLateInterest(1_000_000, '2026-06-01', '2026-05-01'), 0)
})

test('calculateLateInterest is 0 for a zero or negative outstanding amount', () => {
  assert.equal(calculateLateInterest(0, '2025-01-01', '2026-01-01'), 0)
  assert.equal(calculateLateInterest(-100, '2025-01-01', '2026-01-01'), 0)
})

test('calculateLateInterest accepts a different rate when the contract says so', () => {
  const interest = calculateLateInterest(1_000_000, '2025-01-01', '2026-01-01', 8)
  assert.equal(interest, 80_000)
})
