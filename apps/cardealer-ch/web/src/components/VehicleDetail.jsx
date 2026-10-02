import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen, rappenToFrancs } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'
import { Drawer, Panel, Tag, Notice, VEHICLE_STATUS_TONE, formatDay } from './ui.jsx'
import VehiclePhotos from './VehiclePhotos.jsx'

const COST_KINDS = ['part', 'labor', 'transport', 'fee', 'detail']

const OPTION_VALUES = {
  bodyType: ['saloon', 'estate', 'suv', 'small-car', 'coupe', 'cabriolet', 'minivan', 'pickup', 'van', 'bus', 'other'],
  fuelType: ['petrol', 'diesel', 'electric', 'hybrid-petrol', 'hybrid-diesel', 'lpg', 'cng', 'hydrogen', 'other'],
  transmissionType: ['manual', 'automatic', 'semi-automatic', 'automatic-stepless'],
  driveType: ['front', 'rear', 'all'],
  vehicleCategory: ['car', 'utility', 'motorcycle', 'truck', 'camper', 'trailer'],
  conditionType: ['used', 'new', 'demonstration', 'pre-registered', 'oldtimer'],
  warrantyType: ['none', 'from-date', 'from-delivery', 'from-first-registration'],
  bodyColor: ['beige', 'black', 'blue', 'bronze', 'brown', 'gold', 'green', 'grey', 'orange', 'red', 'silver', 'violet', 'white', 'yellow'],
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
      ['vehicleCategory', 'select', 'vehicleCategory'],
      ['conditionType', 'select', 'conditionType'],
      ['bodyType', 'select', 'bodyType'],
      ['fuelType', 'select', 'fuelType'],
      ['transmissionType', 'select', 'transmissionType'],
      ['driveType', 'select', 'driveType'],
      ['bodyColor', 'select', 'bodyColor'],
      ['bodyColorText', 'text'],
      ['interiorColorText', 'text'],
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
    [['lastInspectionDate', 'date'], ['inspectionValidUntil', 'date'], ['soldWithInspection', 'check'], ['warrantyType', 'select', 'warrantyType']],
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

function Row({ label, value, strong, tone }) {
  const toneClass = tone === 'loss' ? 'text-danger' : tone === 'good' ? 'text-profit' : 'text-ink'
  return (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'border-t border-line' : ''}`}>
      <span className="text-steel">{label}</span>
      <span className={`num ${strong ? 'font-semibold' : ''} ${toneClass}`}>{value}</span>
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
  const [contracts, setContracts] = useState({ sellerId: '', buyerId: '', warrantyMonths: '12' })

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
        <label key={key} className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
          {text}
        </label>
      )
    }
    return (
      <label key={key} className="block">
        <span className="field-label">{text}</span>
        {type === 'select' ? (
          <select className="field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
            <option value=""></option>
            {OPTION_VALUES[optionsKey].map((value) => (
              <option key={value} value={value}>
                {optionLabel(optionsKey, value)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="field"
            type={type === 'date' ? 'date' : 'text'}
            inputMode={type === 'int' || type === 'franc' ? 'decimal' : undefined}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        )}
      </label>
    )
  }

  if (!vehicle || !form) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose}>
        {error && <Notice>{error}</Notice>}
      </Drawer>
    )
  }

  const contractQuery = new URLSearchParams()
  if (contracts.buyerId) contractQuery.set('buyerPartyId', contracts.buyerId)
  if (contracts.warrantyMonths) contractQuery.set('warrantyMonths', contracts.warrantyMonths)
  const sellerQuery = contracts.sellerId ? `?sellerPartyId=${contracts.sellerId}` : ''

  return (
    <Drawer
      title={label}
      subtitle={
        <>
          <Tag tone={VEHICLE_STATUS_TONE[vehicle.status]}>{t(`status.${vehicle.status}`)}</Tag>
          {vehicle.vin ? <span className="ml-2 font-mono text-xs">{vehicle.vin}</span> : null}
        </>
      }
      onClose={onClose}
    >
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}

      <Panel title={t('vehicle.detail.sections.economics')}>
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
            <p className="mt-1 text-xs text-steel">{t(`vehicle.detail.health.${economics.health}`)}</p>
          </>
        )}
        {vehicle.notionalInputTaxRappen > 0 && (
          <p className="mt-2 text-xs text-steel">
            {t('vehicle.detail.notionalInputTax')}: {formatMoney(Number(vehicle.notionalInputTaxRappen))}
          </p>
        )}
      </Panel>

      <form onSubmit={save} className="space-y-5">
        {SECTIONS.map(([section, list]) => (
          <Panel key={section} title={t(`vehicle.detail.sections.${section}`)}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.map(renderField)}</div>
          </Panel>
        ))}
        <Panel title={t('vehicle.detail.sections.notes')}>
          <textarea className="field" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Panel>
        <button type="submit" disabled={busy} className="btn">
          {t('common.save')}
        </button>
      </form>

      <VehiclePhotos vehicleId={vehicle.id} onChanged={onChanged} />

      <Panel title={t('vehicle.detail.sections.costs')}>
        {costs.length === 0 ? (
          <p className="mb-3 text-sm text-steel">{t('vehicle.detail.cost.empty')}</p>
        ) : (
          <table className="mb-3 w-full text-sm">
            <tbody>
              {costs.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-steel">{t(`vehicle.detail.cost.kinds.${c.kind}`)}</td>
                  <td className="py-1.5">{c.description}</td>
                  <td className="num py-1.5 text-right">{formatMoney(c.amountRappen)}</td>
                  <td className="py-1.5 text-right">
                    <button className="text-xs text-danger underline" onClick={() => removeCost(c.id)} disabled={busy}>
                      {t('vehicle.detail.cost.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={addCost} className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_8rem_auto]">
          <select className="field" aria-label={t('vehicle.detail.cost.kind')} value={costForm.kind} onChange={(e) => setCostForm({ ...costForm, kind: e.target.value })}>
            {COST_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`vehicle.detail.cost.kinds.${k}`)}
              </option>
            ))}
          </select>
          <input required className="field" placeholder={t('vehicle.detail.cost.description')} value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })} />
          <input required className="field" inputMode="decimal" placeholder={t('vehicle.detail.cost.amount')} value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} />
          <button type="submit" disabled={busy} className="btn">
            {t('vehicle.detail.cost.add')}
          </button>
        </form>
      </Panel>

      <Panel title={t('vehicle.detail.sections.sell')}>
        {isSold ? (
          <p className="text-sm">
            {t('vehicle.detail.sell.soldOn', { date: formatDay(vehicle.soldAt) })} · {formatMoney(Number(vehicle.soldPriceRappen))}
          </p>
        ) : vehicle.status === 'written_off' ? null : (
          <form onSubmit={sell} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            <label>
              <span className="field-label">{t('vehicle.detail.sell.price')}</span>
              <input required className="field" inputMode="decimal" value={sellForm.price} onChange={(e) => setSellForm({ ...sellForm, price: e.target.value })} />
            </label>
            <label>
              <span className="field-label">{t('vehicle.detail.sell.date')}</span>
              <input className="field" type="date" value={sellForm.date} onChange={(e) => setSellForm({ ...sellForm, date: e.target.value })} />
            </label>
            <label>
              <span className="field-label">{t('vehicle.detail.sell.buyer')}</span>
              <select className="field" value={sellForm.buyerId} onChange={(e) => setSellForm({ ...sellForm, buyerId: e.target.value })}>
                <option value="">{t('vehicle.detail.sell.chooseBuyer')}</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {partyName(p)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} className="btn sm:col-span-3">
              {t('vehicle.detail.sell.submit')}
            </button>
          </form>
        )}
      </Panel>

      <Panel title={t('vehicle.detail.sections.contracts')}>
        <Notice tone="amber">{t('vehicle.detail.contracts.note')}</Notice>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block">
              <span className="field-label">{t('vehicle.detail.contracts.seller')}</span>
              <select className="field" value={contracts.sellerId} onChange={(e) => setContracts({ ...contracts, sellerId: e.target.value })}>
                <option value="">{vehicle.sellerPartyId ? '' : t('vehicle.detail.contracts.choose')}</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {partyName(p)}
                  </option>
                ))}
              </select>
            </label>
            <a className="btn-ghost w-full" href={`/api/vehicles/${vehicle.id}/ankaufsvertrag.pdf${sellerQuery}`} target="_blank" rel="noreferrer">
              {t('vehicle.detail.contracts.ankauf')}
            </a>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">{t('vehicle.detail.contracts.buyer')}</span>
                <select className="field" value={contracts.buyerId} onChange={(e) => setContracts({ ...contracts, buyerId: e.target.value })}>
                  <option value="">{vehicle.buyerPartyId ? '' : t('vehicle.detail.contracts.choose')}</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {partyName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">{t('vehicle.detail.contracts.warranty')}</span>
                <input className="field" inputMode="numeric" value={contracts.warrantyMonths} onChange={(e) => setContracts({ ...contracts, warrantyMonths: e.target.value })} />
              </label>
            </div>
            <a className="btn-ghost w-full" href={`/api/vehicles/${vehicle.id}/kaufvertrag.pdf?${contractQuery}`} target="_blank" rel="noreferrer">
              {t('vehicle.detail.contracts.kauf')}
            </a>
          </div>
        </div>
      </Panel>
    </Drawer>
  )
}
