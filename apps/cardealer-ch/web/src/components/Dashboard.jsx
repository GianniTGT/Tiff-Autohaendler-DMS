import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, formatDay } from './ui.jsx'

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`card min-w-0 p-4 ${accent ? 'border-t-4 border-t-brand-gold' : 'border-t-4 border-t-brand'}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-steel">{label}</div>
      <div className="num mt-1 font-display text-2xl font-bold text-brand-deep sm:text-3xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-steel">{sub}</div>}
    </div>
  )
}

function Section({ title, tone = 'gray', items, render, onOpen, total }) {
  const toneClass = { red: 'text-danger', amber: 'text-warn', gray: 'text-brand' }[tone]
  return (
    <div className="card p-4">
      <h3 className={`font-display text-[15px] font-bold uppercase tracking-wider ${toneClass}`}>
        {title} {items.length > 0 && <span className="font-body text-sm font-normal text-steel">({total ?? items.length})</span>}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-mist">{t('dashboard.allGood')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>
              <button className="flex w-full justify-between gap-3 py-2 text-left text-sm hover:bg-tint" onClick={() => onOpen(item.id)}>
                <span className="font-semibold text-ink">{item.label}</span>
                <span className="text-right text-steel">{render(item)}</span>
              </button>
            </li>
          ))}
          {total != null && total > items.length && (
            <li className="pt-2 text-xs text-steel">{t('dashboard.moreItems', { n: total - items.length })}</li>
          )}
        </ul>
      )}
    </div>
  )
}

export default function Dashboard({ onOpenVehicle }) {
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

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('dashboard.title')} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label={t('dashboard.kpi.onLot')} value={data.counts.onLot} sub={`${data.counts.reserved} ${t('status.reserved').toLowerCase()}`} />
        <Kpi
          label={t('dashboard.kpi.cashTiedUp')}
          value={data.money ? formatMoney(data.money.investedRappen) : t('common.none')}
          sub={data.money ? null : restricted}
        />
        <Kpi
          label={t('dashboard.kpi.projectedProfit')}
          value={data.money ? formatMoney(data.money.projectedProfitRappen) : t('common.none')}
          sub={data.money ? null : restricted}
          accent
        />
        <Kpi
          label={t('dashboard.kpi.soldThisYear')}
          value={data.soldThisYear.count}
          sub={data.soldThisYear.profitRappen != null ? `${t('dashboard.kpi.soldThisYearProfit')}: ${formatMoney(data.soldThisYear.profitRappen)}` : null}
        />
        <Kpi
          label={t('dashboard.kpi.overdue')}
          value={data.overdueInvoices.count}
          sub={data.overdueInvoices.outstandingRappen != null ? formatMoney(data.overdueInvoices.outstandingRappen) : null}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title={t('dashboard.sections.inspectionExpired')}
          tone="red"
          items={data.inspection.expired}
          onOpen={onOpenVehicle}
          render={(i) => `${formatDay(i.validUntil)} · ${t('dashboard.daysAgo', { n: -i.daysLeft })}`}
        />
        <Section
          title={t('dashboard.sections.inspectionDueSoon')}
          tone="amber"
          items={data.inspection.dueSoon}
          onOpen={onOpenVehicle}
          render={(i) => `${formatDay(i.validUntil)} · ${t('dashboard.daysLeft', { n: i.daysLeft })}`}
        />
        <Section
          title={t('dashboard.sections.ageing')}
          items={data.ageing}
          onOpen={onOpenVehicle}
          render={(i) => t('dashboard.onLotDays', { n: i.days })}
        />
        <Section
          title={t('dashboard.sections.needsDoing')}
          items={data.needsDoing}
          total={data.needsDoingTotal}
          onOpen={onOpenVehicle}
          render={(i) => i.reasons.map((r) => t(`dashboard.reasons.${r}`)).join(', ')}
        />
      </div>
    </div>
  )
}
