/**
 * Integrationstest gegen echtes PostgreSQL — Werkstatt-Aufträge (inkl.
 * Kostenzeile beim Erledigen), Board, Termine, Kalender, Mandantentrennung.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createVehicle, getVehicleEconomics } from '../src/services/vehicles.js'
import { listCosts } from '../src/services/vehicle-costs.js'
import { createJob, updateJob, deleteJob, listJobs, getBoard } from '../src/services/recon.js'
import { createAppointment, updateAppointment, deleteAppointment, getEvents } from '../src/services/calendar.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Werkstatt und Kalender', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mkTenant = async (name) =>
    (
      await adminPool.query(
        'INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id',
        [name, `${name}-${Math.random().toString(36).slice(2, 8)}`],
      )
    ).rows[0].id
  const A = await mkTenant('werk-a')
  const B = await mkTenant('werk-b')

  t.after(async () => {
    for (const id of [A, B]) {
      await adminPool.query('DELETE FROM appointments WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM recon_jobs WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM vehicle_costs WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
  })

  const car = await createVehicle(A, {
    make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000003',
    purchasePriceRappen: 1_000_000, askingPriceRappen: 1_300_000, inspectionValidUntil: '2026-10-20',
  })

  await t.test('Auftrag erfassen: Pflichtangaben und Beträge werden geprüft', async () => {
    await assert.rejects(createJob(A, { vehicleId: car.id, kind: 'x', description: 'a' }), /Auftragsart/)
    await assert.rejects(createJob(A, { vehicleId: car.id, kind: 'part', description: '  ' }), /Beschreibung/)
    await assert.rejects(createJob(A, { vehicleId: car.id, kind: 'part', description: 'a', estimateRappen: -1 }), /Rappen/)
    assert.equal(await createJob(A, { vehicleId: '00000000-0000-0000-0000-000000000000', kind: 'part', description: 'a' }), null)
  })

  const brakes = await createJob(A, { vehicleId: car.id, kind: 'part', description: 'Bremsbeläge', estimateRappen: 40_000, dueDate: '2026-10-05' })
  const gearbox = await createJob(A, { vehicleId: car.id, kind: 'labor', description: 'Getriebe — wartet auf Offerte' })

  await t.test('Board: ein Fahrzeug, zwei offene Aufträge, eine Schätzung fehlt', async () => {
    const board = await getBoard(A, '2026-10-03')
    assert.equal(board.length, 1)
    assert.equal(board[0].summary.outstanding, 2)
    assert.equal(board[0].summary.estimateOutstandingRappen, 40_000)
    assert.equal(board[0].summary.estimateUnknown, 1)
    assert.equal(board[0].nextDue, '2026-10-05')
  })

  await t.test('Mandant B sieht und ändert nichts', async () => {
    assert.deepEqual(await listJobs(B, car.id), [])
    assert.deepEqual(await getBoard(B, '2026-10-03'), [])
    assert.equal(await updateJob(B, brakes.id, { status: 'doing' }), null)
    assert.equal(await deleteJob(B, brakes.id), false)
  })

  await t.test('Erledigen mit Betrag erzeugt die Kostenzeile und fliesst in den Gewinn', async () => {
    assert.equal((await updateJob(A, brakes.id, { status: 'doing' })).status, 'doing')
    const done = await updateJob(A, brakes.id, { status: 'done', actualRappen: 45_000, doneAt: '2026-10-04' })
    assert.equal(done.status, 'done')
    assert.ok(done.costId)
    const costs = await listCosts(A, car.id)
    assert.equal(costs.length, 1)
    assert.equal(costs[0].amountRappen, 45_000)
    assert.equal(costs[0].kind, 'part')
    assert.equal((await getVehicleEconomics(A, car.id)).partsRappen, 45_000)
  })

  await t.test('Erledigter Auftrag ist endgültig; Erledigen ohne Betrag erzeugt keine Kosten', async () => {
    await assert.rejects(updateJob(A, brakes.id, { status: 'open' }), /erledigt/)
    await assert.rejects(deleteJob(A, brakes.id), /Beleg/)
    const again = await updateJob(A, brakes.id, { description: 'anders' })
    assert.equal(again.description, 'Bremsbeläge', 'ein erledigter Auftrag bleibt unverändert')

    const free = await updateJob(A, gearbox.id, { status: 'done' })
    assert.equal(free.costId, null)
    assert.equal((await listCosts(A, car.id)).length, 1)
  })

  await t.test('Verworfen und wieder geöffnet; Löschen eines offenen Auftrags', async () => {
    const j = await createJob(A, { vehicleId: car.id, kind: 'fee', description: 'Gebühr' })
    assert.equal((await updateJob(A, j.id, { status: 'dropped' })).status, 'dropped')
    await assert.rejects(updateJob(A, j.id, { status: 'done' }), /kein Wechsel/)
    assert.equal((await updateJob(A, j.id, { status: 'open' })).status, 'open')
    assert.equal(await deleteJob(A, j.id), true)
  })

  await t.test('Termine: prüfen, anlegen, ändern, löschen', async () => {
    await assert.rejects(createAppointment(A, { title: '', onDate: '2026-10-06' }), /Titel/)
    await assert.rejects(createAppointment(A, { title: 'x', onDate: '6.10.2026' }), /Datum/)
    await assert.rejects(createAppointment(A, { title: 'x', onDate: '2026-10-06', atTime: '25:00' }), /Uhrzeit/)
    await assert.rejects(createAppointment(A, { title: 'x', onDate: '2026-10-06', kind: 'foo' }), /Terminart/)

    const a = await createAppointment(A, { title: 'Probefahrt Golf', kind: 'test_drive', onDate: '2026-10-06', atTime: '14:30', vehicleId: car.id })
    assert.equal(a.atTime, '14:30')
    assert.equal(a.onDate, '2026-10-06')
    const moved = await updateAppointment(A, a.id, { onDate: '2026-10-07', done: true })
    assert.equal(moved.onDate, '2026-10-07')
    assert.equal(moved.done, true)
    assert.equal(moved.title, 'Probefahrt Golf')
    assert.equal(await updateAppointment(B, a.id, { done: false }), null)
    assert.equal(await deleteAppointment(B, a.id), false)
    assert.equal(await deleteAppointment(A, a.id), true)
  })

  await t.test('Kalender mischt Fristen und Termine, ohne Betrag; Mandant B sieht nichts', async () => {
    await createJob(A, { vehicleId: car.id, kind: 'detail', description: 'Aufbereitung', dueDate: '2026-10-08' })
    await createAppointment(A, { title: 'Übergabe', kind: 'delivery', onDate: '2026-10-08', atTime: '10:00', vehicleId: car.id })
    const events = await getEvents(A, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-03' })
    const kinds = events.map((e) => `${e.date}:${e.kind}`)
    assert.ok(kinds.includes('2026-10-20:inspection'))
    assert.ok(kinds.includes('2026-10-08:job_due'))
    assert.ok(kinds.includes('2026-10-08:delivery'))
    assert.ok(kinds.indexOf('2026-10-08:delivery') < kinds.indexOf('2026-10-08:job_due'), 'Übergabe vor Auftragsfrist')
    assert.equal(/Rappen|price/i.test(JSON.stringify(events)), false)
    assert.deepEqual(await getEvents(B, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-03' }), [])
    await assert.rejects(getEvents(A, { from: 'x', to: 'y', today: '2026-10-03' }), /JJJJ/)
  })
})
