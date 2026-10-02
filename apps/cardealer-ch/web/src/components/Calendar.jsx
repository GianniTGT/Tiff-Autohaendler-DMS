import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Panel, Tag, Notice, todayIso, formatDay } from './ui.jsx'

const APPOINTMENT_KINDS = ['appointment', 'viewing', 'test_drive', 'delivery', 'other']
const EMPTY_FORM = { title: '', kind: 'appointment', onDate: '', atTime: '', vehicleId: '', note: '' }
const MAX_CHIPS = 3

// Tage sind 'JJJJ-MM-TT'-Text; gerechnet wird über Date.UTC, nie über new Date('JJJJ-MM-TT') in lokaler Zeit.
const utc = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const toDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const addDays = (day, n) => toDay(utc(day) + n * 86_400_000)
const mondayIndex = (day) => (new Date(utc(day)).getUTCDay() + 6) % 7

/** Sechs Wochen ab dem Montag vor dem Monatsersten — immer gleich hoch, damit das Raster nicht springt. */
export function monthGrid(year, month) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const start = addDays(first, -mondayIndex(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

const KIND_STYLE = {
  invoice_due: 'bg-warn-bg text-warn',
  delivery: 'bg-brand-wash text-brand',
  inspection: 'bg-warn-bg text-warn',
  job_due: 'bg-tint text-steel',
  viewing: 'bg-brand-wash text-brand',
  test_drive: 'bg-brand-wash text-brand',
  appointment: 'bg-brand-wash text-brand',
  other: 'bg-tint text-steel',
  sold: 'bg-profit-bg text-profit',
  acquired: 'bg-tint text-steel',
}

const chipClass = (e) => (e.overdue ? 'bg-danger-bg text-danger' : e.done ? 'bg-tint text-mist line-through' : (KIND_STYLE[e.kind] ?? 'bg-tint text-steel'))

export default function Calendar({ onOpenVehicle, onOpenInvoice }) {
  const today = todayIso()
  const [cursor, setCursor] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
  const [events, setEvents] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [selected, setSelected] = useState(today)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM, onDate: today })
  const [busy, setBusy] = useState(false)

  const grid = monthGrid(cursor.year, cursor.month)

  async function load() {
    try {
      const [ev, veh] = await Promise.all([api.get(`/api/calendar?from=${grid[0]}&to=${grid[41]}`), api.get('/api/vehicles')])
      setEvents(ev)
      setVehicles(veh)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [cursor.year, cursor.month])

  const move = (delta) => {
    const d = new Date(Date.UTC(cursor.year, cursor.month + delta, 1))
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() })
  }

  const goToday = () => {
    setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
    setSelected(today)
  }

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addAppointment = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/appointments', {
        title: form.title,
        kind: form.kind,
        onDate: form.onDate,
        atTime: form.atTime || null,
        vehicleId: form.vehicleId || null,
        note: form.note || null,
      })
      setSelected(form.onDate)
      setForm({ ...EMPTY_FORM, onDate: form.onDate })
      setShowForm(false)
    })
  }

  const open = (e) => {
    if (e.invoiceId) onOpenInvoice?.(e.invoiceId)
    else if (e.vehicleId) onOpenVehicle?.(e.vehicleId)
  }

  const byDay = new Map()
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  const dayEvents = byDay.get(selected) ?? []

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('calendar.title')}>
        <button className="btn-ghost" onClick={goToday}>
          {t('calendar.today')}
        </button>
        <button
          className="btn"
          onClick={() => {
            setForm({ ...form, onDate: selected })
            setShowForm((v) => !v)
          }}
        >
          {t('calendar.add')}
        </button>
      </PageHeader>

      {error && <Notice>{error}</Notice>}

      {showForm && (
        <form onSubmit={addAppointment} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input required className="field lg:col-span-2" placeholder={t('calendar.form.title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="field" aria-label={t('calendar.form.kind')} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {APPOINTMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`calendar.kinds.${k}`)}
              </option>
            ))}
          </select>
          <select className="field" aria-label={t('calendar.form.vehicle')} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
            <option value="">{t('calendar.form.none')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')}
              </option>
            ))}
          </select>
          <input required type="date" className="field" aria-label={t('calendar.form.date')} value={form.onDate} onChange={(e) => setForm({ ...form, onDate: e.target.value })} />
          <input type="time" className="field" aria-label={t('calendar.form.time')} value={form.atTime} onChange={(e) => setForm({ ...form, atTime: e.target.value })} />
          <input className="field lg:col-span-2" placeholder={t('calendar.form.note')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button type="submit" disabled={busy} className="btn sm:col-span-2 lg:col-span-4">
            {t('calendar.form.save')}
          </button>
        </form>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <button className="btn-ghost px-3" aria-label="←" onClick={() => move(-1)}>
              ←
            </button>
            <h3 className="font-display text-xl font-bold uppercase tracking-wide text-brand-deep">
              {t(`calendar.months.${cursor.month}`)} {cursor.year}
            </h3>
            <button className="btn-ghost px-3" aria-label="→" onClick={() => move(1)}>
              →
            </button>
          </div>
          <div className="grid grid-cols-7 border-b border-line bg-tint text-center text-xs font-semibold uppercase tracking-wider text-steel">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="py-1.5">
                {t(`calendar.weekdays.${i}`)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((day) => {
              const list = byDay.get(day) ?? []
              const inMonth = Number(day.slice(5, 7)) - 1 === cursor.month
              const isSelected = day === selected
              return (
                <button
                  key={day}
                  onClick={() => setSelected(day)}
                  className={`min-h-[84px] min-w-0 border-b border-r border-line p-1 text-left align-top transition-colors hover:bg-tint ${
                    inMonth ? 'bg-white' : 'bg-tint-faint text-mist'
                  } ${isSelected ? 'ring-2 ring-inset ring-brand' : ''}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      day === today ? 'bg-brand text-white' : ''
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {list.slice(0, MAX_CHIPS).map((e) => (
                      <div key={e.id} className={`truncate rounded px-1 text-[11px] font-medium ${chipClass(e)}`}>
                        {e.time ? `${e.time} ` : ''}
                        {e.title}
                      </div>
                    ))}
                    {list.length > MAX_CHIPS && <div className="px-1 text-[11px] text-steel">{t('calendar.more', { n: list.length - MAX_CHIPS })}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <Panel title={formatDay(selected)}>
          {dayEvents.length === 0 ? (
            <p className="text-sm text-steel">{t('calendar.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {dayEvents.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={e.overdue ? 'red' : e.done ? 'gray' : 'brand'}>{t(`calendar.kinds.${e.kind}`)}</Tag>
                    {e.overdue && <span className="text-xs font-semibold text-danger">{t('calendar.overdue')}</span>}
                    {e.time && <span className="num text-xs text-steel">{e.time}</span>}
                  </div>
                  <button
                    className={`mt-1 block text-left text-sm font-semibold ${e.done ? 'text-mist line-through' : 'text-ink'} ${e.invoiceId || e.vehicleId ? 'hover:underline' : 'cursor-default'}`}
                    onClick={() => open(e)}
                  >
                    {e.title}
                  </button>
                  {e.subtitle && <p className="text-xs text-steel">{e.subtitle}</p>}
                  {e.note && <p className="text-xs text-steel">{e.note}</p>}
                  {e.appointmentId && (
                    <div className="mt-1 flex gap-3 text-xs">
                      <button className="text-brand underline" disabled={busy} onClick={() => run(() => api.patch(`/api/appointments/${e.appointmentId}`, { done: !e.done }))}>
                        {e.done ? t('calendar.markOpen') : t('calendar.markDone')}
                      </button>
                      <button className="text-danger underline" disabled={busy} onClick={() => run(() => api.del(`/api/appointments/${e.appointmentId}`))}>
                        {t('calendar.delete')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
