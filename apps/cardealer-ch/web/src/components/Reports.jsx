import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, Panel, Notice, todayIso, formatDay } from './ui.jsx'

function Row({ label, value, strong, tone }) {
  const toneClass = tone === 'loss' ? 'text-danger' : tone === 'good' ? 'text-profit' : ''
  return (
    <div className={`flex justify-between py-1.5 text-sm ${strong ? 'border-t border-line-strong font-semibold text-brand-deep' : ''}`}>
      <span className={strong ? '' : 'text-steel'}>{label}</span>
      <span className={`num ${toneClass}`}>{value}</span>
    </div>
  )
}

function RangeForm({ range, setRange, onSubmit, busy }) {
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <label>
        <span className="field-label">{t('reports.from')}</span>
        <input required type="date" className="field" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      </label>
      <label>
        <span className="field-label">{t('reports.to')}</span>
        <input required type="date" className="field" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </label>
      <button type="submit" disabled={busy} className="btn">
        {t('reports.run')}
      </button>
    </form>
  )
}

function VatReport({ initialRange }) {
  const [range, setRange] = useState(initialRange)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setReport(await api.get(`/api/reports/vat?from=${range.from}&to=${range.to}`))
    } catch (err) {
      setReport(null)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('reports.vat')}>
      <RangeForm range={range} setRange={setRange} onSubmit={run} busy={busy} />
      {error && (
        <div className="mt-3">
          <Notice>{error.includes('vat_method') ? t('reports.notConfigured') : error}</Notice>
        </div>
      )}
      {report && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-steel">{t(`reports.method.${report.method}`)}</p>
          <Row label={t('reports.revenue')} value={formatMoney(report.totalRevenueRappen)} />
          {report.creditTotalRappen > 0 && <Row label={t('reports.credits')} value={`− ${formatMoney(report.creditTotalRappen)}`} />}
          {report.method === 'effective' && (
            <>
              <Row label={t('reports.outputTax')} value={formatMoney(report.outputTaxRappen)} />
              {report.creditVatRappen > 0 && <Row label={t('reports.creditVat')} value={`− ${formatMoney(report.creditVatRappen)}`} />}
              <Row label={t('reports.notional')} value={`− ${formatMoney(report.notionalInputTaxRappen)}`} />
            </>
          )}
          <Row strong label={t('reports.payable')} value={formatMoney(report.payableRappen)} />
          <div className="mt-3">
            <Notice tone="amber">{t('reports.disclaimer')}</Notice>
          </div>
        </div>
      )}
    </Panel>
  )
}

