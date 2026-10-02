import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, VEHICLE_STATUS_TONE } from './ui.jsx'

const EMPTY_FORM = { vin: '', make: '', model: '', mileageKm: '', purchasePrice: '', askingPrice: '' }

export default function VehicleList({ onOpenVehicle }) {
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

  if (error) return <p className="p-6 text-danger">{error}</p>
  if (!vehicles) return <p className="p-6 text-steel">{t('common.loading')}</p>

  const input = (key, label) => (
    <input
      className="field"
      placeholder={label}
      aria-label={label}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  )

  return (
    <div className="p-6">
      <PageHeader title={t('nav.inventory')}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('dashboard.addVehicle')}
        </button>
      </PageHeader>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          {input('vin', t('vehicle.fields.vin'))}
          {input('make', t('vehicle.fields.make'))}
          {input('model', t('vehicle.fields.model'))}
          {input('mileageKm', t('vehicle.fields.mileageKm'))}
          {input('purchasePrice', t('vehicle.fields.purchasePrice'))}
          {input('askingPrice', t('vehicle.fields.askingPrice'))}
          <button type="submit" disabled={saving} className="btn sm:col-span-3">
            {t('common.save')}
          </button>
        </form>
      )}

      {vehicles.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-lg font-bold uppercase text-brand">{t('dashboard.emptyTitle')}</p>
          <p className="mt-1 text-sm text-steel">{t('dashboard.emptyBody')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rows w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">{t('vehicle.fields.make')}</th>
                <th className="p-3">{t('vehicle.fields.vin')}</th>
                <th className="p-3 text-right">{t('vehicle.fields.mileageKm')}</th>
                <th className="p-3">{t('vehicle.status')}</th>
                <th className="p-3 text-right">{t('vehicle.fields.askingPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className="cursor-pointer" onClick={() => onOpenVehicle?.(v.id)}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {v.coverPhotoId ? (
                        <img src={`/api/vehicles/${v.id}/photos/${v.coverPhotoId}`} alt="" loading="lazy" className="h-10 w-14 rounded object-cover" />
                      ) : (
                        <div className="h-10 w-14 rounded bg-tint" />
                      )}
                      <span className="font-semibold text-ink">{[v.make, v.model].filter(Boolean).join(' ') || t('vehicle.unknown')}</span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-xs text-steel">{v.vin || t('common.none')}</td>
                  <td className="num p-3 text-right">{v.mileageKm != null ? `${Number(v.mileageKm).toLocaleString('de-CH')} km` : t('common.none')}</td>
                  <td className="p-3">
                    <Tag tone={VEHICLE_STATUS_TONE[v.status]}>{t(`status.${v.status}`)}</Tag>
                  </td>
                  <td className="num p-3 text-right">{formatMoney(v.askingPriceRappen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
