import { useEffect } from 'react'
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

/**
 * Detailfenster — zentriert und so gross wie der Bildschirm erlaubt, damit möglichst alles auf einmal
 * sichtbar ist, statt als schmales Seitenpanel. `columns={2}` setzt die Kinder zweispaltig (ab xl, gleich
 * hoch aufgeteilt); ein Kind mit `xl:[column-span:all]` nimmt die ganze Breite (Hinweise, Kopfzeile). Escape und Klick auf den
 * Hintergrund schliessen.
 */
export function Dialog({ title, subtitle, onClose, children, columns = 1 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-brand-deep/50 p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[96vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-tiff bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-strong bg-white px-6 py-4">
          <div className="min-w-0">
            <h2 className="page-title">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-steel">{subtitle}</p>}
          </div>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {/* Zwei Spalten als Mehrspaltensatz: die Kästen füllen beide Spalten gleich hoch, in Lesereihenfolge. */}
        <div className={`flex-1 overflow-y-auto p-5 ${columns === 2 ? 'xl:columns-2 xl:gap-5 [&>*]:mb-5 [&>*]:break-inside-avoid' : 'space-y-5'}`}>{children}</div>
      </div>
    </div>
  )
}

export function Panel({ title, children, actions, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

export function Notice({ tone = 'red', children, className = '' }) {
  const cls = { red: 'bg-danger-bg text-danger', green: 'bg-profit-bg text-profit', amber: 'bg-warn-bg text-warn' }[tone]
  return <p className={`rounded-lg px-3 py-2 text-sm ${cls} ${className}`}>{children}</p>
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="page-title">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/** Fusszeile des Herstellers — auf jeder Seite dieselbe Linie: Firma, Über uns, Support, E-Mail, Telefon. */
export function VendorFooter({ onAbout, onSupport, className = '' }) {
  const phone = t('app.footer.phone')
  const email = t('app.footer.email')
  return (
    <footer className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line bg-white px-6 py-3 text-xs text-steel ${className}`}>
      <span>
        © {new Date().getFullYear()} {t('app.vendor')} · {t('app.footer.place')}
      </span>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <button type="button" className="hover:text-brand hover:underline" onClick={onAbout}>
          {t('app.footer.about')}
        </button>
        <button type="button" className="hover:text-brand hover:underline" onClick={onSupport}>
          {t('app.footer.support')}
        </button>
        <a className="hover:text-brand hover:underline" href={`mailto:${email}`}>
          {email}
        </a>
        {phone && phone !== 'app.footer.phone' && (
          <a className="hover:text-brand hover:underline" href={`tel:${phone.replace(/\s+/g, '')}`}>
            {t('app.footer.phoneLabel')} {phone}
          </a>
        )}
      </nav>
    </footer>
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

/**
 * Angebotspreise sind brutto (inkl. MWST), Rechnungs- und Belegpositionen netto. Rechnet einen Bruttopreis in Rappen
 * mit dem Normalsatz (z. B. 8.1) in einen Nettopreis in Franken-Schreibweise um ("1000.00"); ohne bekannten Satz bleibt
 * der Betrag unverändert.
 */
export function netPriceText(grossRappen, vatPercent) {
  if (grossRappen == null) return ''
  const net = vatPercent ? Math.round(Number(grossRappen) / (1 + vatPercent / 100)) : Number(grossRappen)
  return (net / 100).toFixed(2)
}

/**
 * Text und Ton zur automatischen Inserat-Abschaltung beim Verkauf (Antwort `listing` des Servers).
 * `deactivated`: erledigt. `failed`: der Verkauf steht, aber das Inserat läuft vielleicht noch — Warnung mit Grund.
 * `none`/`already`: nichts zu melden.
 */
export function listingNotice(listing) {
  if (listing?.status === 'deactivated') return { tone: 'green', key: 'listing.deactivated' }
  if (listing?.status === 'failed') return { tone: 'amber', key: 'listing.failed', vars: { reason: listing.reason ?? '' } }
  return null
}
