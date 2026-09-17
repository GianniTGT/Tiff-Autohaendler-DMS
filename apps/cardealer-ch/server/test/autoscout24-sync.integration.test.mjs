/**
 * Integrationstest gegen echtes PostgreSQL, aber mit einem gemockten
 * AutoScout24-Client (kein Netzwerk, keine echten Zugangsdaten nötig) —
 * siehe integrations/autoscout24/client.js für die Injektion.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createVehicle, getVehicle } from '../src/services/vehicles.js'
import {
  pushVehicleToAutoScout24,
  activateAutoScout24Listing,
  deactivateAutoScout24Listing,
  removeAutoScout24Listing,
} from '../src/services/autoscout24-sync.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

function fakeAutoScout24Client({ existingListing = null } = {}) {
  const calls = []
  return {
    calls,
    listMakes: async () => {
      calls.push('listMakes')
      return [{ key: 'volkswagen', name: 'Volkswagen' }]
    },
    listModels: async () => {
      calls.push('listModels')
      return [{ key: 'golf', name: 'Golf' }]
    },
    findByExternalId: async (_credentials, _sellerId, externalId) => {
      calls.push(['findByExternalId', externalId])
      return existingListing
    },
    createListing: async (_credentials, _sellerId, payload) => {
      calls.push(['createListing', payload])
      return { id: 'as24-listing-1' }
    },
    updateListing: async (_credentials, _sellerId, listingId, payload) => {
      calls.push(['updateListing', listingId, payload])
      return { id: listingId }
    },
    activateListing: async (_credentials, _sellerId, listingId) => {
      calls.push(['activateListing', listingId])
    },
    deactivateListing: async (_credentials, _sellerId, listingId) => {
      calls.push(['deactivateListing', listingId])
    },
    removeListing: async (_credentials, _sellerId, listingId) => {
      calls.push(['removeListing', listingId])
    },
  }
}

test('AutoScout24-Sync: pushen, aktivieren, deaktivieren, entfernen', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'as24-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, autoscout24_client_id, autoscout24_client_secret, autoscout24_seller_id)
       VALUES (gen_random_uuid(), 'A', 'A AG', $1, 'client-1', 'secret-1', 'seller-1')
       RETURNING id`,
      [slug],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
  })

  const vehicle = await createVehicle(tenantId, {
    make: 'Volkswagen',
    model: 'Golf',
    vehicleCategory: 'car',
    bodyColor: 'white',
    bodyType: 'small-car',
    conditionType: 'used',
    firstRegistrationDate: '2020-06-15',
    warrantyType: 'from-delivery',
    askingPriceRappen: 2_400_000,
  })

  await t.test('ohne Zugangsdaten wird klar abgelehnt, nicht stillschweigend übersprungen', async () => {
    const noCredsTenant = (
      await adminPool.query(
        "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'B', 'B AG', $1) RETURNING id",
        ['as24-test-nocreds-' + Math.random().toString(36).slice(2, 8)],
      )
    ).rows[0].id
    await assert.rejects(() => pushVehicleToAutoScout24(noCredsTenant, vehicle.id, { client: fakeAutoScout24Client() }))
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [noCredsTenant])
  })

  await t.test('pushVehicleToAutoScout24 löst make/model auf, legt ein neues Inserat an und schreibt die ID zurück', async () => {
    const mockClient = fakeAutoScout24Client({ existingListing: null })
    const result = await pushVehicleToAutoScout24(tenantId, vehicle.id, { client: mockClient })

    assert.equal(result.listingId, 'as24-listing-1')
    assert.ok(mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'createListing'))
    assert.ok(!mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'updateListing'))

    const stored = await getVehicle(tenantId, vehicle.id)
    assert.equal(stored.autoscout24ListingId, 'as24-listing-1')
    assert.ok(stored.autoscout24SyncedAt)
  })

  await t.test('ein zweiter Push für dasselbe Fahrzeug aktualisiert das bestehende Inserat, legt kein zweites an', async () => {
    const mockClient = fakeAutoScout24Client()
    await pushVehicleToAutoScout24(tenantId, vehicle.id, { client: mockClient })

    assert.ok(!mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'createListing'))
    assert.ok(mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'updateListing' && c[1] === 'as24-listing-1'))
  })

  await t.test('explizit mitgegebene makeKey/modelKey überspringen die Marken-Auflösung', async () => {
    const mockClient = fakeAutoScout24Client()
    await pushVehicleToAutoScout24(tenantId, vehicle.id, { client: mockClient, makeKey: 'audi', modelKey: 'a6' })
    assert.ok(!mockClient.calls.includes('listMakes'))
  })

  await t.test('activate/deactivate rufen den Client mit der gespeicherten listingId auf', async () => {
    const mockClient = fakeAutoScout24Client()
    await activateAutoScout24Listing(tenantId, vehicle.id, { client: mockClient })
    await deactivateAutoScout24Listing(tenantId, vehicle.id, { client: mockClient })
    assert.ok(mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'activateListing' && c[1] === 'as24-listing-1'))
    assert.ok(mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'deactivateListing' && c[1] === 'as24-listing-1'))
  })

  await t.test('removeAutoScout24Listing entfernt das Inserat und leert die gespeicherte ID', async () => {
    const mockClient = fakeAutoScout24Client()
    await removeAutoScout24Listing(tenantId, vehicle.id, { client: mockClient })
    assert.ok(mockClient.calls.some((c) => Array.isArray(c) && c[0] === 'removeListing'))

    const stored = await getVehicle(tenantId, vehicle.id)
    assert.equal(stored.autoscout24ListingId, null)
  })

  await t.test('activate ohne bestehendes Inserat wird klar abgelehnt', async () => {
    await assert.rejects(() => activateAutoScout24Listing(tenantId, vehicle.id, { client: fakeAutoScout24Client() }))
  })
})