function SalesReport({ initialRange, onOpenVehicle }) {
  const [range, setRange] = useState(initialRange)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load(r) {
    setBusy(true)
    setError(null)
    try {
      setReport(await api.get(`/api/reports/sales?from=${r.from}&to=${r.to}`))
    } catch (err) {
      setReport(null)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load(initialRange)
  }, [])

  const profitTone = (v) => (v == null ? undefined : v < 0 ? 'loss' : 'good')

  return (
    <Panel title={t('reports.sales.title')}>
      <RangeForm
        range={range}
        setRange={setRange}
        onSubmit={(e) => {
          e.preventDefault()
          load(range)
        }}
        busy={busy}
      />
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
      {report && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t('reports.sales.sold'), report.totals.sold],
              [t('reports.sales.revenue'), formatMoney(report.totals.revenueRappen)],
              [t('reports.sales.profit'), formatMoney(report.totals.profitRappen)],
              [t('reports.sales.margin'), report.totals.marginPct == null ? t('common.none') : `${report.totals.marginPct} %`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-tint p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-steel">{label}</div>
                <div className="num font-display text-xl font-bold text-brand-deep">{value}</div>
              </div>
            ))}
          </div>
          {report.totals.avgDaysInStock != null && (
            <p className="mt-2 text-xs text-steel">{t('reports.sales.avgDays', { n: report.totals.avgDaysInStock })}</p>
          )}
          {report.totals.notComputable > 0 && <p className="mt-1 text-xs text-warn">{t('reports.sales.notComputable', { n: report.totals.notComputable })}</p>}

          {report.rows.length === 0 ? (
            <p className="mt-3 text-sm text-steel">{t('reports.sales.empty')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="rows w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="p-2">{t('reports.sales.cols.vehicle')}</th>
                    <th className="p-2">{t('reports.sales.cols.soldAt')}</th>
                    <th className="p-2 text-right">{t('reports.sales.cols.days')}</th>
                    <th className="p-2 text-right">{t('reports.sales.cols.price')}</th>
                    <th className="p-2 text-right">{t('reports.sales.cols.invested')}</th>
                    <th className="p-2 text-right">{t('reports.sales.cols.profit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => onOpenVehicle?.(r.id)}>
                      <td className="p-2 font-semibold text-ink">{r.label}</td>
                      <td className="p-2">{formatDay(r.soldAt)}</td>
                      <td className="num p-2 text-right">{r.daysInStock ?? t('common.none')}</td>
                      <td className="num p-2 text-right">{formatMoney(r.soldPriceRappen)}</td>
                      <td className="num p-2 text-right">{r.purchasePriceRappen == null ? t('common.none') : formatMoney(r.purchasePriceRappen + r.costsRappen)}</td>
                      <td className={`num p-2 text-right font-semibold ${profitTone(r.profitRappen) === 'loss' ? 'text-danger' : profitTone(r.profitRappen) === 'good' ? 'text-profit' : ''}`}>
                        {r.profitRappen == null ? t('common.none') : `${formatMoney(r.profitRappen)} (${r.marginPct} %)`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function StockReport({ onOpenVehicle }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get('/api/reports/stock')
      .then(setReport)
      .catch((err) => setError(err.message))
  }, [])

  const maxInvested = report ? Math.max(1, ...report.buckets.map((b) => b.investedRappen)) : 1

  return (
    <Panel title={t('reports.stock.title')}>
      {error && <Notice>{error}</Notice>}
      {!report ? (
        !error && <p className="text-sm text-steel">{t('common.loading')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-steel">
            {t('reports.stock.total', { count: report.total.count, amount: formatMoney(report.total.investedRappen) })}
          </p>
          <ul className="space-y-2">
            {report.buckets.map((b) => (
              <li key={b.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                <span className="text-steel">{t(`reports.stock.buckets.${b.key}`)}</span>
                <div className="h-4 overflow-hidden rounded bg-tint">
                  <div className={`h-full ${b.key === 'd91_plus' ? 'bg-danger' : b.key === 'd61_90' ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${(b.investedRappen / maxInvested) * 100}%` }} />
                </div>
                <span className="num whitespace-nowrap">
                  {b.count} · {formatMoney(b.investedRappen)}
                </span>
              </li>
            ))}
          </ul>
          {report.oldest.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-steel">{t('reports.stock.oldest')}</h4>
              <ul className="mt-1 divide-y divide-line text-sm">
                {report.oldest.map((r) => (
                  <li key={r.id}>
                    <button className="flex w-full justify-between py-1.5 text-left hover:bg-tint" onClick={() => onOpenVehicle?.(r.id)}>
                      <span className="font-semibold text-ink">{r.label}</span>
                      <span className="text-steel">{t('dashboard.onLotDays', { n: r.days })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

export default function Reports({ onOpenVehicle }) {
  const year = todayIso().slice(0, 4)
  const initialRange = { from: `${year}-01-01`, to: todayIso() }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('reports.title')} />
      <SalesReport initialRange={initialRange} onOpenVehicle={onOpenVehicle} />
      <StockReport onOpenVehicle={onOpenVehicle} />
      <VatReport initialRange={initialRange} />
    </div>
  )
}
