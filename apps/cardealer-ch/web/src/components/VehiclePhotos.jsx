import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { Panel, Notice, Tag } from './ui.jsx'

export default function VehiclePhotos({ vehicleId, onChanged }) {
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  async function load() {
    try {
      setPhotos(await api.get(`/api/vehicles/${vehicleId}/photos`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [vehicleId])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function upload(event) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    // Eines nach dem anderen: so bleibt die Reihenfolge der Auswahl und ein
    // Fehlschlag bei Foto 7 verwirft nicht die ersten sechs.
    for (const [i, file] of files.entries()) {
      setProgress({ n: i + 1, total: files.length })
      try {
        await api.upload(`/api/vehicles/${vehicleId}/photos`, file)
      } catch (err) {
        setError(`${file.name}: ${err.message}`)
        break
      }
    }
    setProgress(null)
    await load()
    onChanged?.()
    setBusy(false)
  }

  return (
    <Panel
      title={t('vehicle.detail.sections.photos')}
      actions={
        <>
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {t('vehicle.detail.photos.add')}
          </button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {progress && <p className="mb-2 text-sm text-steel">{t('vehicle.detail.photos.uploading', progress)}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-steel">{t('vehicle.detail.photos.empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-line-strong bg-white">
              <div className="relative aspect-[4/3] bg-tint">
                <img src={`/api/vehicles/${vehicleId}/photos/${p.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                {p.isCover && (
                  <span className="absolute left-1.5 top-1.5">
                    <Tag tone="brand">{t('vehicle.detail.photos.cover')}</Tag>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1 p-1.5 text-xs">
                <span className="flex gap-1">
                  <button className="rounded border border-line-strong px-1.5 py-0.5 hover:border-brand disabled:opacity-30" disabled={busy || i === 0} title={t('vehicle.detail.photos.left')} onClick={() => run(() => api.post(`/api/vehicles/${vehicleId}/photos/${p.id}/move`, { direction: -1 }))}>
                    ←
                  </button>
                  <button className="rounded border border-line-strong px-1.5 py-0.5 hover:border-brand disabled:opacity-30" disabled={busy || i === photos.length - 1} title={t('vehicle.detail.photos.right')} onClick={() => run(() => api.post(`/api/vehicles/${vehicleId}/photos/${p.id}/move`, { direction: 1 }))}>
                    →
                  </button>
                </span>
                <span className="flex gap-2">
                  {!p.isCover && (
                    <button className="text-brand underline" disabled={busy} onClick={() => run(() => api.post(`/api/vehicles/${vehicleId}/photos/${p.id}/cover`))}>
                      {t('vehicle.detail.photos.makeCover')}
                    </button>
                  )}
                  <button className="text-danger underline" disabled={busy} onClick={() => run(() => api.del(`/api/vehicles/${vehicleId}/photos/${p.id}`))}>
                    {t('vehicle.detail.photos.remove')}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-steel">{t('vehicle.detail.photos.hint')}</p>
    </Panel>
  )
}
