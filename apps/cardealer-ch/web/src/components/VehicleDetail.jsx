import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen, rappenToFrancs } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'

const COST_KINDS = ['part', 'labor', 'transport', 'fee', 'detail']

const OPTION_VALUES = {
  bodyType: ['saloon', 'estate', 'suv', 'small-car', 'coupe', 'cabriolet', 'minivan', 'pickup', 'van', 'bus', 'other'],
  fuelType: ['petrol', 'diesel', 'electric', 'hybrid-petrol', 'hybrid-diesel', 'lpg', 'cng', 'hydrogen', 'other'],
  transmissionType: ['manual', 'automatic', 'semi-automatic', 'automatic-stepless'],
  driveType: ['front', 'rear', 'all'],
  purchaseFroms: ['private', 'dealer', 'auction', 'trade_in'],
  vatSchemes: ['notional_input_tax', 'standard', 'margin'],
}

const optionLabel = (optionsKey, value) =>
  optionsKey === 'purchaseFroms' || optionsKey === 'vatSchemes'
    ? t(`vehicle.detail.${optionsKey}.${value}`)
    : t(`vehicle.options.${optionsKey}.${value}`)

/** Feldliste je Abschnitt: [key, Typ, Optionen-Schlüssel (nur select)]. Typ: text | int | date | select | franc | check */
const SECTIONS = [
  ['identity', [['vin', 'text'], ['serialNumber', 'text'], ['certificationNumber', 'text']]],
  [
    'spec',
    [
      ['make', 'text'],
      ['model', 'text'],
      ['trim', 'text'],
      ['modelYear', 'int'],
      ['firstRegistrationDate', 'date'],
      ['bodyType', 'select', 'bodyType'],
      ['fuelType', 'select', 'fuelType'],
      ['transmissionType', 'select', 'transmissionType'],
      ['driveType', 'select', 'driveType'],
      ['bodyColorText', 'text', null, 'vehicle.fields.bodyColor'],
      ['interiorColorText', 'text', null, 'vehicle.fields.interiorColor'],
      ['doors', 'int'],
      ['seats', 'int'],
      ['powerKw', 'int'],
      ['displacementCcm', 'int'],
      ['mileageKm', 'int'],
      ['ownersCount', 'int'],
    ],
  ],
  [
    'inspection',
    [['lastInspectionDate', 'date'], ['inspectionValidUntil', 'date'], ['soldWithInspection', 'check']],
  ],
  [
    'pricing',
    [
      ['purchasePriceRappen', 'franc', null, 'vehicle.fields.purchasePrice'],
      ['askingPriceRappen', 'franc', null, 'vehicle.fields.askingPrice'],
      ['purchasedAt', 'date', null, 'vehicle.detail.purchasedAt'],
      ['purchaseFrom', 'select', 'purchaseFroms', 'vehicle.detail.purchaseFrom'],
      ['vatScheme', 'select', 'vatSchemes', 'vehicle.detail.vatScheme'],
    ],
  ],
]

const fields = SECTIONS.flatMap(([, list]) => list)

function toForm(vehicle) {
  const form = {}
  for (const [key, type] of fields) {
    const value = vehicle[key]
    if (type === 'franc') form[key] = value == null ? '' : String(rappenToFrancs(value))
    else if (type === 'check') form[key] = Boolean(value)
    else form[key] = value ?? ''
  }
  form.notes = vehicle.notes ?? ''
  return form
}

function toPayload(form) {
  const body = {}
  for (const [key, type] of fields) {
    const value = form[key]
    if (type === 'check') body[key] = value
    else if (value === '' || value == null) body[key] = null
    else if (type === 'int') body[key] = Number(value)
    else if (type === 'franc') body[key] = francsToRappen(value)
    else body[key] = value
  }
  // vatScheme ist NOT NULL in der DB — leer heisst "unverändert", nicht "löschen".
  if (body.vatScheme == null) delete body.vatScheme
  body.notes = form.notes === '' ? null : form.notes
  return body
}

const inputClass = 'border border-gray-300 rounded px-2 py-1.5 text-sm w-full'

function Row({ label, value, strong, tone }) {
  const toneClass = tone === 'loss' ? 'text-red-700' : tone === 'good' ? 'text-green-700' : 'text-gray-900'
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-gray-500">{label}</span>
      <span className={`${strong ? 'font-semibold' : ''} ${toneClass}`}>{value}</span>
    </div>
  )
}

