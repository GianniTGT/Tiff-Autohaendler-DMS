/**
 * Werkstatt — reine Rechenlogik ohne Datenbank (Muster: lib/recon.js im
 * Manager-Repo).
 *
 * Eine fehlende Schätzung ist nicht 0: "Getriebe — wartet auf Offerte" ist
 * ein gültiger Auftrag. Jede Summe meldet deshalb, wie viele Aufträge sie
 * nicht berücksichtigen konnte, statt sie stillschweigend gratis zu
 * rechnen.
 */

export const JOB_STATUSES = Object.freeze(['open', 'doing', 'done', 'dropped'])
export const OPEN_STATUSES = Object.freeze(['open', 'doing'])
export const JOB_KINDS = Object.freeze(['part', 'labor', 'transport', 'fee', 'detail'])

export const isOpenJob = (job) => OPEN_STATUSES.includes(job?.status)

const stated = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Erlaubte Statuswechsel. `done` ist endgültig (es kann bereits eine
 * Kostenzeile daraus entstanden sein); `dropped` kann wieder geöffnet werden,
 * weil ein verworfener Auftrag eine Entscheidung war, keine Arbeit.
 */
const TRANSITIONS = {
  open: ['doing', 'done', 'dropped'],
  doing: ['open', 'done', 'dropped'],
  done: [],
  dropped: ['open'],
}

export function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] ?? []).includes(to)
}

/** Was die Auftragsliste eines Fahrzeugs ergibt. */
export function summariseJobs(jobs) {
  const open = jobs.filter(isOpenJob)
  const estimates = open.map((j) => stated(j.estimateRappen))
  const spent = jobs.filter((j) => j.status === 'done').reduce((s, j) => s + (stated(j.actualRappen) ?? 0), 0)
  return {
    total: jobs.length,
    outstanding: open.length,
    doing: jobs.filter((j) => j.status === 'doing').length,
    done: jobs.filter((j) => j.status === 'done').length,
    estimateOutstandingRappen: estimates.reduce((s, e) => s + (e ?? 0), 0),
    estimateUnknown: estimates.filter((e) => e === null).length,
    spentRappen: spent,
  }
}

export function daysBetween(fromDay, toDay) {
  const utc = (day) => {
    const [y, m, d] = String(day).slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(toDay) - utc(fromDay)) / 86_400_000)
}

/**
 * Das ganze Board, Dringendstes zuerst: was blockiert, dann was am längsten
 * wartet. Nach Tagen allein zu sortieren würde ein Auto begraben, das heute
 * kam und schon ein Getriebe braucht.
 *
 * @param {object[]} vehicles  { id, make, model, vin, ... }
 * @param {Record<string, object[]>} jobsByVehicle
 */
export function buildBoard(vehicles, jobsByVehicle, today) {
  return vehicles
    .map((vehicle) => {
      const jobs = jobsByVehicle[vehicle.id] ?? []
      const open = jobs.filter(isOpenJob)
      const oldest = open.map((j) => String(j.createdAt).slice(0, 10)).sort()[0]
      const dueDates = open.map((j) => j.dueDate).filter(Boolean).sort()
      return {
        vehicle,
        jobs,
        summary: summariseJobs(jobs),
        waitingDays: oldest ? daysBetween(oldest, today) : null,
        nextDue: dueDates[0] ?? null,
        overdue: dueDates.length > 0 && dueDates[0] < today,
      }
    })
    .filter((row) => row.jobs.length > 0)
    .sort(
      (a, b) =>
        (b.summary.outstanding > 0) - (a.summary.outstanding > 0) ||
        Number(b.overdue) - Number(a.overdue) ||
        (b.waitingDays ?? -1) - (a.waitingDays ?? -1) ||
        b.summary.outstanding - a.summary.outstanding,
    )
}
