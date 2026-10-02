/**
 * Kalender — reine Logik (Muster: lib/calendar.js im Manager-Repo).
 *
 * Fristen werden aus den Quelldaten abgeleitet (MFK am Fahrzeug, Fälligkeit
 * an der Rechnung, Termin am Auftrag), nicht ein zweites Mal gespeichert.
 * `today` wird hineingereicht statt von der Uhr gelesen: ein Kalender, der
 * bei einem zweiten Blick anders aussieht, ist einer, dem niemand traut — und
 * "überfällig" wäre sonst nicht testbar.
 *
 * Ein Eintrag mit `commitment: true` ist etwas, das man schuldet (MFK,
 * Rechnung, Übergabe) — dort ist "vorbei und nicht erledigt" ein Problem,
 * bei einem Verkauf einfach ein Datum in der Vergangenheit.
 *
 * Kein Preis in keinem Eintrag, auch nicht der Angebotspreis: der Kalender
 * steht allen Rollen offen und braucht keinen Betrag, um ein Fahrzeug vom
 * anderen zu unterscheiden.
 */

/** Reihenfolge innerhalb eines Tages nach Bedeutung, nicht nach Uhrzeit. */
export const EVENT_KINDS = Object.freeze([
  { kind: 'invoice_due', commitment: true },
  { kind: 'delivery', commitment: true },
  { kind: 'inspection', commitment: true },
  { kind: 'job_due', commitment: true },
  { kind: 'viewing', commitment: true },
  { kind: 'test_drive', commitment: true },
  { kind: 'appointment', commitment: true },
  { kind: 'other', commitment: false },
  { kind: 'sold', commitment: false },
  { kind: 'acquired', commitment: false },
])

const ORDER = new Map(EVENT_KINDS.map((e, i) => [e.kind, i]))
const COMMITMENT = new Set(EVENT_KINDS.filter((e) => e.commitment).map((e) => e.kind))

const label = (v) => [v.make, v.model].filter(Boolean).join(' ') || v.vin || 'Fahrzeug'
const day = (value) => (value ? String(value).slice(0, 10) : null)

/**
 * @param {object} source
 * @param {object[]} source.vehicles       camelCase-Fahrzeuge (id, make, model, vin, status, inspectionValidUntil, purchasedAt, soldAt)
 * @param {object[]} source.openInvoices   { id, number, dueDate, partyName } — nur unbezahlte
 * @param {object[]} source.openJobs       { id, vehicleId, description, dueDate }
 * @param {object[]} source.appointments   { id, title, kind, onDate, atTime, vehicleId, note, done }
 * @param {string} today
 */
export function buildEvents({ vehicles, openInvoices, openJobs, appointments }, today) {
  const byId = new Map(vehicles.map((v) => [v.id, v]))
  const events = []
  const push = (e) => {
    if (!e.date) return
    events.push({
      commitment: COMMITMENT.has(e.kind),
      done: false,
      ...e,
      overdue: COMMITMENT.has(e.kind) && !e.done && e.date < today,
    })
  }

  for (const v of vehicles) {
    const onLot = v.status === 'in_stock' || v.status === 'reserved'
    if (onLot) push({ id: `inspection-${v.id}`, kind: 'inspection', date: day(v.inspectionValidUntil), title: label(v), vehicleId: v.id })
    push({ id: `acquired-${v.id}`, kind: 'acquired', date: day(v.purchasedAt), title: label(v), vehicleId: v.id })
    push({ id: `sold-${v.id}`, kind: 'sold', date: day(v.soldAt), title: label(v), vehicleId: v.id })
  }

  for (const i of openInvoices) {
    push({
      id: `invoice-${i.id}`,
      kind: 'invoice_due',
      date: day(i.dueDate),
      title: [i.number, i.partyName].filter(Boolean).join(' · '),
      invoiceId: i.id,
    })
  }

  for (const j of openJobs) {
    const v = byId.get(j.vehicleId)
    push({
      id: `job-${j.id}`,
      kind: 'job_due',
      date: day(j.dueDate),
      title: v ? `${label(v)} — ${j.description}` : j.description,
      vehicleId: j.vehicleId,
    })
  }

  for (const a of appointments) {
    const v = a.vehicleId ? byId.get(a.vehicleId) : null
    push({
      id: `appointment-${a.id}`,
      kind: a.kind,
      date: day(a.onDate),
      time: a.atTime ?? null,
      title: a.title,
      subtitle: v ? label(v) : null,
      note: a.note ?? null,
      done: a.done,
      appointmentId: a.id,
      vehicleId: a.vehicleId ?? undefined,
    })
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (ORDER.get(a.kind) ?? 99) - (ORDER.get(b.kind) ?? 99) ||
      String(a.time ?? '99:99').localeCompare(String(b.time ?? '99:99')),
  )
}

export function eventsBetween(events, from, to) {
  return events.filter((e) => e.date >= from && e.date <= to)
}
