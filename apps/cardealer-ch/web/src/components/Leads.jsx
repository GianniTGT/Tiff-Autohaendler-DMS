import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, Notice, formatDay } from './ui.jsx'

const STATUSES = ['new', 'contacted', 'test_drive', 'won', 'lost']
const TYPES = ['inquiry', 'test_drive', 'trade_in', 'financing', 'other']
const STATUS_TONE = { new: 'amber', contacted: 'brand', test_drive: 'brand', won: 'green', lost: 'gray' }
const EMPTY_FORM = { name: '', email: '', phone: '', type: 'inquiry', vehicleId: '', message: '' }

function LeadCard({ lead, vehicles, busy, onPatch, onConvert, onDelete }) {
  const [notes, setNotes] = useState(lead.notes ?? '')

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-bold uppercase tracking-wide text-brand-deep">{lead.name}</span>
            <Tag tone={STATUS_TONE[lead.status]}>{t(`leads.status.${lead.status}`)}</Tag>
            <Tag tone="gray">{t(`leads.types.${lead.type}`)}</Tag>
            {lead.partyId && <Tag tone="green">{t('leads.isCustomer')}</Tag>}
          </div>
          <p className="mt-0.5 text-sm text-steel">
            {[lead.email, lead.phone].filter(Boolean).join(' · ')} · {formatDay(lead.createdAt)} · {t(`leads.sources.${lead.source}`)}
          </p>
          {lead.message && <p className="mt-2 whitespace-pre-line text-sm text-ink">{lead.message}</p>}
        </div>
        <select className="field w-auto" aria-label={t('vehicle.status')} value={lead.status} disabled={busy} onChange={(e) => onPatch(lead.id, { status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`leads.status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="block">
          <span className="field-label">{t('leads.fields.vehicle')}</span>
          <select className="field" value={lead.vehicleId ?? ''} disabled={busy} onChange={(e) => onPatch(lead.id, { vehicleId: e.target.value })}>
            <option value="">{t('leads.fields.noVehicle')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t('leads.fields.notes')}</span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (lead.notes ?? '') && onPatch(lead.id, { notes })} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {lead.email && (
          <a className="btn-ghost" href={`mailto:${lead.email}`}>
            {t('leads.fields.email')}
          </a>
        )}
        {lead.phone && (
          <a className="btn-ghost" href={`tel:${lead.phone.replace(/\s+/g, '')}`}>
            {t('leads.fields.phone')}
          </a>
        )}
        {!lead.partyId && (
          <button className="btn-ghost" disabled={busy} onClick={() => onConvert(lead.id)}>
            {t('leads.convert')}
          </button>
        )}
        <button className="btn-ghost ml-auto text-danger" disabled={busy} onClick={() => onDelete(lead.id)}>
          {t('leads.delete')}
        </button>
      </div>
    </li>
  )
}

export default function Leads() {
  const [leads, setLeads] = useState(null)
  const [vehicles, setVehicles] = useState([])
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [l, v] = await Promise.all([api.get('/api/leads'), api.get('/api/vehicles')])
      setLeads(l)
      setVehicles(v)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function run(action, okMessage) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await action()
      await reload()
      if (okMessage) setMessage(okMessage(result))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const add = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post('/api/leads', { ...form, vehicleId: form.vehicleId || null })
      setForm(EMPTY_FORM)
      setShowForm(false)
    })
  }

  if (!leads) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  const visible = filter === 'all' ? leads : leads.filter((l) => l.status === filter)
  const counts = Object.fromEntries(STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length]))

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('leads.title')}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('leads.add')}
        </button>
      </PageHeader>

      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}

      {showForm && (
        <form onSubmit={add} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <input required className="field" placeholder={t('leads.fields.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="field" aria-label={t('leads.fields.type')} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`leads.types.${k}`)}
              </option>
            ))}
          </select>
          <input type="email" className="field" placeholder={t('leads.fields.email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="field" placeholder={t('leads.fields.phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="field sm:col-span-2" aria-label={t('leads.fields.vehicle')} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
            <option value="">{t('leads.fields.noVehicle')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')}
              </option>
            ))}
          </select>
          <textarea className="field sm:col-span-2" rows={2} placeholder={t('leads.fields.message')} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <button type="submit" disabled={busy} className="btn sm:col-span-2">
            {t('leads.save')}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {['all', ...STATUSES].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === f ? 'bg-brand text-white' : 'border border-line-strong bg-white text-steel hover:text-brand'}`}
          >
            {t(`leads.filter.${f}`)}
            {f !== 'all' && counts[f] > 0 ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-steel">{leads.length === 0 ? t('leads.empty') : t('leads.searchEmpty')}</div>
      ) : (
        <ul className="space-y-3">
          {visible.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              vehicles={vehicles}
              busy={busy}
              onPatch={(id, body) => run(() => api.patch(`/api/leads/${id}`, body))}
              onConvert={(id) => run(() => api.post(`/api/leads/${id}/convert`), (r) => (r.created ? t('leads.converted') : t('leads.linked')))}
              onDelete={(id) => run(() => api.del(`/api/leads/${id}`))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
