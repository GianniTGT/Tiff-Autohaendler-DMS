import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'

const EMPTY_FORM = { vin: '', make: '', model: '', mileageKm: '', purchasePrice: '', askingPrice: '' }

export default function VehicleList() {
  const [vehicles, setVehicles] = useState(null)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function reload() {
    try {
      setVehicles(await api.get('/api/vehicles'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/vehicles', {
        vin: form.vin || undefined,
        make: form.make || undefined,
        model: form.model || undefined,
        mileageKm: form.mileageKm ? Number(form.mileageKm) : undefined,
        purchasePriceRappen: form.purchasePrice ? francsToRappen(form.purchasePrice) : undefined,
        askingPriceRappen: form.askingPrice ? francsToRappen(form.askingPrice) : undefined,
        status: 'in_stock',
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
  if (!vehicles) return <p className="p-6 text-gray-500">{t('common.loading')}</p>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{t('nav.inventory')}</h2>
        <button
          className="bg-gray-900 text-white rounded px-3 py-1.5 text-sm"
          onClick={() => setShowForm((v) => !v)}
        >
          {t('dashboard.addVehicle')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-3 gap-3">
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.vin')}
            value={form.vin}
            onChange={(e) => setForm({ ...form, vin: e.target.value })}
          />
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.make')}
            value={form.make}
            onChange={(e) => setForm({ ...form, make: e.target.value })}
          />
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.model')}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.mileageKm')}
            value={form.mileageKm}
            onChange={(e) => setForm({ ...form, mileageKm: e.target.value })}
          />
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.purchasePrice')}
            value={form.purchasePrice}
            onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
          />
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder={t('vehicle.fields.askingPrice')}
            value={form.askingPrice}
            onChange={(e) => setForm({ ...form, askingPrice: e.target.value })}
          />
          <button type="submit" disabled={saving} className="col-span-3 bg-gray-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
            {t('common.save')}
          </button>
        </form>
      )}

      {vehicles.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
          <p>{t('dashboard.emptyTitle')}</p>
          <p className="text-sm mt-1">{t('dashboard.emptyBody')}</p>
        </div>
      ) : (
        <table className="w-full bg-white rounded-lg shadow text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">{t('vehicle.fields.make')}</th>
              <th className="p-3">{t('vehicle.fields.vin')}</th>
              <th className="p-3">{t('vehicle.fields.mileageKm')}</th>
              <th className="p-3">{t('vehicle.status')}</th>
              <th className="p-3 text-right">{t('vehicle.fields.askingPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-b last:border-0">
                <td className="p-3">{[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')}</td>
                <td className="p-3 text-gray-500">{v.vin || t('common.none')}</td>
                <td className="p-3">{v.mileageKm != null ? `${v.mileageKm} km` : t('common.none')}</td>
                <td className="p-3">{t(`status.${v.status}`)}</td>
                <td className="p-3 text-right">{formatMoney(v.askingPriceRappen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
