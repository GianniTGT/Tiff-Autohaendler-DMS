/**
 * Werkstatt-Aufträge. Wird ein Auftrag erledigt und ein Betrag genannt,
 * entsteht in derselben Transaktion die Kostenzeile am Fahrzeug
 * (vehicle_costs) — so landet die Arbeit in Gewinn und Marge, ohne dass
 * jemand sie zweimal erfassen muss.
 */
import { withTenant } from '@tiff/core-db'
import { JOB_KINDS, JOB_STATUSES, canTransition, buildBoard } from './recon-calc.js'

function toJob(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    kind: row.kind,
    description: row.description,
    status: row.status,
    estimateRappen: row.estimate_rappen == null ? null : Number(row.estimate_rappen),
    actualRappen: row.actual_rappen == null ? null : Number(row.actual_rappen),
    dueDate: row.due_date,
    doneAt: row.done_at,
    costId: row.cost_id,
    createdAt: row.created_at,
  }
}

const isMoney = (v) => v == null || (Number.isInteger(v) && v >= 0)

export async function listJobs(tenantId, vehicleId) {
  return withTenant(tenantId, async (client) => {
    const result = vehicleId
      ? await client.query('SELECT * FROM recon_jobs WHERE vehicle_id = $1 ORDER BY created_at', [vehicleId])
      : await client.query('SELECT * FROM recon_jobs ORDER BY created_at')
    return result.rows.map(toJob)
  })
}

export async function createJob(tenantId, { vehicleId, kind, description, estimateRappen, dueDate }) {
  if (!JOB_KINDS.includes(kind)) throw new Error('Unbekannte Auftragsart.')
  if (!description || !String(description).trim()) throw new Error('Ein Auftrag braucht eine Beschreibung.')
  if (!isMoney(estimateRappen)) throw new Error('Die Schätzung muss eine ganze Zahl in Rappen sein.')
  return withTenant(tenantId, async (client) => {
    const vehicle = await client.query('SELECT 1 FROM vehicles WHERE id = $1', [vehicleId])
    if (vehicle.rows.length === 0) return null
    const result = await client.query(
      `INSERT INTO recon_jobs (id, tenant_id, vehicle_id, kind, description, estimate_rappen, due_date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, vehicleId, kind, String(description).trim(), estimateRappen ?? null, dueDate || null],
    )
    return toJob(result.rows[0])
  })
}

/**
 * @param {object} fields { status, description, estimateRappen, dueDate, actualRappen, doneAt }
 *   `actualRappen` gehört zum Wechsel auf 'done': > 0 erzeugt die Kostenzeile.
 */
export async function updateJob(tenantId, id, fields) {
  if (fields.status !== undefined && !JOB_STATUSES.includes(fields.status)) throw new Error('Unbekannter Status.')
  if (!isMoney(fields.estimateRappen) || !isMoney(fields.actualRappen)) {
    throw new Error('Beträge müssen ganze Zahlen in Rappen sein.')
  }
  if (fields.description !== undefined && !String(fields.description).trim()) {
    throw new Error('Ein Auftrag braucht eine Beschreibung.')
  }

  return withTenant(tenantId, async (client) => {
    const existing = (await client.query('SELECT * FROM recon_jobs WHERE id = $1 FOR UPDATE', [id])).rows[0]
    if (!existing) return null
    const nextStatus = fields.status ?? existing.status
    if (!canTransition(existing.status, nextStatus)) {
      throw new Error(
        existing.status === 'done'
          ? 'Ein erledigter Auftrag kann nicht mehr geändert werden.'
          : `Von «${existing.status}» ist kein Wechsel auf «${nextStatus}» möglich.`,
      )
    }
    if (existing.status === 'done') return toJob(existing)

    let costId = existing.cost_id
    let doneAt = existing.done_at
    let actual = existing.actual_rappen
    if (nextStatus === 'done') {
      doneAt = fields.doneAt ?? new Date().toISOString().slice(0, 10)
      actual = fields.actualRappen ?? existing.actual_rappen
      if (actual != null && Number(actual) > 0) {
        const cost = await client.query(
          `INSERT INTO vehicle_costs (id, tenant_id, vehicle_id, kind, description, amount_rappen, incurred_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, existing.vehicle_id, existing.kind, existing.description, actual, doneAt],
        )
        costId = cost.rows[0].id
      }
    }

    const result = await client.query(
      `UPDATE recon_jobs
          SET status = $1,
              description = COALESCE($2, description),
              estimate_rappen = CASE WHEN $3::boolean THEN $4 ELSE estimate_rappen END,
              due_date = CASE WHEN $5::boolean THEN $6::date ELSE due_date END,
              actual_rappen = $7, done_at = $8, cost_id = $9
        WHERE id = $10 RETURNING *`,
      [
        nextStatus,
        fields.description === undefined ? null : String(fields.description).trim(),
        'estimateRappen' in fields,
        fields.estimateRappen ?? null,
        'dueDate' in fields,
        fields.dueDate || null,
        actual ?? null,
        doneAt ?? null,
        costId ?? null,
        id,
      ],
    )
    return toJob(result.rows[0])
  })
}

export async function deleteJob(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const existing = (await client.query('SELECT status FROM recon_jobs WHERE id = $1', [id])).rows[0]
    if (!existing) return false
    if (existing.status === 'done') throw new Error('Ein erledigter Auftrag bleibt als Beleg stehen.')
    await client.query('DELETE FROM recon_jobs WHERE id = $1', [id])
    return true
  })
}

/** Das Werkstatt-Board: Fahrzeuge im Bestand mit mindestens einem Auftrag. */
export async function getBoard(tenantId, today) {
  return withTenant(tenantId, async (client) => {
    const vehicles = (
      await client.query(
        `SELECT id, make, model, vin FROM vehicles WHERE status IN ('in_stock', 'reserved')
            AND id IN (SELECT vehicle_id FROM recon_jobs)`,
      )
    ).rows
    const jobs = (await client.query('SELECT * FROM recon_jobs ORDER BY created_at')).rows.map(toJob)
    const byVehicle = {}
    for (const job of jobs) (byVehicle[job.vehicleId] ??= []).push(job)
    return buildBoard(vehicles, byVehicle, today)
  })
}

/** Offene Aufträge (open/doing) und wie viele davon überfällig sind — für die Übersicht. */
export async function countOpenJobs(tenantId, today) {
  return withTenant(tenantId, async (client) => {
    const row = (
      await client.query(
        `SELECT COUNT(*) AS open, COUNT(*) FILTER (WHERE due_date < $1::date) AS overdue
           FROM recon_jobs j JOIN vehicles v ON v.id = j.vehicle_id
          WHERE j.status IN ('open', 'doing') AND v.status IN ('in_stock', 'reserved')`,
        [today],
      )
    ).rows[0]
    return { open: Number(row.open), overdue: Number(row.overdue) }
  })
}
