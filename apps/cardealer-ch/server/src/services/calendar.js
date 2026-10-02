/**
 * Kalender: Termine (manuell erfasst) und die Ereignisliste, die Termine mit
 * den abgeleiteten Fristen aus calendar-calc.js zusammenführt.
 */
import { withTenant } from '@tiff/core-db'
import { buildEvents, eventsBetween } from './calendar-calc.js'

export const APPOINTMENT_KINDS = Object.freeze(['appointment', 'viewing', 'test_drive', 'delivery', 'other'])

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function toAppointment(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    onDate: row.on_date,
    atTime: row.at_time,
    vehicleId: row.vehicle_id,
    partyId: row.party_id,
    note: row.note,
    done: row.done,
  }
}

function validate({ title, kind, onDate, atTime }, { partial }) {
  if (!partial || title !== undefined) {
    if (!title || !String(title).trim()) throw new Error('Ein Termin braucht einen Titel.')
  }
  if (kind !== undefined && !APPOINTMENT_KINDS.includes(kind)) throw new Error('Unbekannte Terminart.')
  if (!partial || onDate !== undefined) {
    if (!DAY.test(String(onDate ?? ''))) throw new Error('Das Datum muss im Format JJJJ-MM-TT angegeben werden.')
  }
  if (atTime !== undefined && atTime !== null && atTime !== '' && !TIME.test(atTime)) {
    throw new Error('Die Uhrzeit muss im Format HH:MM angegeben werden.')
  }
}

export async function createAppointment(tenantId, fields) {
  validate(fields, { partial: false })
  const { title, kind = 'appointment', onDate, atTime, vehicleId, partyId, note } = fields
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `INSERT INTO appointments (id, tenant_id, title, kind, on_date, at_time, vehicle_id, party_id, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, String(title).trim(), kind, onDate, atTime || null, vehicleId || null, partyId || null, note || null],
    )
    return toAppointment(result.rows[0])
  })
}

export async function updateAppointment(tenantId, id, fields) {
  validate(fields, { partial: true })
  return withTenant(tenantId, async (client) => {
    const existing = (await client.query('SELECT * FROM appointments WHERE id = $1', [id])).rows[0]
    if (!existing) return null
    const next = {
      title: fields.title !== undefined ? String(fields.title).trim() : existing.title,
      kind: fields.kind ?? existing.kind,
      on_date: fields.onDate ?? existing.on_date,
      at_time: fields.atTime === undefined ? existing.at_time : fields.atTime || null,
      note: fields.note === undefined ? existing.note : fields.note || null,
      done: fields.done === undefined ? existing.done : Boolean(fields.done),
    }
    const result = await client.query(
      'UPDATE appointments SET title=$1, kind=$2, on_date=$3, at_time=$4, note=$5, done=$6 WHERE id=$7 RETURNING *',
      [next.title, next.kind, next.on_date, next.at_time, next.note, next.done, id],
    )
    return toAppointment(result.rows[0])
  })
}

export async function deleteAppointment(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('DELETE FROM appointments WHERE id = $1', [id])
    return result.rowCount > 0
  })
}

/** Alle Ereignisse zwischen zwei Tagen (einschliesslich), Fristen und Termine gemischt. */
export async function getEvents(tenantId, { from, to, today }) {
  if (!DAY.test(String(from)) || !DAY.test(String(to))) throw new Error('from und to müssen JJJJ-MM-TT sein.')
  return withTenant(tenantId, async (client) => {
    const vehicles = (
      await client.query(
        'SELECT id, make, model, vin, status, inspection_valid_until, purchased_at, sold_at FROM vehicles',
      )
    ).rows.map((r) => ({
      id: r.id,
      make: r.make,
      model: r.model,
      vin: r.vin,
      status: r.status,
      inspectionValidUntil: r.inspection_valid_until,
      purchasedAt: r.purchased_at,
      soldAt: r.sold_at,
    }))

    // Unbezahlte Rechnungen: Total minus Zahlungen > 0. Kein Betrag geht in den Kalender.
    const openInvoices = (
      await client.query(
        `SELECT d.id, d.number, d.due_date,
                COALESCE(p.company_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS party_name
           FROM documents d
           LEFT JOIN parties p ON p.id = d.party_id
           LEFT JOIN (SELECT document_id, SUM(amount_rappen) AS paid FROM payments GROUP BY document_id) pay
                  ON pay.document_id = d.id
          WHERE d.type = 'invoice' AND d.status != 'paid' AND d.total_rappen - COALESCE(pay.paid, 0) > 0`,
      )
    ).rows.map((r) => ({ id: r.id, number: r.number, dueDate: r.due_date, partyName: r.party_name }))

    const openJobs = (
      await client.query("SELECT id, vehicle_id, description, due_date FROM recon_jobs WHERE status IN ('open', 'doing')")
    ).rows.map((r) => ({ id: r.id, vehicleId: r.vehicle_id, description: r.description, dueDate: r.due_date }))

    const appointments = (await client.query('SELECT * FROM appointments')).rows.map(toAppointment)

    const all = buildEvents({ vehicles, openInvoices, openJobs, appointments }, today)
    return eventsBetween(all, from, to)
  })
}
