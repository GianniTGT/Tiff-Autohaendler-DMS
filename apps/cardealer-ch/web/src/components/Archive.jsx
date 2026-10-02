import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, Notice, formatDay } from './ui.jsx'

const FILTERS = ['all', 'invoice', 'reminder', 'sale_contract', 'purchase_contract', 'open']

/** PDF-Adresse je Belegart: Rechnungen und Mahnungen haben eigene Wege, Verträge kommen aus dem Archiv. */
const pdfUrl = (row) =>
  row.type === 'invoice' ? `/api/invoices/${row.id}/pdf` : row.type === 'reminder' ? `/api/reminders/${row.id}/pdf` : `/api/documents/${row.id}/pdf`

const SEES_TOTALS = ['inhaber', 'buchhaltung']

export default function Archive({ role }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState(null)
  const [results, setResults] = useState({})
  const [busyId, setBusyId] = useState(null)

  async function reload() {
    try {
      setRows(await api.get('/api/archive'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function verify(row) {
    setBusyId(row.id)
    try {
      const result = await api.get(`/api/documents/${row.id}/verify`)
      setResults((r) => ({ ...r, [row.id]: result }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  /** Das PDF abzurufen archiviert es beim ersten Mal (routes/invoices.js) — hier ohne es zu öffnen. */
  async function archiveNow(row) {
    setBusyId(row.id)
    try {
      const response = await fetch(pdfUrl(row), { credentials: 'include' })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!rows) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  const visible = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? !r.archived : r.type === filter))

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('archive.title')}>
        {SEES_TOTALS.includes(role) && (
          <a className="btn" href="/api/archive/export.zip" download title={t('archive.exportHint')}>
            {t('archive.export')}
          </a>
        )}
      </PageHeader>
      <p className="max-w-3xl text-sm text-steel">{t('archive.intro')}</p>
      {error && <Notice>{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === f ? 'bg-brand text-white' : 'border border-line-strong bg-white text-steel hover:text-brand'}`}
          >
            {t(`archive.filter.${f}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('archive.empty')}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rows w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">{t('archive.cols.number')}</th>
                <th className="p-3">{t('archive.cols.type')}</th>
                <th className="p-3">{t('archive.cols.date')}</th>
                <th className="p-3">{t('archive.cols.party')}</th>
                <th className="p-3">{t('archive.cols.state')}</th>
                <th className="p-3">{t('archive.cols.retain')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const result = results[row.id]
                return (
                  <tr key={row.id} className="align-top">
                    <td className="p-3 font-semibold text-ink">{row.number}</td>
                    <td className="p-3">
                      {t(`archive.types.${row.type}`)}
                      {row.vehicleLabel && <div className="text-xs text-steel">{row.vehicleLabel}</div>}
                    </td>
                    <td className="p-3">{formatDay(row.issueDate)}</td>
                    <td className="p-3">{row.partyName ?? t('common.none')}</td>
                    <td className="p-3">
                      <Tag tone={row.archived ? 'green' : 'amber'}>{row.archived ? t('archive.state.archived') : t('archive.state.notArchived')}</Tag>
                      {row.hash && <div className="mt-1 break-all font-mono text-[10px] text-mist" title={t('archive.hash')}>{row.hash.slice(0, 16)}…</div>}
                      {result && (
                        <div className={`mt-1 text-xs font-semibold ${result.ok ? 'text-profit' : 'text-danger'}`}>
                          {result.ok ? t('archive.verify.ok') : t(`archive.verify.${result.reason}`)}
                        </div>
                      )}
                    </td>
                    <td className="p-3">{formatDay(row.retainUntil)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {row.archived ? (
                          <>
                            <button className="btn-ghost" disabled={busyId === row.id} onClick={() => verify(row)}>
                              {t('archive.actions.verify')}
                            </button>
                            <a className="btn-ghost" href={pdfUrl(row)} target="_blank" rel="noreferrer">
                              {t('archive.actions.pdf')}
                            </a>
                          </>
                        ) : (
                          <button className="btn" disabled={busyId === row.id} onClick={() => archiveNow(row)}>
                            {t('archive.actions.archive')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
