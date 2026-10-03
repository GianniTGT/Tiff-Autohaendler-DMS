import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'
import { PageHeader, Tag, Notice, formatDay, todayIso, netPriceText } from './ui.jsx'

const EMPTY_FORM = { partyId: '', vehicleId: '', description: '', price: '' }
const FILTERS = ['all', 'open', 'overdue', 'paid', 'credited']

/** Anzeigestatus: 'overdue' gibt es nicht in der DB, sondern ergibt sich aus Fälligkeit und Restbetrag. */
export function invoiceState(invoice, today = todayIso()) {
  if (Number(invoice.credited_rappen) > 0 && Number(invoice.credited_rappen) >= Number(invoice.total_rappen)) return 'credited'
  if (invoice.status === 'paid' || invoice.outstanding_rappen <= 0) return 'paid'
  return String(invoice.due_date).slice(0, 10) < today ? 'overdue' : 'issued'
}
const STATE_TONE = { issued: 'amber', paid: 'green', overdue: 'red', credited: 'gray' }

export default function InvoiceList({ onOpenInvoice }) {
  const [invoices, setInvoices] = useState(null)
  const [parties, setParties] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [camtResult, setCamtResult] = useState(null)
  const [notice, setNotice] = useState(null)
  const [vatPercent, setVatPercent] = useState(null)
  const fileInput = useRef(null)

  async function reload() {
    try {
      const [inv, par, veh, rate] = await Promise.all([api.get('/api/invoices'), api.get('/api/parties'), api.get('/api/vehicles'), api.get('/api/vat-rate')])
      setVatPercent(rate.standardPercent)
      setInvoices(inv)
      setParties(par)
      setVehicles(veh)
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
    if (v) {
      next.description = [[v.make, v.model].filter(Boolean).join(' '), v.vin].filter(Boolean).join(', ')
      if (v.askingPriceRappen != null) next.price = netPriceText(v.askingPriceRappen, vatPercent)
    }
    setForm(next)
  }

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const created = await api.post('/api/invoices', {
        partyId: form.partyId,
        vehicleId: form.vehicleId || undefined,
        lines: [{ description: form.description, quantity: 1, unitPriceRappen: francsToRappen(form.price), taxCode: 'standard' }],
      })
      const base = created.archive?.archived
        ? t('documents.invoices.archivedOk', { number: created.number })
        : t('documents.invoices.notArchived', { number: created.number, reason: created.archive?.reason ?? '' })
      setNotice({ tone: created.archive?.archived ? 'green' : 'amber', text: created.soldVehicle ? `${base} ${t('documents.invoices.vehicleSold')}` : base })
      setForm(EMPTY_FORM)
      setShowForm(false)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCamt(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const xml = await file.text()
      setCamtResult(await api.post('/api/payments/camt054', { xml }))
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) return <p className="p-6 text-danger">{error}</p>
  if (!invoices) return <p className="p-6 text-steel">{t('common.loading')}</p>

  const today = todayIso()
  const visible = invoices.filter((i) => {
    const state = invoiceState(i, today)
    if (filter === 'open') return state !== 'paid' && state !== 'credited'
    return filter === 'all' || state === filter
  })

  return (
    <div className="p-6">
      <PageHeader title={t('documents.invoices.title')}>
        <input ref={fileInput} type="file" accept=".xml,text/xml" className="hidden" onChange={handleCamt} />
        <button className="btn-ghost" onClick={() => fileInput.current?.click()}>
          {t('documents.camt.button')}
        </button>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('documents.invoices.add')}
        </button>
      </PageHeader>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {camtResult && (
        <div className="card mb-4 p-4">
          <div className="flex items-center justify-between">
            <h3 className="panel-title">{t('documents.camt.title')}</h3>
            <button className="text-sm text-brand underline" onClick={() => setCamtResult(null)}>
              {t('documents.camt.close')}
            </button>
          </div>
          <ul className="mt-2 divide-y divide-line text-sm">
            {camtResult.map((r, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5">
                <span>
                  {formatDay(r.valueDate)} · {formatMoney(r.amountRappen)}
                </span>
                {r.matched ? (
                  <Tag tone="green">{t('documents.camt.matched')}</Tag>
                ) : (
                  <Tag tone="amber">
                    {t('documents.camt.skipped')}: {t(`documents.camt.reasons.${r.reason}`)}
                  </Tag>
                )}
              </li>
            ))}
            {camtResult.length === 0 && <li className="py-1.5 text-steel">{t('common.none')}</li>}
          </ul>
        </div>
      )}

      {showForm &&
        (parties.length === 0 ? (
          <Notice tone="amber">{t('documents.invoices.needsCustomer')}</Notice>
        ) : (
          <form onSubmit={handleAdd} className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <select
              required
              className="field"
              aria-label={t('documents.invoices.customer')}
              value={form.partyId}
              onChange={(e) => setForm({ ...form, partyId: e.target.value })}
            >
              <option value="">{t('documents.invoices.chooseCustomer')}</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {partyName(p)}
                </option>
              ))}
            </select>
            <select className="field" aria-label={t('documents.invoices.chooseVehicle')} value={form.vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
              <option value="">{t('documents.invoices.chooseVehicle')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')} {v.vin ? `(${v.vin})` : ''}
                </option>
              ))}
            </select>
            {form.vehicleId && <p className="text-xs text-steel sm:col-span-2">{t('documents.invoices.sellsVehicle')}{vatPercent ? ` ${t('sales.grossToNet', { rate: vatPercent })}` : ''}</p>}
            <input
              required
              className="field"
              placeholder={t('documents.invoices.description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              required
              className="field"
              placeholder={t('documents.invoices.priceNet')}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <button type="submit" disabled={saving} className="btn sm:col-span-2">
              {t('common.save')}
            </button>
          </form>
        ))}

      <div className="mb-3 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              filter === f ? 'bg-brand text-white' : 'border border-line-strong bg-white text-steel hover:text-brand'
            }`}
          >
            {t(`documents.invoices.filter.${f}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('documents.invoices.empty')}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rows w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">{t('documents.invoices.number')}</th>
                <th className="p-3">{t('documents.invoices.customer')}</th>
                <th className="p-3">{t('documents.invoices.dueDate')}</th>
                <th className="p-3">{t('vehicle.status')}</th>
                <th className="p-3 text-right">{t('documents.invoices.total')}</th>
                <th className="p-3 text-right">{t('documents.invoices.outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const state = invoiceState(i, today)
                return (
                  <tr key={i.id} className="cursor-pointer" onClick={() => onOpenInvoice?.(i.id)}>
                    <td className="p-3 font-semibold text-ink">{i.number}</td>
                    <td className="p-3">
                      {i.party_id
                        ? partyName({ kind: i.company_name ? 'company' : 'person', companyName: i.company_name, firstName: i.first_name, lastName: i.last_name })
                        : t('common.none')}
                    </td>
                    <td className="p-3">{formatDay(i.due_date)}</td>
                    <td className="space-x-1 p-3">
                      <Tag tone={STATE_TONE[state]}>{t(`documents.invoices.status.${state}`)}</Tag>
                      {Number(i.credited_rappen) > 0 && state !== 'credited' && <Tag tone="gray">{t('documents.invoices.partiallyCredited')}</Tag>}
                      {i.last_reminder_level != null && <Tag tone="gray">{t('documents.invoices.detail.reminderLevel', { n: i.last_reminder_level })}</Tag>}
                    </td>
                    <td className="num p-3 text-right">{formatMoney(Number(i.total_rappen))}</td>
                    <td className="num p-3 text-right">{formatMoney(i.outstanding_rappen)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
