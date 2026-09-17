import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../src/password.js'

test('a correct password verifies against its own hash', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.equal(await verifyPassword('correct horse battery staple', hash), true)
})

test('a wrong password is rejected', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.equal(await verifyPassword('wrong password entirely', hash), false)
})

test('two hashes of the same password differ (random salt)', async () => {
  const a = await hashPassword('correct horse battery staple')
  const b = await hashPassword('correct horse battery staple')
  assert.notEqual(a, b)
})

test('rejects passwords shorter than 10 characters', async () => {
  await assert.rejects(() => hashPassword('short'))
})

test('verifyPassword returns false, never throws, for garbage input', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false)
  assert.equal(await verifyPassword('anything', ''), false)
  assert.equal(await verifyPassword('anything', null), false)
})
