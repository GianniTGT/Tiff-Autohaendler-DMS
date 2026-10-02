/**
 * Integrationstest gegen echtes PostgreSQL — Kosten pro Fahrzeug, Gewinn,
 * Verkauf abschliessen, Übersicht (inkl. Rollen-Sicht) und Mandantentrennung.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createVehicle, getVehicleEconomics, sellVehicle } from '../src/services/vehicles.js'
import { addCost, listCosts, deleteCost } from '../src/services/vehicle-costs.js'
import { getDashboard } from '../src/services/dashboard.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Fahrzeugkosten, Verkauf, Übersicht', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mkTenant = async (name) =>
    (
      await adminPool.query(
        `INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id`,
        [name, `${name}-${Math.random().toString(36).slice(2, 8)}`],
      )
    ).rows[0].id
  const tenantA = await mkTenant('kosten-a')
  const tenantB = await mkTenant('kosten-b')

  t.after(async () => {
    for (const id of [tenantA, tenantB]) {
      await adminPool.query('DELETE FROM vehicle_costs WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
  })

  const car = await createVehicle(tenantA, {
    make: 'VW',
    model: 'Golf',
    vin: 'WVWZZZ1KZAW000001',
    purchasePriceRappen: 1_000_000,
    askingPriceRappen: 1_400_000,
    inspectionValidUntil: '2020-01-01',
  })

  await t.test('DATE-Spalten kommen als YYYY-MM-DD, nicht als zeitzonenverschobenes Date', async () => {
    const dated = await createVehicle(tenantA, { make: 'Audi', firstRegistrationDate: '2024-03-01', purchasedAt: '2026-10-02' })
    assert.equal(dated.firstRegistrationDate, '2024-03-01')
    assert.equal(dated.purchasedAt, '2026-10-02')
    assert.equal(JSON.parse(JSON.stringify(dated)).purchasedAt, '2026-10-02')
    await adminPool.query('DELETE FROM vehicles WHERE id = $1', [dated.id])
  })

  await t.test('Kosten erfassen fliessen in Gewinn und Marge ein', async () => {
    await addCost(tenantA, car.id, { kind: 'part', description: 'Bremsbeläge', amountRappen: 30_000 })
    await addCost(tenantA, car.id, { kind: 'labor', description: 'Montage', amountRappen: 20_000 })
    await addCost(tenantA, car.id, { kind: 'detail', description: 'Aufbereitung', amountRappen: 10_000 })
    const e = await getVehicleEconomics(tenantA, car.id)
    assert.equal(e.partsRappen, 30_000)
    assert.equal(e.laborRappen, 20_000)
    assert.equal(e.otherRappen, 10_000)
    assert.equal(e.totalInvestedRappen, 1_060_000)
    assert.equal(e.profitRappen, 340_000)
  })

  await t.test('ungültige Kosten werden abgelehnt', async () => {
    await assert.rejects(addCost(tenantA, car.id, { kind: 'bogus', description: 'x', amountRappen: 1 }), /Kostenart/)
    await assert.rejects(addCost(tenantA, car.id, { kind: 'part', description: ' ', amountRappen: 1 }), /Beschreibung/)
    await assert.rejects(addCost(tenantA, car.id, { kind: 'part', description: 'x', amountRappen: -5 }), /Rappen/)
    await assert.rejects(addCost(tenantA, car.id, { kind: 'part', description: 'x', amountRappen: 1.5 }), /Rappen/)
  })

  await t.test('Mandant B sieht und ändert nichts an den Kosten von A', async () => {
    assert.deepEqual(await listCosts(tenantB, car.id), [])
    assert.equal(await addCost(tenantB, car.id, { kind: 'part', description: 'fremd', amountRappen: 1 }), null)
    const [first] = await listCosts(tenantA, car.id)
    assert.equal(await deleteCost(tenantB, car.id, first.id), false)
    assert.equal((await listCosts(tenantA, car.id)).length, 3)
  })

  await t.test('Übersicht: Inhaber sieht Summen, Verkauf nicht; MFK abgelaufen', async () => {
    const owner = await getDashboard(tenantA, 'inhaber', new Date(2026, 9, 3))
    assert.equal(owner.counts.onLot, 1)
    assert.equal(owner.money.investedRappen, 1_060_000)
    assert.equal(owner.money.projectedProfitRappen, 340_000)
    assert.equal(owner.inspection.expired.length, 1)

    const sales = await getDashboard(tenantA, 'verkauf', new Date(2026, 9, 3))
    assert.equal(sales.money, null)
    assert.equal(sales.canSeeTotals, false)
    assert.equal(sales.counts.onLot, 1)
  })

  await t.test('Verkauf abschliessen: Status, Preis, Datum; kein zweiter Verkauf', async () => {
    await assert.rejects(sellVehicle(tenantA, car.id, { soldPriceRappen: 0 }), /grösser als 0/)
    const sold = await sellVehicle(tenantA, car.id, { soldPriceRappen: 1_350_000, soldAt: '2026-10-02' })
    assert.equal(sold.status, 'sold')
    assert.equal(Number(sold.soldPriceRappen), 1_350_000)
    const e = await getVehicleEconomics(tenantA, car.id)
    assert.equal(e.realized, true)
    assert.equal(e.profitRappen, 290_000)
    await assert.rejects(sellVehicle(tenantA, car.id, { soldPriceRappen: 1_000_000 }), /bereits verkauft/)
    assert.equal(await sellVehicle(tenantB, car.id, { soldPriceRappen: 1_000_000 }), null)
  })
})
