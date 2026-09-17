import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveMakeKey, resolveModelKey, resolveMakeAndModelKeys, MakeNotFoundError, ModelNotFoundError } from '../src/integrations/autoscout24/lookup.js'

function fakeClient({ makes = [], models = [] } = {}) {
  return {
    listMakes: async () => makes,
    listModels: async () => models,
  }
}

const CREDENTIALS = { clientId: 'c', clientSecret: 's' }

test('resolveMakeKey findet den key case-insensitiv über den Namen', async () => {
  const client = fakeClient({ makes: [{ key: 'volkswagen', name: 'Volkswagen' }, { key: 'audi', name: 'Audi' }] })
  const key = await resolveMakeKey(client, CREDENTIALS, 'volkswagen')
  assert.equal(key, 'volkswagen')
})

test('resolveMakeKey wirft MakeNotFoundError statt zu raten', async () => {
  const client = fakeClient({ makes: [{ key: 'audi', name: 'Audi' }] })
  await assert.rejects(() => resolveMakeKey(client, CREDENTIALS, 'Trabant'), MakeNotFoundError)
})

test('resolveModelKey findet den key innerhalb einer Marke', async () => {
  const client = fakeClient({ models: [{ key: 'golf', name: 'Golf' }, { key: 'polo', name: 'Polo' }] })
  const key = await resolveModelKey(client, CREDENTIALS, 'volkswagen', 'Golf')
  assert.equal(key, 'golf')
})

test('resolveModelKey wirft ModelNotFoundError statt zu raten', async () => {
  const client = fakeClient({ models: [{ key: 'golf', name: 'Golf' }] })
  await assert.rejects(() => resolveModelKey(client, CREDENTIALS, 'volkswagen', 'Käfer'), ModelNotFoundError)
})

test('resolveMakeAndModelKeys löst beides in einem Aufruf auf', async () => {
  const client = fakeClient({
    makes: [{ key: 'volkswagen', name: 'Volkswagen' }],
    models: [{ key: 'golf', name: 'Golf' }],
  })
  const keys = await resolveMakeAndModelKeys(client, CREDENTIALS, { make: 'Volkswagen', model: 'Golf' })
  assert.deepEqual(keys, { makeKey: 'volkswagen', modelKey: 'golf' })
})
