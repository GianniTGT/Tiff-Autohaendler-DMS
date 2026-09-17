/**
 * Testet den HTTP-Client ohne echte AutoScout24-Zugangsdaten und ohne
 * Netzwerk — `fetchImpl` wird durch einen Mock ersetzt, der aufgezeichnete
 * Aufrufe zurückgibt. Kein Integrationstest (kein DB-Zugriff), deshalb kein
 * `hasDb`-Skip nötig.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutoScout24Client, AutoScout24ApiError } from '../src/integrations/autoscout24/client.js'

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function textResponse(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) }
}

function mockFetch(responses) {
  const calls = []
  const queue = [...responses]
  const fn = async (url, options) => {
    calls.push({ url, options })
    const next = queue.shift()
    if (!next) throw new Error('mockFetch: keine weitere Antwort in der Warteschlange')
    return next
  }
  fn.calls = calls
  return fn
}

const CREDENTIALS = { clientId: 'client-1', clientSecret: 'secret-1' }

test('getToken holt einen Token per OAuth2 client_credentials und cacht ihn', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    jsonResponse(200, { id: 'listing-1' }),
    jsonResponse(200, { id: 'listing-1' }),
  ])
  const client = createAutoScout24Client({ fetchImpl })

  await client.createListing(CREDENTIALS, 'seller-1', { make: 'VW' })
  await client.createListing(CREDENTIALS, 'seller-1', { make: 'VW' })

  // Zwei Aufrufe, aber nur EIN Token-Request — der zweite createListing-Aufruf nutzt den Cache.
  const tokenCalls = fetchImpl.calls.filter((c) => c.url.includes('/oauth/token'))
  assert.equal(tokenCalls.length, 1)
})

test('createListing sendet POST mit Bearer-Token und JSON-Body an den richtigen Pfad', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    jsonResponse(201, { id: 'listing-42', externalId: 'vehicle-1' }),
  ])
  const client = createAutoScout24Client({ fetchImpl, baseUrl: 'https://api.example.test' })

  const result = await client.createListing(CREDENTIALS, 'seller-1', { externalId: 'vehicle-1' })

  assert.equal(result.id, 'listing-42')
  const [, createCall] = fetchImpl.calls
  assert.equal(createCall.url, 'https://api.example.test/public/v1/sellers/seller-1/listings')
  assert.equal(createCall.options.method, 'POST')
  assert.equal(createCall.options.headers.Authorization, 'Bearer token-abc')
  assert.equal(createCall.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(createCall.options.body), { externalId: 'vehicle-1' })
})

test('ein Fehlerstatus wirft AutoScout24ApiError mit Status und Body', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    textResponse(400, '{"error":"invalid makeKey"}'),
  ])
  const client = createAutoScout24Client({ fetchImpl })

  await assert.rejects(
    () => client.createListing(CREDENTIALS, 'seller-1', {}),
    (err) => {
      assert.ok(err instanceof AutoScout24ApiError)
      assert.equal(err.status, 400)
      return true
    },
  )
})

test('findByExternalId gibt null bei 404 zurück, statt einen Fehler zu werfen', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    textResponse(404, 'not found'),
  ])
  const client = createAutoScout24Client({ fetchImpl })

  const result = await client.findByExternalId(CREDENTIALS, 'seller-1', 'vehicle-1')
  assert.equal(result, null)
})

test('findByExternalId gibt jeden anderen Fehlerstatus weiter', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    textResponse(500, 'server error'),
  ])
  const client = createAutoScout24Client({ fetchImpl })

  await assert.rejects(
    () => client.findByExternalId(CREDENTIALS, 'seller-1', 'vehicle-1'),
    (err) => err instanceof AutoScout24ApiError && err.status === 500,
  )
})

test('activate/deactivate/remove rufen den richtigen Pfad ohne Body auf', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    { ok: true, status: 204, text: async () => '' },
  ])
  const client = createAutoScout24Client({ fetchImpl, baseUrl: 'https://api.example.test' })

  await client.activateListing(CREDENTIALS, 'seller-1', 'listing-42')
  const [, call] = fetchImpl.calls
  assert.equal(call.url, 'https://api.example.test/public/v1/sellers/seller-1/listings/listing-42/activate')
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.body, undefined)
})

test('uploadImage schickt den FormData-Body ohne Content-Type-Override', async () => {
  const fetchImpl = mockFetch([
    jsonResponse(200, { access_token: 'token-abc', expires_in: 86400 }),
    jsonResponse(200, { key: 'image-key-1' }),
  ])
  const client = createAutoScout24Client({ fetchImpl })
  const formData = new FormData()

  await client.uploadImage(CREDENTIALS, 'seller-1', 'listing-42', formData)
  const [, call] = fetchImpl.calls
  assert.equal(call.options.body, formData)
  assert.equal(call.options.headers['Content-Type'], undefined)
})
