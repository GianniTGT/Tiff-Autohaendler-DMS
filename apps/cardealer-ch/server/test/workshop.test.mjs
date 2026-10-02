import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summariseJobs, canTransition, buildBoard, daysBetween } from '../src/services/recon-calc.js'
import { buildEvents, eventsBetween } from '../src/services/calendar-calc.js'

const today = '2026-10-03'
const job = (over) => ({ id: 'j', status: 'open', estimateRappen: null, actualRappen: null, createdAt: '2026-10-01T10:00:00Z', dueDate: null, ...over })

test('fehlende Schätzung ist nicht 0 — sie wird gezählt, nicht gratis gerechnet', () => {
  const s = summariseJobs([job({ estimateRappen: 50_000 }), job({}), job({ status: 'doing', estimateRappen: 0 })])
  assert.equal(s.outstanding, 3)
  assert.equal(s.estimateOutstandingRappen, 50_000)
  assert.equal(s.estimateUnknown, 1, 'nur die ungeschätzte; eine geschätzte 0 ist eine Schätzung')
})

test('erledigte zählen als ausgegeben, verworfene weder offen noch ausgegeben', () => {
  const s = summariseJobs([job({ status: 'done', actualRappen: 12_000 }), job({ status: 'dropped', estimateRappen: 99_000 }), job({})])
  assert.equal(s.spentRappen, 12_000)
  assert.equal(s.outstanding, 1)
  assert.equal(s.done, 1)
})

test('Statuswechsel: done ist endgültig, dropped kann wieder auf', () => {
  assert.equal(canTransition('open', 'doing'), true)
  assert.equal(canTransition('doing', 'done'), true)
  assert.equal(canTransition('done', 'open'), false)
  assert.equal(canTransition('done', 'done'), true)
  assert.equal(canTransition('dropped', 'open'), true)
  assert.equal(canTransition('dropped', 'done'), false)
})

test('Board: Blockierendes vor Erledigtem, überfällig vor lang wartend; Fahrzeuge ohne Auftrag fehlen', () => {
  const vehicles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const jobs = {
    a: [job({ status: 'done', actualRappen: 1 })],
    b: [job({ createdAt: '2026-09-01T00:00:00Z' })],
    c: [job({ createdAt: '2026-10-02T00:00:00Z', dueDate: '2026-10-01' })],
  }
  const board = buildBoard(vehicles, jobs, today)
  assert.deepEqual(board.map((r) => r.vehicle.id), ['c', 'b', 'a'])
  assert.equal(board[0].overdue, true)
  assert.equal(board[1].waitingDays, 32)
  assert.equal(board[2].waitingDays, null)
})

test('daysBetween ist zeitzonenfrei', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-03'), 2)
})

const source = {
  vehicles: [
    { id: 'v1', make: 'VW', model: 'Golf', status: 'in_stock', inspectionValidUntil: '2026-09-30', purchasedAt: '2026-07-01' },
    { id: 'v2', make: 'Audi', model: 'A3', status: 'sold', inspectionValidUntil: '2026-09-01', soldAt: '2026-10-02' },
  ],
  openInvoices: [{ id: 'i1', number: 'RE-2026-00001', dueDate: '2026-10-10', partyName: 'Hans Muster' }],
  openJobs: [{ id: 'j1', vehicleId: 'v1', description: 'Bremsen', dueDate: '2026-10-05' }],
  appointments: [
    { id: 'a1', title: 'Probefahrt', kind: 'test_drive', onDate: '2026-10-05', atTime: '09:30', vehicleId: 'v1', done: false },
    { id: 'a2', title: 'Alt', kind: 'viewing', onDate: '2026-10-01', atTime: null, done: true },
  ],
}

test('Kalender: MFK nur für Fahrzeuge im Bestand, nie für verkaufte', () => {
  const events = buildEvents(source, today)
  assert.deepEqual(events.filter((e) => e.kind === 'inspection').map((e) => e.vehicleId), ['v1'])
})

test('Kalender: überfällig nur bei Pflichten und nur wenn nicht erledigt', () => {
  const events = buildEvents(source, today)
  const byId = Object.fromEntries(events.map((e) => [e.id, e]))
  assert.equal(byId['inspection-v1'].overdue, true)
  assert.equal(byId['appointment-a2'].overdue, false, 'erledigter Termin ist nicht überfällig')
  assert.equal(byId['sold-v2'].overdue, false, 'ein Verkauf ist keine Pflicht')
  assert.equal(byId['invoice-i1'].overdue, false, 'noch nicht fällig')
})

test('Kalender: Sortierung nach Tag, dann Bedeutung, dann Uhrzeit; Bereichsfilter', () => {
  const events = buildEvents(source, today)
  const day5 = events.filter((e) => e.date === '2026-10-05').map((e) => e.kind)
  assert.deepEqual(day5, ['job_due', 'test_drive'])
  const range = eventsBetween(events, '2026-10-02', '2026-10-05')
  assert.ok(range.every((e) => e.date >= '2026-10-02' && e.date <= '2026-10-05'))
  assert.equal(range[0].date, '2026-10-02')
})

test('Kalender: kein Preis in irgendeinem Eintrag', () => {
  const withPrices = { ...source, vehicles: source.vehicles.map((v) => ({ ...v, askingPriceRappen: 123, purchasePriceRappen: 99 })) }
  const json = JSON.stringify(buildEvents(withPrices, today))
  assert.equal(/Rappen|price/i.test(json), false)
})
