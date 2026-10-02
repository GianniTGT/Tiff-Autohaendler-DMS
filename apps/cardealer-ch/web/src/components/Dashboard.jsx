import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'

function Kpi({ label, value, sub }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function Section({ title, tone = 'gray', items, render, onOpen, total }) {
  const toneClass = { red: 'text-red-700', amber: 'text-amber-700', gray: 'text-gray-900' }[tone]
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className={`text-sm font-semibold mb-2 ${toneClass}`}>
        {title} {items.length > 0 && <span className="font-normal text-gray-500">({total ?? items.length})</span>}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('dashboard.allGood')}</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <button className="w-full text-left py-2 flex justify-between gap-3 text-sm hover:bg-gray-50" onClick={() => onOpen(item.id)}>
                <span className="text-gray-900">{item.label}</span>
                <span className="text-gray-500 text-right">{render(item)}</span>
              </button>
            </li>
          ))}
          {total != null && total > items.length && (
            <li className="pt-2 text-xs text-gray-500">{t('dashboard.moreItems', { n: total - items.length })}</li>
          )}
        </ul>
      )}
    </div>
  )
}

const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('de-CH')

export default function Dashboard({ onOpenVehicle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get('/api/dashboard')
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="text-red-600 p-6">{error}</p>
  if (!data) return <p className="p-6 text-gray-500">{t('common.loading')}</p>

  const restricted = t('dashboard.restricted')

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{t('dashboard.title')}</h2>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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

      <div className="grid lg:grid-cols-2 gap-4">
        <Section
          title={t('dashboard.sections.inspectionExpired')}
          tone="red"
          items={data.inspection.expired}
          onOpen={onOpenVehicle}
          render={(i) => `${formatDate(i.validUntil)} · ${t('dashboard.daysAgo', { n: -i.daysLeft })}`}
        />
        <Section
          title={t('dashboard.sections.inspectionDueSoon')}
          tone="amber"
          items={data.inspection.dueSoon}
          onOpen={onOpenVehicle}
          render={(i) => `${formatDate(i.validUntil)} · ${t('dashboard.daysLeft', { n: i.daysLeft })}`}
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
