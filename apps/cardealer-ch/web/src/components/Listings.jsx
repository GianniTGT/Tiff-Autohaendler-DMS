import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, Notice, formatDay } from './ui.jsx'

export default function Listings({ onOpenVehicle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null) // { text, tone }
  const [busyId, setBusyId] = useState(null)

  async function reload() {
    try {
      setData(await api.get('/api/listings'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function run(id, action) {
    setBusyId(id)
    setError(null)
    setMessage(null)
    try {
      const result = await action()
      setMessage(describeResult(result))
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Ein Push meldet die Fotos getrennt: die Fahrzeugdaten können oben sein, die Fotos aber nicht —
   * das soll nicht wie ein Fehlschlag des Ganzen aussehen, aber auch nicht wie «alles erledigt».
   */
  function describeResult(result) {
    const photos = result?.photos ?? (result?.status === 'synced' || result?.status === 'none' ? result : null)
    if (photos?.status === 'failed') return { text: t('listings.photosFailed', { error: photos.reason }), tone: 'amber' }
    if (photos?.status === 'synced') return { text: t('listings.photosDone', { uploaded: photos.uploaded, total: photos.total }), tone: 'green' }
    return { text: t('listings.done'), tone: 'green' }
  }

  if (!data) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('listings.title')} />
      <p className="max-w-3xl text-sm text-steel">{t('listings.intro')}</p>
      {!data.configured && <Notice tone="amber">{t('listings.notConfigured')}</Notice>}
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {data.rows.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('listings.empty')}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rows w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-3">{t('listings.cols.vehicle')}</th>
                <th className="p-3 text-right">{t('listings.cols.price')}</th>
                <th className="p-3">{t('listings.cols.state')}</th>
                <th className="p-3 text-right">{t('listings.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const state = row.listingId ? (row.active === true ? 'active' : row.active === false ? 'inactive' : 'listed') : row.ready ? 'notListed' : 'incomplete'
                const busy = busyId === row.id
                const post = (suffix) => () => run(row.id, () => api.post(`/api/vehicles/${row.id}/autoscout24/${suffix}`))
                return (
                  <tr key={row.id}>
                    <td className="p-3">
                      <button className="text-left font-semibold text-ink hover:underline" onClick={() => onOpenVehicle(row.id)}>
                        {[row.make, row.model].filter(Boolean).join(' ') || t('vehicle.unknown')}
                      </button>
                      <div className="font-mono text-xs text-steel">{row.vin}</div>
                    </td>
                    <td className="num p-3 text-right">{formatMoney(row.askingPriceRappen)}</td>
                    <td className="p-3">
                      <Tag tone={state === 'active' || state === 'listed' ? 'green' : state === 'incomplete' ? 'amber' : 'gray'}>{t(`listings.state.${state}`)}</Tag>
                      {row.soldStillListed && <div className="mt-1 text-xs font-semibold text-danger">{t('listings.soldStillListed')}</div>}
                      {row.lastError && <div className="mt-1 text-xs text-danger">{t('listings.lastError', { error: row.lastError })}</div>}
                      {row.syncedAt && <div className="mt-1 text-xs text-steel">{t('listings.syncedAt', { date: formatDay(row.syncedAt) })}</div>}
                      <div className={`mt-1 text-xs ${row.photos.pending ? 'text-warn' : 'text-steel'}`}>
                        {row.photos.total === 0
                          ? t('listings.photos.none')
                          : row.listingId
                            ? t('listings.photos.count', { total: row.photos.total, synced: row.photos.synced })
                            : t('listings.photos.local', { total: row.photos.total })}
                      </div>
                      {state === 'incomplete' && (
                        <div className="mt-1 text-xs text-warn">{t('listings.missing', { fields: row.missing.map((f) => t(`listings.fields.${f}`)).join(', ') })}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {state === 'incomplete' && (
                          <button className="btn-ghost" onClick={() => onOpenVehicle(row.id)}>
                            {t('listings.actions.edit')}
                          </button>
                        )}
                        {state !== 'incomplete' && row.status !== 'sold' && (
                          <button className="btn" disabled={busy || !data.configured} onClick={post('push')}>
                            {row.listingId ? t('listings.actions.update') : t('listings.actions.push')}
                          </button>
                        )}
                        {row.listingId && row.photos.pending && row.status !== 'sold' && (
                          <button className="btn" disabled={busy || !data.configured} onClick={post('photos')}>
                            {t('listings.actions.photos')}
                          </button>
                        )}
                        {row.listingId && (
                          <>
                            <button className="btn-ghost" disabled={busy || !data.configured || row.active === true || row.status === 'sold'} onClick={post('activate')}>
                              {t('listings.actions.activate')}
                            </button>
                            <button className={row.soldStillListed ? 'btn' : 'btn-ghost'} disabled={busy || !data.configured || row.active === false} onClick={post('deactivate')}>
                              {t('listings.actions.deactivate')}
                            </button>
                            <button
                              className="btn-ghost text-danger"
                              disabled={busy || !data.configured}
                              onClick={() => window.confirm(t('listings.confirmRemove')) && run(row.id, () => api.del(`/api/vehicles/${row.id}/autoscout24`))}
                            >
                              {t('listings.actions.remove')}
                            </button>
                          </>
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
