import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, formatDay } from './ui.jsx'

/**
 * Dashboard wie im Manager: vier Kennzahlen, «Wo das Geld steckt» (Ring), «Wo die Fahrzeuge stehen»
 * (Balken und drei Zahlen), darunter «Zu erledigen» als eine Liste mit Etikett, Text und Aktion.
 */

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`card min-w-0 p-4 ${accent ? 'border-t-4 border-t-brand-gold' : 'border-t-4 border-t-brand'}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-steel">{label}</div>
      <div className="num mt-1 font-display text-2xl font-bold text-brand-deep sm:text-3xl">{value}</div>
      <div className="mt-0.5 min-h-[1rem] text-xs text-steel">{sub ?? ''}</div>
    </div>
  )
}

const RING = { purchase: '#0F4A2C', costs: '#4F8A6A', margin: '#C9A053', loss: '#B3261E' }

/** Ring aus SVG-Bögen — ohne Diagramm-Bibliothek, wie im Manager gezeichnet. */
function Ring({ segments, centerLabel, centerValue }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1
  const r = 44
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative h-40 w-40 flex-none">
      <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#EDF3EF" strokeWidth="16" />
        {segments.map((seg) => {
          const len = (Math.max(0, seg.value) / total) * c
          const el = <circle key={seg.key} cx="60" cy="60" r={r} fill="none" stroke={seg.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-steel">{centerLabel}</span>
        <span className="num font-display text-lg font-bold text-brand-deep">{centerValue}</span>
      </div>
    </div>
  )
}

const TAG_TONE = {
  red: 'bg-danger-bg text-danger',
  amber: 'bg-warn-bg text-warn',
  brand: 'bg-brand-wash text-brand',
  gray: 'bg-tint text-steel',
}

function TodoRow({ item }) {
  return (
    <li className={`flex items-center gap-3 py-2.5 ${item.tone === 'red' ? 'border-l-4 border-l-danger pl-3' : 'pl-4'}`}>
      <span className={`tag flex-none ${TAG_TONE[item.tone]}`}>{item.tag}</span>
      <span className="min-w-0 flex-1 text-sm text-ink">{item.text}</span>
      <button className="flex-none text-sm font-semibold text-brand hover:underline" onClick={item.onAction}>
        {item.action}
      </button>
    </li>
  )
}

export default function Dashboard({ onOpenVehicle, onNavigate }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get('/api/dashboard')
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="p-6 text-danger">{error}</p>
  if (!data) return <p className="p-6 text-steel">{t('common.loading')}</p>

  const restricted = t('dashboard.restricted')
  const money = data.money
  const margin = money ? money.projectedProfitRappen : 0
  const segments = money
    ? [
        { key: 'purchase', label: t('dashboard.money.purchase'), value: money.purchaseRappen, color: RING.purchase },
        { key: 'costs', label: t('dashboard.money.costs'), value: money.costsRappen, color: RING.costs },
        margin >= 0
          ? { key: 'margin', label: t('dashboard.money.margin'), value: margin, color: RING.margin }
          : { key: 'loss', label: t('dashboard.money.loss'), value: -margin, color: RING.loss },
      ]
    : []
  const segmentTotal = segments.reduce((s, x) => s + x.value, 0) || 1

  // «Zu erledigen» — alles, was Aufmerksamkeit braucht, in einer Liste: dringend zuerst.
  const open = (id) => () => onOpenVehicle(id)
  const todos = [
    ...data.soldStillListed.map((i) => ({ tone: 'red', tag: t('dashboard.tags.listing'), text: `${i.label}: ${i.error ? t('dashboard.soldStillListedError', { error: i.error }) : t('dashboard.sections.soldStillListed')}`, action: t('dashboard.actions.listings'), onAction: () => onNavigate?.('listings') })),
    ...(data.overdueInvoices.count > 0
      ? [{ tone: 'red', tag: t('dashboard.tags.owed'), text: t('dashboard.todo.overdueInvoices', { n: data.overdueInvoices.count, amount: data.overdueInvoices.outstandingRappen != null ? formatMoney(data.overdueInvoices.outstandingRappen) : '' }).trim(), action: t('dashboard.actions.invoices'), onAction: () => onNavigate?.('invoices') }]
      : []),
    ...data.inspection.expired.map((i) => ({ tone: 'red', tag: t('dashboard.tags.inspection'), text: `${i.label}: ${t('dashboard.todo.inspectionExpired', { date: formatDay(i.validUntil), n: -i.daysLeft })}`, action: t('dashboard.actions.openVehicle'), onAction: open(i.id) })),
    ...(data.newLeads > 0 ? [{ tone: 'amber', tag: t('dashboard.tags.lead'), text: t('dashboard.todo.newLeads', { n: data.newLeads }), action: t('dashboard.actions.answer'), onAction: () => onNavigate?.('leads') }] : []),
    ...data.inspection.dueSoon.map((i) => ({ tone: 'amber', tag: t('dashboard.tags.inspection'), text: `${i.label}: ${t('dashboard.todo.inspectionDueSoon', { date: formatDay(i.validUntil), n: i.daysLeft })}`, action: t('dashboard.actions.openVehicle'), onAction: open(i.id) })),
    ...(data.openJobs.overdue > 0 ? [{ tone: 'amber', tag: t('dashboard.tags.workshop'), text: t('dashboard.todo.jobsOverdue', { n: data.openJobs.overdue }), action: t('dashboard.actions.workshop'), onAction: () => onNavigate?.('recon') }] : []),
    ...data.needsDoing.map((i) => ({ tone: 'amber', tag: t('dashboard.tags.data'), text: `${i.label}: ${i.reasons.map((r) => t(`dashboard.reasons.${r}`)).join(', ')}`, action: t('dashboard.actions.complete'), onAction: open(i.id) })),
    ...data.ageing.map((i) => ({ tone: 'gray', tag: t('dashboard.tags.ageing'), text: `${i.label}: ${t('dashboard.onLotDays', { n: i.days })}`, action: t('dashboard.actions.openVehicle'), onAction: open(i.id) })),
  ]
  const outstanding = todos.length + Math.max(0, data.needsDoingTotal - data.needsDoing.length)

  const counts = data.counts
  const lotTotal = counts.onLot || 1

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('dashboard.title')} />
      <p className="text-sm text-steel">{t('dashboard.intro')}</p>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={t('dashboard.kpi.cashTiedUp')} value={money ? formatMoney(money.investedRappen) : t('common.none')} sub={money ? t('dashboard.kpi.cashTiedUpSub') : restricted} />
        <Kpi label={t('dashboard.kpi.projectedProfit')} value={money ? formatMoney(money.projectedProfitRappen) : t('common.none')} sub={money ? t('dashboard.kpi.projectedProfitSub') : restricted} accent />
        <Kpi label={t('dashboard.kpi.onLot')} value={counts.onLot} sub={`${counts.reserved} ${t('status.reserved').toLowerCase()} · ${t('dashboard.kpi.onLotSub')}`} />
        <Kpi
          label={t('dashboard.kpi.soldThisYear')}
          value={data.soldThisYear.count}
          sub={data.soldThisYear.profitRappen != null ? `${t('dashboard.kpi.soldThisYearProfit')}: ${formatMoney(data.soldThisYear.profitRappen)}` : t('dashboard.kpi.soldThisYearSub')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card">
          <div className="border-b border-line px-4 py-3">
            <h3 className="panel-title">{t('dashboard.money.title')}</h3>
          </div>
          {money ? (
            <div className="flex flex-wrap items-center gap-6 p-4">
              <Ring segments={segments} centerLabel={t('dashboard.money.lotValue')} centerValue={formatMoney(money.askingRappen)} />
              <ul className="min-w-0 flex-1 space-y-2 text-sm">
                {segments.map((seg) => (
                  <li key={seg.key} className="flex items-center gap-2">
                    <span className="h-3 w-3 flex-none rounded-sm" style={{ background: seg.color }} />
                    <span className="flex-1 text-ink">{seg.label}</span>
                    <span className="num font-semibold text-ink">{formatMoney(seg.value)}</span>
                    <span className="num w-12 text-right text-xs text-steel">{((seg.value / segmentTotal) * 100).toFixed(1)} %</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="p-4 text-sm text-steel">{restricted}</p>
          )}
        </section>

        <section className="card">
          <div className="border-b border-line px-4 py-3">
            <h3 className="panel-title">{t('dashboard.cars.title')}</h3>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="flex h-9 w-full overflow-hidden rounded-lg bg-tint text-xs font-bold text-white">
                {counts.inStock > 0 && (
                  <div className="flex items-center justify-center bg-brand" style={{ width: `${(counts.inStock / lotTotal) * 100}%` }} title={t('status.in_stock')}>
                    {counts.inStock}
                  </div>
                )}
                {counts.reserved > 0 && (
                  <div className="flex items-center justify-center bg-brand-gold" style={{ width: `${(counts.reserved / lotTotal) * 100}%` }} title={t('status.reserved')}>
                    {counts.reserved}
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-steel">
                <span>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand" />
                  {t('status.in_stock')} <b className="text-ink">{counts.inStock}</b>
                </span>
                <span>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand-gold" />
                  {t('status.reserved')} <b className="text-ink">{counts.reserved}</b>
                </span>
                <span>
                  {t('dashboard.cars.soldThisYear')} <b className="text-ink">{data.soldThisYear.count}</b> · {t('status.written_off')} <b className="text-ink">{counts.writtenOff}</b>
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
              <div>
                <div className="num font-display text-2xl font-bold text-brand-deep">{data.inspection.expired.length + data.inspection.dueSoon.length}</div>
                <div className="text-xs font-semibold uppercase tracking-wider text-steel">{t('dashboard.cars.inspectionDue')}</div>
                <div className="text-xs text-steel">{t('dashboard.cars.inspectionDueSub')}</div>
              </div>
              <div>
                <div className="num font-display text-2xl font-bold text-brand-deep">{data.openJobs.open}</div>
                <div className="text-xs font-semibold uppercase tracking-wider text-steel">{t('dashboard.kpi.openJobs')}</div>
                <div className="text-xs text-steel">{data.openJobs.overdue > 0 ? t('dashboard.kpi.openJobsOverdue', { n: data.openJobs.overdue }) : t('dashboard.cars.nothingOverdue')}</div>
              </div>
              <div>
                <div className="num font-display text-2xl font-bold text-brand-deep">{data.ageing.length}</div>
                <div className="text-xs font-semibold uppercase tracking-wider text-steel">{t('dashboard.cars.ageing')}</div>
                <div className="text-xs text-steel">{data.ageing.length === 0 ? t('dashboard.cars.nothingStanding') : t('dashboard.cars.ageingSub')}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="panel-title">{t('dashboard.sections.needsDoing')}</h3>
          <span className="text-xs text-steel">{outstanding === 0 ? t('dashboard.allGood') : t('dashboard.outstanding', { n: outstanding })}</span>
        </div>
        {todos.length === 0 ? (
          <p className="p-4 text-sm text-mist">{t('dashboard.allGood')}</p>
        ) : (
          <ul className="divide-y divide-line px-1">
            {todos.map((item, i) => (
              <TodoRow key={i} item={item} />
            ))}
            {data.needsDoingTotal > data.needsDoing.length && <li className="py-2 pl-4 text-xs text-steel">{t('dashboard.moreItems', { n: data.needsDoingTotal - data.needsDoing.length })}</li>}
          </ul>
        )}
      </section>
    </div>
  )
}
