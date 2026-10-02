import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'

const EMPTY_FORM = { partyId: '', vehicleId: '', description: '', price: '' }

const formatDate = (day) => (day ? new Date(`${String(day).slice(0, 10)}T00:00:00`).toLocaleDateString('de-CH') : t('common.none'))

export default function InvoiceList() {
  const [invoices, setInvoices] = useState(null)
  const [parties, setParties] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function reload() {
    try {
      const [inv, par, veh] = await Promise.all([
        api.get('/api/invoices'),
        api.get('/api/parties'),
        api.get('/api/vehicles'),
      ])
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
      const label = [v.make, v.model].filter(Boolean).join(' ')
      next.description = [label, v.vin].filter(Boolean).join(', ')
      if (v.askingPriceRappen != null) next.price = String(v.askingPriceRappen / 100)
    }
    setForm(next)
  }

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/invoices', {
        partyId: form.partyId,
        vehicleId: form.vehicleId || undefined,
        lines: [{ description: form.description, quantity: 1, unitPriceRappen: francsToRappen(form.price), taxCode: 'standard' }],
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (error) return <p className="text-red-600 p-6">{error}</p>
  if (!invoices) return <p className="p-6 text-gray-500">{t('common.loading')}</p>

  const field = 'border border-gray-300 rounded px-2 py-1.5 text-sm'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{t('documents.invoices.title')}</h2>
        <button className="bg-gray-900 text-white rounded px-3 py-1.5 text-sm" onClick={() => setShowForm((v) => !v)}>
          {t('documents.invoices.add')}
        </button>
      </div>

      {showForm &&
        (parties.length === 0 ? (
          <p className="bg-white rounded-lg shadow p-4 mb-4 text-sm text-gray-500">{t('documents.invoices.needsCustomer')}</p>
        ) : (
          <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-2 gap-3">
            <select
              required
              className={field}
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
            <select
              className={field}
              aria-label={t('documents.invoices.chooseVehicle')}
              value={form.vehicleId}
              onChange={(e) => pickVehicle(e.target.value)}
            >
              <option value="">{t('documents.invoices.chooseVehicle')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')} {v.vin ? `(${v.vin})` : ''}
                </option>
              ))}
            </select>
            <input
              required
              className={field}
              placeholder={t('documents.invoices.description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              required
              className={field}
              placeholder={t('documents.invoices.priceNet')}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <button type="submit" disabled={saving} className="col-span-2 bg-gray-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
              {t('common.save')}
            </button>
          </form>
        ))}

      {invoices.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">{t('documents.invoices.empty')}</div>
      ) : (
        <table className="w-full bg-white rounded-lg shadow text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">{t('documents.invoices.number')}</th>
              <th className="p-3">{t('documents.invoices.customer')}</th>
              <th className="p-3">{t('documents.invoices.issueDate')}</th>
              <th className="p-3">{t('documents.invoices.dueDate')}</th>
              <th className="p-3 text-right">{t('documents.invoices.total')}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="p-3">{i.number}</td>
                <td className="p-3">
                  {i.party_id
                    ? partyName({ kind: i.company_name ? 'company' : 'person', companyName: i.company_name, firstName: i.first_name, lastName: i.last_name })
                    : t('common.none')}
                </td>
                <td className="p-3">{formatDate(i.issue_date)}</td>
                <td className="p-3">{formatDate(i.due_date)}</td>
                <td className="p-3 text-right">{formatMoney(Number(i.total_rappen))}</td>
                <td className="p-3 text-right">
                  <a className="underline" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">
                    {t('documents.invoices.pdf')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
