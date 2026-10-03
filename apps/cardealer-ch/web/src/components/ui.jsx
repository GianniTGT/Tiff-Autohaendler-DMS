import { t } from '../i18n/index.js'

const TAG_TONES = {
  green: 'bg-profit-bg text-profit',
  amber: 'bg-warn-bg text-warn',
  red: 'bg-danger-bg text-danger',
  brand: 'bg-brand-wash text-brand',
  gray: 'bg-tint text-steel',
}

export function Tag({ tone = 'gray', children }) {
  return <span className={`tag ${TAG_TONES[tone]}`}>{children}</span>
}

export const VEHICLE_STATUS_TONE = { in_stock: 'green', reserved: 'amber', sold: 'brand', written_off: 'red' }

/** Seitenpanel von rechts — Detailansichten (Fahrzeug, Rechnung). */
export function Drawer({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-brand-deep/40" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-canvas shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line-strong bg-white px-6 py-4">
          <div>
            <h2 className="page-title">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-steel">{subtitle}</p>}
          </div>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="space-y-5 p-6">{children}</div>
      </div>
    </div>
  )
}

export function Panel({ title, children, actions }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

export function Notice({ tone = 'red', children }) {
  const cls = { red: 'bg-danger-bg text-danger', green: 'bg-profit-bg text-profit', amber: 'bg-warn-bg text-warn' }[tone]
  return <p className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</p>
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="page-title">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export const formatDay = (day) =>
  day ? new Date(`${String(day).slice(0, 10)}T00:00:00`).toLocaleDateString('de-CH') : t('common.none')

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Anzeigestatus eines Belegs der Kette: «abgelaufen» steht nicht in der Datenbank, sondern ergibt sich aus «gültig bis». */
export const salesState = (doc) => (doc.expired ? 'expired' : doc.status)
export const STATE_TONE = { issued: 'amber', accepted: 'green', declined: 'gray', expired: 'red', delivered: 'brand', invoiced: 'green', cancelled: 'gray' }
