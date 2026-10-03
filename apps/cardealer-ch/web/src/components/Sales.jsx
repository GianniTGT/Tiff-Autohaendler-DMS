import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'
import SalesDetail from './SalesDetail.jsx'
import { PageHeader, Tag, Notice, formatDay, salesState, STATE_TONE } from './ui.jsx'

const FILTERS = ['all', 'offer', 'order', 'delivery_note']
const EMPTY_LINE = { description: '', quantity: '1', price: '' }
const emptyForm = (type) => ({ type, partyId: '', vehicleId: '', validUntil: '', note: '', lines: [{ ...EMPTY_LINE }] })

export default function Sales({ onOpenInvoice }) {
  const [docs, setDocs] = useState(null)
  const [parties, setParties] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)

  async function reload() {
    try {
      const [d, p, v] = await Promise.all([api.get('/api/sales-documents'), api.get('/api/parties'), api.get('/api/vehicles')])
      setDocs(d)
      setParties(p)
      setVehicles(v)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  function pickVehicle(vehicleId) {
    const v = vehicles.find((x) => x.id === vehicleId)
    const next = { ...form, vehicleId }
    // Erste Zeile aus dem Fahrzeug vorbelegen, solange sie noch leer ist.
    if (v && !form.lines[0].description && !form.lines[0].price) {
      next.lines = [
        { description: [[v.make, v.model].filter(Boolean).join(' '), v.vin].filter(Boolean).join(', '), quantity: '1', price: v.askingPriceRappen != null ? String(v.askingPriceRappen / 100) : '' },
        ...form.lines.slice(1),
      ]
    }
    setForm(next)
  }

  const setLine = (i, patch) => setForm({ ...form, lines: form.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) })

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api.post(form.type === 'offer' ? '/api/offers' : '/api/orders', {
        partyId: form.partyId,
        vehicleId: form.vehicleId || undefined,
        validUntil: form.type === 'offer' && form.validUntil ? form.validUntil : undefined,
        note: form.note || undefined,
        lines: form.lines.map((l) => ({ description: l.description, quantity: Number(String(l.quantity).replace(',', '.')), unitPriceRappen: francsToRappen(l.price) ?? 0 })),
      })
      setNotice(created.archive?.archived ? { tone: 'green', text: t('sales.created', { number: created.number }) } : { tone: 'amber', text: t('sales.notArchived', { number: created.number, reason: created.archive?.reason ?? '' }) })
      setForm(null)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!docs) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  const visible = filter === 'all' ? docs : docs.filter((d) => d.type === filter)
  const netTotal = form ? form.lines.reduce((s, l) => s + (Number(String(l.quantity).replace(',', '.')) || 0) * (Number(String(l.price).replace(/['’\s]/g, '').replace(',', '.')) || 0), 0) : 0

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('sales.title')}>
        <button className="btn-ghost" onClick={() => setForm(emptyForm('order'))}>
          {t('sales.addOrder')}
        </button>
        <button className="btn" onClick={() => setForm(emptyForm('offer'))}>
          {t('sales.addOffer')}
        </button>
      </PageHeader>
      <p className="max-w-3xl text-sm text-steel">{t('sales.intro')}</p>

      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {form &&
        (parties.length === 0 ? (
          <Notice tone="amber">{t('documents.invoices.needsCustomer')}</Notice>
        ) : (
          <form onSubmit={submit} className="card space-y-3 p-4">
            <h3 className="panel-title">{t(form.type === 'offer' ? 'sales.newOffer' : 'sales.newOrder')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select required className="field" aria-label={t('documents.invoices.customer')} value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
                <option value="">{t('documents.invoices.chooseCustomer')}</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {partyName(p)}
                  </option>
                ))}
              </select>
              <select className="field" aria-label={t('documents.invoices.chooseVehicle')} value={form.vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
                <option value="">{t('documents.invoices.chooseVehicle')}</option>
                {vehicles
                  .filter((v) => v.status === 'in_stock' || v.status === 'reserved')
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')} {v.vin ? `(${v.vin})` : ''}
                    </option>
                  ))}
              </select>
              {form.type === 'offer' && (
                <label className="block">
                  <input type="date" className="field" aria-label={t('sales.validUntil')} title={t('sales.validUntilHint')} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                </label>
              )}
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_5rem_8rem_auto] gap-2 text-xs font-semibold uppercase tracking-wider text-steel">
                <span>{t('documents.invoices.description')}</span>
                <span>{t('sales.quantity')}</span>
                <span>{t('sales.unitPrice')}</span>
                <span />
              </div>
              {form.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_8rem_auto] gap-2">
                  <input required className="field" value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  <input required className="field" inputMode="decimal" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <input required className="field" inputMode="decimal" value={line.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                  <button type="button" className="btn-ghost px-3" disabled={form.lines.length === 1} aria-label={t('sales.removeLine')} onClick={() => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="btn-ghost" onClick={() => setForm({ ...form, lines: [...form.lines, { ...EMPTY_LINE }] })}>
                  {t('sales.addLine')}
                </button>
                <span className="text-sm text-steel">
                  {t('sales.netTotal')}: <b className="num text-ink">{formatMoney(Math.round(netTotal * 100))}</b> <span className="text-xs">({t('sales.vatAdded')})</span>
                </span>
              </div>
            </div>

            <input className="field" placeholder={t('sales.note')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn">
                {t('sales.issue')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ))}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === f ? 'bg-brand text-white' : 'border border-line-strong bg-white text-steel hover:text-brand'}`}>
            {t(`sales.filter.${f}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('sales.empty')}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rows w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">{t('documents.invoices.number')}</th>
                <th className="p-3">{t('archive.cols.type')}</th>
                <th className="p-3">{t('documents.invoices.issueDate')}</th>
                <th className="p-3">{t('documents.invoices.customer')}</th>
                <th className="p-3">{t('vehicle.status')}</th>
                <th className="p-3 text-right">{t('documents.invoices.total')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => setOpenId(d.id)}>
                  <td className="p-3 font-semibold text-ink">{d.number}</td>
                  <td className="p-3">
                    {t(`sales.types.${d.type}`)}
                    {d.vehicleLabel && <div className="text-xs text-steel">{d.vehicleLabel}</div>}
                  </td>
                  <td className="p-3">
                    {formatDay(d.issueDate)}
                    {d.type === 'offer' && d.validUntil && <div className="text-xs text-steel">{t('sales.validUntilShort', { date: formatDay(d.validUntil) })}</div>}
                  </td>
                  <td className="p-3">{d.partyName ?? t('common.none')}</td>
                  <td className="p-3">
                    <Tag tone={STATE_TONE[salesState(d)]}>{t(`sales.status.${d.type}.${salesState(d)}`)}</Tag>
                    {d.invoiceNumber && <div className="mt-1 text-xs text-steel">→ {d.invoiceNumber}</div>}
                  </td>
                  <td className="num p-3 text-right">{d.type === 'delivery_note' ? t('common.none') : formatMoney(d.totalRappen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && (
        <SalesDetail
          docId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onOpenDoc={setOpenId}
          onOpenInvoice={(id) => {
            setOpenId(null)
            onOpenInvoice?.(id)
          }}
        />
      )}
    </div>
  )
}
