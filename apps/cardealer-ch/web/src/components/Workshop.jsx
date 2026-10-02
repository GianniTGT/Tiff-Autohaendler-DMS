import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, Notice, formatDay, todayIso } from './ui.jsx'

const KINDS = ['part', 'labor', 'transport', 'fee', 'detail']
const STATUS_TONE = { open: 'amber', doing: 'brand', done: 'green', dropped: 'gray' }
const EMPTY_FORM = { vehicleId: '', kind: 'labor', description: '', estimate: '', dueDate: '' }

function JobRow({ job, onChange, busy }) {
  const [finishing, setFinishing] = useState(false)
  const [amount, setAmount] = useState(job.estimateRappen != null ? String(job.estimateRappen / 100) : '')

  const patch = (body) => onChange(job.id, body)

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={STATUS_TONE[job.status]}>{t(`workshop.status.${job.status}`)}</Tag>
            <span className="text-xs uppercase tracking-wider text-steel">{t(`vehicle.detail.cost.kinds.${job.kind}`)}</span>
          </div>
          <p className={`mt-1 text-sm ${job.status === 'dropped' ? 'text-mist line-through' : 'text-ink'}`}>{job.description}</p>
          <p className="text-xs text-steel">
            {job.status === 'done'
              ? `${t('workshop.summary.spent')}: ${job.actualRappen != null ? formatMoney(job.actualRappen) : t('common.none')} · ${formatDay(job.doneAt)}`
              : `${t('workshop.summary.estimate')}: ${job.estimateRappen != null ? formatMoney(job.estimateRappen) : t('common.none')}${job.dueDate ? ` · ${t('workshop.summary.dueOn')}: ${formatDay(job.dueDate)}` : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.status === 'open' && (
            <button className="btn-ghost" disabled={busy} onClick={() => patch({ status: 'doing' })}>
              {t('workshop.actions.start')}
            </button>
          )}
          {job.status === 'doing' && (
            <button className="btn-ghost" disabled={busy} onClick={() => patch({ status: 'open' })}>
              {t('workshop.actions.pause')}
            </button>
          )}
          {(job.status === 'open' || job.status === 'doing') && !finishing && (
            <button className="btn" disabled={busy} onClick={() => setFinishing(true)}>
              {t('workshop.actions.done')}
            </button>
          )}
          {(job.status === 'open' || job.status === 'doing') && (
            <button className="btn-ghost" disabled={busy} onClick={() => patch({ status: 'dropped' })}>
              {t('workshop.actions.drop')}
            </button>
          )}
          {job.status === 'dropped' && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={() => patch({ status: 'open' })}>
                {t('workshop.actions.reopen')}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => onChange(job.id, null)}>
                {t('workshop.actions.delete')}
              </button>
            </>
          )}
        </div>
      </div>

      {finishing && (
        <form
          className="mt-2 grid grid-cols-1 items-end gap-2 rounded-lg bg-tint p-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            patch({ status: 'done', actualRappen: amount === '' ? null : francsToRappen(amount), doneAt: todayIso() })
            setFinishing(false)
          }}
        >
          <label>
            <span className="field-label">{t('workshop.doneForm.amount')}</span>
            <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="text-xs text-steel">{t('workshop.doneForm.hint')}</span>
          </label>
          <button type="submit" className="btn" disabled={busy}>
            {t('workshop.doneForm.confirm')}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setFinishing(false)}>
            {t('workshop.doneForm.cancel')}
          </button>
        </form>
      )}
    </li>
  )
}

export default function Workshop({ onOpenVehicle }) {
  const [board, setBoard] = useState(null)
  const [vehicles, setVehicles] = useState([])
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [b, v] = await Promise.all([api.get('/api/recon/board'), api.get('/api/vehicles')])
      setBoard(b)
      setVehicles(v.filter((x) => x.status === 'in_stock' || x.status === 'reserved'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addJob = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post(`/api/vehicles/${form.vehicleId}/jobs`, {
        kind: form.kind,
        description: form.description,
        estimateRappen: form.estimate === '' ? null : francsToRappen(form.estimate),
        dueDate: form.dueDate || null,
      })
      setForm({ ...EMPTY_FORM, vehicleId: form.vehicleId })
      setShowForm(false)
    })
  }

  const changeJob = (id, body) => run(() => (body === null ? api.del(`/api/jobs/${id}`) : api.patch(`/api/jobs/${id}`, body)))

  if (!board) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('workshop.title')}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('workshop.add')}
        </button>
      </PageHeader>

      {error && <Notice>{error}</Notice>}

      {showForm &&
        (vehicles.length === 0 ? (
          <Notice tone="amber">{t('workshop.form.noVehicles')}</Notice>
        ) : (
          <form onSubmit={addJob} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <select required className="field" aria-label={t('workshop.form.vehicle')} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
              <option value="">{t('workshop.form.vehicle')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')} {v.vin ? `(${v.vin})` : ''}
                </option>
              ))}
            </select>
            <select className="field" aria-label={t('workshop.form.kind')} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`vehicle.detail.cost.kinds.${k}`)}
                </option>
              ))}
            </select>
            <input required className="field sm:col-span-2" placeholder={t('workshop.form.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input className="field" inputMode="decimal" placeholder={t('workshop.form.estimate')} value={form.estimate} onChange={(e) => setForm({ ...form, estimate: e.target.value })} />
            <label className="block">
              <input className="field" type="date" aria-label={t('workshop.form.due')} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </label>
            <button type="submit" disabled={busy} className="btn sm:col-span-2">
              {t('workshop.form.save')}
            </button>
          </form>
        ))}

      {board.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('workshop.empty')}</div>
      ) : (
        board.map((row) => (
          <section key={row.vehicle.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <button className="font-display text-lg font-bold uppercase tracking-wide text-brand-deep hover:underline" onClick={() => onOpenVehicle(row.vehicle.id)}>
                  {[row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') || t('vehicle.unknown')}
                </button>
                <span className="ml-2 font-mono text-xs text-steel">{row.vehicle.vin}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {row.summary.outstanding > 0 && <Tag tone={row.overdue ? 'red' : 'amber'}>{t('workshop.summary.outstanding', { n: row.summary.outstanding })}</Tag>}
                {row.overdue && <Tag tone="red">{t('workshop.summary.overdue')}</Tag>}
                {row.summary.estimateUnknown > 0 && <Tag tone="gray">{t('workshop.summary.unknown', { n: row.summary.estimateUnknown })}</Tag>}
                {row.summary.outstanding > 0 && (
                  <span className="num text-steel">
                    {t('workshop.summary.estimate')}: {formatMoney(row.summary.estimateOutstandingRappen)}
                  </span>
                )}
                {row.waitingDays != null && (
                  <span className="text-steel">{row.waitingDays > 0 ? t('workshop.summary.waiting', { n: row.waitingDays }) : t('workshop.summary.waitingToday')}</span>
                )}
              </div>
            </div>
            <ul className="divide-y divide-line px-4">
              {row.jobs.map((job) => (
                <JobRow key={job.id} job={job} busy={busy} onChange={changeJob} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
