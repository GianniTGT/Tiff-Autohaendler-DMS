import { useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, Panel, Notice, todayIso } from './ui.jsx'

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between py-1.5 text-sm ${strong ? 'border-t border-line-strong font-semibold text-brand-deep' : ''}`}>
      <span className={strong ? '' : 'text-steel'}>{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}

export default function Reports() {
  const year = todayIso().slice(0, 4)
  const [range, setRange] = useState({ from: `${year}-01-01`, to: todayIso() })
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
    <div className="space-y-4 p-6">
      <PageHeader title={t('reports.title')} />
      <Panel title={t('reports.vat')}>
        <form onSubmit={run} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
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

        {error && (
          <div className="mt-3">
            <Notice>{error.includes('vat_method') ? t('reports.notConfigured') : error}</Notice>
          </div>
        )}

        {report && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-steel">{t(`reports.method.${report.method}`)}</p>
            <Row label={t('reports.revenue')} value={formatMoney(report.totalRevenueRappen)} />
            {report.method === 'effective' && (
              <>
                <Row label={t('reports.outputTax')} value={formatMoney(report.outputTaxRappen)} />
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
    </div>
  )
}