export default function VehicleDetail({ vehicleId, onClose, onChanged }) {
  const [vehicle, setVehicle] = useState(null)
  const [economics, setEconomics] = useState(null)
  const [costs, setCosts] = useState([])
  const [parties, setParties] = useState([])
  const [form, setForm] = useState(null)
  const [costForm, setCostForm] = useState({ kind: 'part', description: '', amount: '' })
  const [sellForm, setSellForm] = useState({ price: '', date: '', buyerId: '' })
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const [v, e, c, p] = await Promise.all([
        api.get(`/api/vehicles/${vehicleId}`),
        api.get(`/api/vehicles/${vehicleId}/economics`),
        api.get(`/api/vehicles/${vehicleId}/costs`),
        api.get('/api/parties'),
      ])
      setVehicle(v)
      setEconomics(e)
      setCosts(c)
      setParties(p)
      setForm(toForm(v))
      setSellForm((s) => ({ ...s, price: s.price || (v.askingPriceRappen != null ? String(rappenToFrancs(v.askingPriceRappen)) : '') }))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [vehicleId])

  async function run(action, okMessage) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await load()
      onChanged?.()
      if (okMessage) setMessage(okMessage)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const save = (event) => {
    event.preventDefault()
    return run(() => api.patch(`/api/vehicles/${vehicleId}`, toPayload(form)), t('vehicle.detail.saved'))
  }

  const addCost = (event) => {
    event.preventDefault()
    return run(async () => {
      await api.post(`/api/vehicles/${vehicleId}/costs`, {
        kind: costForm.kind,
        description: costForm.description,
        amountRappen: francsToRappen(costForm.amount),
      })
      setCostForm({ kind: costForm.kind, description: '', amount: '' })
    })
  }

  const removeCost = (costId) => run(() => api.del(`/api/vehicles/${vehicleId}/costs/${costId}`))

  const sell = (event) => {
    event.preventDefault()
    return run(() =>
      api.post(`/api/vehicles/${vehicleId}/sell`, {
        soldPriceRappen: francsToRappen(sellForm.price),
        soldAt: sellForm.date || undefined,
        buyerPartyId: sellForm.buyerId || undefined,
      }),
    )
  }

  const label = vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || t('vehicle.unknown') : ''
  const isSold = vehicle?.status === 'sold'

  const renderField = ([key, type, optionsKey, labelKey]) => {
    const text = t(labelKey ?? `vehicle.fields.${key}`)
    if (type === 'check') {
      return (
        <label key={key} className="flex items-center gap-2 text-sm col-span-2">
          <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
          {text}
        </label>
      )
    }
    return (
      <label key={key} className="text-xs text-gray-500 block">
        {text}
        {type === 'select' ? (
          <select className={inputClass} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
            <option value=""></option>
            {OPTION_VALUES[optionsKey].map((value) => (
              <option key={value} value={value}>
                {optionLabel(optionsKey, value)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={inputClass}
            type={type === 'date' ? 'date' : 'text'}
            inputMode={type === 'int' || type === 'franc' ? 'decimal' : undefined}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        )}
      </label>
    )
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-3xl bg-gray-50 h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-6 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{label || t('common.loading')}</h2>
            {vehicle && (
              <p className="text-xs text-gray-500">
                {t(`status.${vehicle.status}`)}
                {vehicle.vin ? ` · ${vehicle.vin}` : ''}
              </p>
            )}
          </div>
          <button className="text-sm underline" onClick={onClose}>
            {t('vehicle.detail.close')}
          </button>
        </div>

        {error && <p className="text-red-600 px-6 pt-3 text-sm">{error}</p>}
        {message && <p className="text-green-700 px-6 pt-3 text-sm">{message}</p>}
        {!vehicle || !form ? (
          <p className="p-6 text-gray-500">{t('common.loading')}</p>
        ) : (
          <div className="p-6 space-y-5">
            <section className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('vehicle.detail.sections.economics')}</h3>
              {economics && (
                <>
                  <Row label={t('vehicle.detail.economics.purchase')} value={formatMoney(economics.purchaseRappen)} />
                  <Row label={t('vehicle.detail.economics.parts')} value={formatMoney(economics.partsRappen)} />
                  <Row label={t('vehicle.detail.economics.labor')} value={formatMoney(economics.laborRappen)} />
                  <Row label={t('vehicle.detail.economics.other')} value={formatMoney(economics.otherRappen)} />
                  <Row label={t('vehicle.detail.economics.invested')} value={formatMoney(economics.totalInvestedRappen)} strong />
                  <Row
                    label={economics.realized ? t('vehicle.detail.economics.price') : t('vehicle.detail.economics.priceAsking')}
                    value={formatMoney(economics.priceRappen)}
                  />
                  <Row
                    label={t('vehicle.detail.economics.profit')}
                    value={`${formatMoney(economics.profitRappen)} (${economics.marginPct} %)`}
                    strong
                    tone={economics.health === 'loss' ? 'loss' : economics.health === 'good' ? 'good' : undefined}
                  />
                  <p className="text-xs text-gray-500 mt-1">{t(`vehicle.detail.health.${economics.health}`)}</p>
                </>
              )}
              {vehicle.notionalInputTaxRappen > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('vehicle.detail.notionalInputTax')}: {formatMoney(Number(vehicle.notionalInputTaxRappen))}
                </p>
              )}
            </section>

            <form onSubmit={save} className="space-y-5">
              {SECTIONS.map(([section, list]) => (
                <section key={section} className="bg-white rounded-lg shadow p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">{t(`vehicle.detail.sections.${section}`)}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{list.map(renderField)}</div>
                </section>
              ))}
              <section className="bg-white rounded-lg shadow p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('vehicle.detail.sections.notes')}</h3>
                <textarea className={inputClass} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </section>
              <button type="submit" disabled={busy} className="bg-gray-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50">
                {t('common.save')}
              </button>
            </form>

            <section className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('vehicle.detail.sections.costs')}</h3>
              {costs.length === 0 ? (
                <p className="text-sm text-gray-500 mb-3">{t('vehicle.detail.cost.empty')}</p>
              ) : (
                <table className="w-full text-sm mb-3">
                  <tbody>
                    {costs.map((c) => (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-500">{t(`vehicle.detail.cost.kinds.${c.kind}`)}</td>
                        <td className="py-1.5">{c.description}</td>
                        <td className="py-1.5 text-right">{formatMoney(c.amountRappen)}</td>
                        <td className="py-1.5 text-right">
                          <button className="text-xs underline text-gray-500" onClick={() => removeCost(c.id)} disabled={busy}>
                            {t('vehicle.detail.cost.remove')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <form onSubmit={addCost} className="grid grid-cols-[auto_1fr_8rem_auto] gap-2">
                <select
                  className={inputClass}
                  aria-label={t('vehicle.detail.cost.kind')}
                  value={costForm.kind}
                  onChange={(e) => setCostForm({ ...costForm, kind: e.target.value })}
                >
                  {COST_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vehicle.detail.cost.kinds.${k}`)}
                    </option>
                  ))}
                </select>
                <input
                  required
                  className={inputClass}
                  placeholder={t('vehicle.detail.cost.description')}
                  value={costForm.description}
                  onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}
                />
                <input
                  required
                  className={inputClass}
                  inputMode="decimal"
                  placeholder={t('vehicle.detail.cost.amount')}
                  value={costForm.amount}
                  onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })}
                />
                <button type="submit" disabled={busy} className="bg-gray-900 text-white rounded px-3 text-sm disabled:opacity-50">
                  {t('vehicle.detail.cost.add')}
                </button>
              </form>
            </section>

            <section className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('vehicle.detail.sections.sell')}</h3>
              {isSold ? (
                <p className="text-sm text-gray-700">
                  {t('vehicle.detail.sell.soldOn', { date: vehicle.soldAt ? new Date(vehicle.soldAt + 'T00:00:00').toLocaleDateString('de-CH') : t('common.none') })}
                  {' · '}
                  {formatMoney(Number(vehicle.soldPriceRappen))}
                </p>
              ) : vehicle.status === 'written_off' ? null : (
                <form onSubmit={sell} className="grid grid-cols-3 gap-3 items-end">
                  <label className="text-xs text-gray-500 block">
                    {t('vehicle.detail.sell.price')}
                    <input required className={inputClass} inputMode="decimal" value={sellForm.price} onChange={(e) => setSellForm({ ...sellForm, price: e.target.value })} />
                  </label>
                  <label className="text-xs text-gray-500 block">
                    {t('vehicle.detail.sell.date')}
                    <input className={inputClass} type="date" value={sellForm.date} onChange={(e) => setSellForm({ ...sellForm, date: e.target.value })} />
                  </label>
                  <label className="text-xs text-gray-500 block">
                    {t('vehicle.detail.sell.buyer')}
                    <select className={inputClass} value={sellForm.buyerId} onChange={(e) => setSellForm({ ...sellForm, buyerId: e.target.value })}>
                      <option value="">{t('vehicle.detail.sell.chooseBuyer')}</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {partyName(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={busy} className="col-span-3 bg-gray-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50">
                    {t('vehicle.detail.sell.submit')}
                  </button>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

