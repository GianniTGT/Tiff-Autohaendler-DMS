import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, isAssignableRole, canSeeCompanyTotals } from '../src/roles.js'

test('ROLES lists the four CH-Betrieb roles, not the US manager/sales pair', () => {
  assert.deepEqual(ROLES, ['inhaber', 'verkauf', 'werkstatt', 'buchhaltung'])
})

test('isAssignableRole accepts only known roles', () => {
  assert.equal(isAssignableRole('inhaber'), true)
  assert.equal(isAssignableRole('manager'), false) // US-Rolle, hier nicht gültig
})

test('canSeeCompanyTotals is the single place this rule lives', () => {
  assert.equal(canSeeCompanyTotals('inhaber'), true)
  assert.equal(canSeeCompanyTotals('buchhaltung'), true)
  assert.equal(canSeeCompanyTotals('verkauf'), false)
  assert.equal(canSeeCompanyTotals('werkstatt'), false)
})
