/**
 * Integrationstest gegen echtes PostgreSQL — Fahrzeuge erfassen, ändern,
 * Mandantentrennung. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { listVehicles, getVehicle, createVehicle, updateVehicle, getVehicleEconomics } from '../src/services/vehicles.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Fahrzeuge: erfassen, lesen, ändern, Wirtschaftlichkeit, Mandantentrennung', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const tenantA = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'A', 'A AG', $1) RETURNING id",
      ['vehicles-test-a-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id
  const tenantB = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'B', 'B AG', $1) RETURNING id",
      ['vehicles-test-b-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.end()
    await closePool()
  })

  await t.test('createVehicle nimmt nur bekannte Felder an und ignoriert unbekannte', async () => {
    const vehicle = await createVehicle(tenantA, {
      vin: 'WVWZZZ1JZXW000001',
      make: 'VW',
      model: 'Golf',
      mileageKm: 42000,
      purchasePriceRappen: 1_000_000,
      askingPriceRappen: 1_400_000,
      status: 'in_stock',
      notARealColumn: 'DROP TABLE vehicles;', // muss stillschweigend ignoriert werden
    })
    assert.equal(vehicle.make, 'VW')
    assert.equal(vehicle.mileageKm, 42000)
    assert.equal(vehicle.tenantId, tenantA)
  })

  await t.test('getVehicle liefert das erfasste Fahrzeug zurück', async () => {
    const created = await createVehicle(tenantA, { vin: 'VIN2', make: 'Audi', model: 'A4' })
    const fetched = await getVehicle(tenantA, created.id)
    assert.equal(fetched.make, 'Audi')
  })

  await t.test('updateVehicle ändert nur die übergebenen Felder', async () => {
    const created = await createVehicle(tenantA, { vin: 'VIN3', make: 'BMW', model: '3er', mileageKm: 10000 })
    const updated = await updateVehicle(tenantA, created.id, { mileageKm: 15000 })
    assert.equal(updated.mileageKm, 15000)
    assert.equal(updated.make, 'BMW') // unverändert
  })

  await t.test('getVehicleEconomics berechnet Gewinn aus Einkauf/Verkauf', async () => {
    const created = await createVehicle(tenantA, {
      vin: 'VIN4',
      make: 'Skoda',
      model: 'Octavia',
      purchasePriceRappen: 1_000_000,
      soldPriceRappen: 1_300_000,
    })
    const economics = await getVehicleEconomics(tenantA, created.id)
    assert.equal(economics.profitRappen, 300_000)
    assert.equal(economics.realized, true)
  })

  await t.test('Mandant B sieht Mandant As Fahrzeuge nicht', async () => {
    await createVehicle(tenantA, { vin: 'ONLY-A', make: 'Seat', model: 'Leon' })
    const bList = await listVehicles(tenantB)
    assert.equal(bList.length, 0)
    const aList = await listVehicles(tenantA)
    assert.ok(aList.length > 0)
  })
})
