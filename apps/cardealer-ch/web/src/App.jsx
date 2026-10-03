import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Dialog, VendorFooter } from './components/ui.jsx'
import { t } from './i18n/index.js'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'
import VehicleList from './components/VehicleList.jsx'
import VehicleDetail from './components/VehicleDetail.jsx'
import CustomerList from './components/CustomerList.jsx'
import InvoiceList from './components/InvoiceList.jsx'
import Sales from './components/Sales.jsx'
import Workshop from './components/Workshop.jsx'
import Calendar from './components/Calendar.jsx'
import InvoiceDetail from './components/InvoiceDetail.jsx'
import Leads from './components/Leads.jsx'
import Listings from './components/Listings.jsx'
import Users from './components/Users.jsx'
import Archive from './components/Archive.jsx'
import Help from './components/Help.jsx'
import Reports from './components/Reports.jsx'
import Settings from './components/Settings.jsx'
import lockup from './assets/tiff-lockup-horizontal.png'

/** Menü-Symbole: schlichte Strichzeichnungen, 24er-Raster, erben die Textfarbe. */
const ICONS = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  inventory: 'M5 17h14M5 17l-1 1v2h2v-1M19 17l1 1v2h-2v-1M4 17V11l2.5-5h11L20 11v6M7 14h2M15 14h2M4 11h16',
  listings: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  leads: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  customers: 'M3 5h18v14H3zM7 14a2.5 2.5 0 1 1 5 0M9.5 9.5a1.5 1.5 0 1 0 0 .01M14 9h4M14 13h4',
  sales: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h8',
  invoices: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8M8 16h5',
  recon: 'M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7zM4 20l4-4',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  archive: 'M3 4h18v4H3zM4 8h16v12H4zM10 12h4',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6',
  help: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM9 7h7M9 11h5',
}
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={ICONS[name] ?? ICONS.dashboard} />
  </svg>
)

/** Das Tiff-T als Strichmarke in Weiss — fürs Grün der Seitenleiste, wo das farbige PNG nicht passt. */
const TiffMark = ({ className = '' }) => (
  <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
    <path d="M16 14h68v22H60v50H40V36H16z" fill="currentColor" />
    <path d="M24 24h20a10 10 0 0 1 10 10v44" fill="none" stroke="#C9A053" strokeWidth="6" strokeLinecap="square" />
  </svg>
)

// Wer Firmenzahlen sieht, steht in packages/core-auth/src/roles.js
// (canSeeCompanyTotals). Hier nur die Menü-Sicht; der Server prüft selbst.
const SEES_TOTALS = ['inhaber', 'buchhaltung']
// Rechnungswesen, Verträge und Archiv: nicht die Werkstatt (roles.js: canBill)
const NO_BILLING = ['werkstatt']

const TABS = [
  { key: 'dashboard', label: 'nav.dashboard', Screen: Dashboard },
  { key: 'inventory', label: 'nav.inventory', Screen: VehicleList },
  { key: 'listings', label: 'nav.listings', Screen: Listings },
  { key: 'leads', label: 'nav.leads', Screen: Leads },
  { key: 'customers', label: 'nav.customers', Screen: CustomerList },
  { key: 'sales', label: 'nav.sales', Screen: Sales, billingOnly: true },
  { key: 'invoices', label: 'documents.invoices.title', Screen: InvoiceList, billingOnly: true },
  { key: 'recon', label: 'nav.recon', Screen: Workshop },
  { key: 'calendar', label: 'nav.calendar', Screen: Calendar },
  { key: 'archive', label: 'nav.archive', Screen: Archive, billingOnly: true },
  { key: 'reports', label: 'nav.reports', Screen: Reports, totalsOnly: true },
  { key: 'settings', label: 'nav.settings', Screen: Settings },
  { key: 'users', label: 'nav.users', Screen: Users, ownerOnly: true },
  { key: 'help', label: 'nav.help', Screen: Help },
]

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = wird geprüft, null = abgemeldet
  const [tab, setTab] = useState('dashboard')
  const [openVehicleId, setOpenVehicleId] = useState(null)
  const [openInvoiceId, setOpenInvoiceId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [company, setCompany] = useState(null)
  const [about, setAbout] = useState(null) // 'about' | 'support' | null

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
  }, [])

  // Sitzung abgelaufen oder gesperrt (api.js meldet jedes 401): zurück zur Anmeldung.
  useEffect(() => {
    const onExpired = () => {
      setSession(null)
      setCompany(null)
      setOpenVehicleId(null)
      setOpenInvoiceId(null)
    }
    window.addEventListener('tiff:session-expired', onExpired)
    return () => window.removeEventListener('tiff:session-expired', onExpired)
  }, [])

  useEffect(() => {
    if (!session) return
    api
      .get('/api/tenant')
      .then((tenant) => setCompany({ name: tenant.name, hasLogo: tenant.hasLogo, version: Date.now() }))
      .catch(() => {})
  }, [session, refreshKey])

  async function handleLogout() {
    await api.post('/api/auth/logout')
    setSession(null)
    setTab('dashboard')
    // Sonst zeigt die nächste Anmeldung (anderer Betrieb) kurz das alte Logo und fragt es mit alter Version ab (404).
    setCompany(null)
  }

  if (session === undefined) {
    return <p className="p-6 text-steel">{t('common.loading')}</p>
  }
  if (session === null) {
    return <Login onLoggedIn={setSession} />
  }

  const tabs = TABS.filter((x) => (!x.totalsOnly || SEES_TOTALS.includes(session.role)) && (!x.ownerOnly || session.role === 'inhaber') && (!x.billingOnly || !NO_BILLING.includes(session.role)))
  const active = tabs.find((x) => x.key === tab) ?? tabs[0]
  const Screen = active.Screen

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="relative flex min-w-0 flex-col overflow-hidden bg-brand py-5 text-on-brand lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        {/* Kopf wie im Manager: Produktname in Weiss direkt auf dem Grün, darunter die Marke des Herstellers. */}
        <div className="px-5">
          <b className="block font-display text-[21px] font-bold uppercase leading-tight tracking-wide text-on-brand-pure">{t('app.name')}</b>
          <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[2px] text-on-brand-dim">
            <TiffMark className="h-3.5 w-3.5 text-on-brand-pure" />
            {t('app.vendor')}
          </span>
        </div>

        {/* Der Betrieb: weisse Karte mit Name und Logo — das Einzige in der Seitenleiste, das nicht grün ist. */}
        {company && (
          <div className="mx-4 mb-4 mt-5 rounded-tiff bg-white px-3 py-2.5 text-ink">
            <small className="block text-[10px] font-semibold uppercase tracking-[2px] text-brand-gold">{t('app.company')}</small>
            <b className="block text-sm font-semibold leading-snug">{company.name}</b>
            {company.hasLogo && (
              <img src={`/api/tenant/logo?v=${company.version}`} alt="" className="mt-2 max-h-14 w-full rounded border border-line object-contain p-1" />
            )}
          </div>
        )}

        <nav className="relative z-10 flex flex-row gap-1 overflow-x-auto px-3 lg:flex-col lg:overflow-visible">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left font-display text-[16px] font-semibold uppercase tracking-wide transition-colors ${
                active.key === key
                  ? 'bg-brand-dark text-on-brand-pure shadow-[inset_3px_0_0_0_#C9A053]'
                  : 'text-on-brand hover:bg-brand-dark/60'
              }`}
            >
              <Icon name={key} />
              {t(label)}
            </button>
          ))}
        </nav>

        {/* Wasserzeichen: das Tiff-T, schwach, unten in der Leiste — wie im Manager. */}
        <TiffMark className="pointer-events-none absolute -bottom-10 -left-6 hidden h-56 w-56 text-white/[0.06] lg:block" />

        <div className="relative z-10 mt-auto hidden px-5 pt-6 text-sm text-on-brand-dim lg:block">
          <div>
            <b className="text-on-brand-pure">{session.name || t('app.signedInAs')}</b> · {t(`roles.${session.role}`)}
          </div>
          <div className="mt-1 flex gap-3">
            <button onClick={handleLogout} className="underline hover:text-on-brand-pure">
              {t('app.signOut')}
            </button>
            <button onClick={() => setAbout('about')} className="underline hover:text-on-brand-pure">
              {t('app.footer.about')}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-line-strong bg-white px-6 py-2 text-sm text-steel lg:hidden">
          <span>
            {t('app.signedInAs')}: {t(`roles.${session.role}`)}
          </span>
          <button onClick={handleLogout} className="text-brand underline">
            {t('app.signOut')}
          </button>
        </header>
        <main className="relative flex-1">
          {/* Logo des Betriebs als Wasserzeichen unten rechts, wie im Manager — nur wenn eines hinterlegt ist. */}
          {company?.hasLogo && (
            <img src={`/api/tenant/logo?v=${company.version}`} alt="" aria-hidden="true" className="pointer-events-none absolute bottom-4 right-4 hidden max-h-24 max-w-[180px] object-contain opacity-15 grayscale lg:block" />
          )}
          <Screen
            key={`${active.key}-${refreshKey}`}
            role={session.role}
            userId={session.userId}
            onOpenVehicle={setOpenVehicleId}
            onOpenInvoice={setOpenInvoiceId}
            onNavigate={setTab}
            onSettingsChanged={() => setRefreshKey((k) => k + 1)}
          />
        </main>
        <VendorFooter onAbout={() => setAbout('about')} onSupport={() => setAbout('support')} />
        {about && (
          <Dialog size="small" title={t(`app.footer.${about}Title`)} onClose={() => setAbout(null)}>
            {/* Wie «About» im Manager: Marke, Produkt, Version, Hilfe-Kasten, Kontakt. */}
            <div className="space-y-5 text-center">
              <img src={lockup} alt={t('app.vendor')} className="mx-auto h-16 w-auto" />
              <div>
                <div className="font-display text-xl font-bold uppercase tracking-wide text-brand">{t('app.name')}</div>
                <div className="text-sm text-steel">{t('app.footer.version', { version: __APP_VERSION__ })}</div>
              </div>
              <div className="card space-y-3 p-4 text-left">
                <p className="text-sm text-ink">{t(`app.footer.${about}Body`)}</p>
                <a
                  className="btn-ghost"
                  href={`mailto:${t('app.footer.email')}?subject=${encodeURIComponent(`${t('app.name')} ${__APP_VERSION__} — ${company?.name ?? ''}`)}`}
                >
                  {t('app.footer.writeSupport')}
                </a>
              </div>
              <div className="space-y-1 text-sm">
                <div className="font-semibold text-ink">{t('app.vendor')}</div>
                <div className="text-steel">
                  {t('app.footer.supportLabel')}:{' '}
                  <a className="font-mono text-ink hover:underline" href={`mailto:${t('app.footer.email')}`}>
                    {t('app.footer.email')}
                  </a>
                </div>
                <div className="text-steel">
                  {t('app.footer.phoneLabel')}:{' '}
                  <a className="font-mono text-ink hover:underline" href={`tel:${t('app.footer.phone').replace(/\s+/g, '')}`}>
                    {t('app.footer.phone')}
                  </a>
                </div>
                <a className="font-mono text-brand underline" href={`https://${t('app.footer.website')}`} target="_blank" rel="noreferrer">
                  {t('app.footer.website')}
                </a>
              </div>
            </div>
          </Dialog>
        )}
      </div>

      {openInvoiceId && (
        <InvoiceDetail
          invoiceId={openInvoiceId}
          role={session.role}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {openVehicleId && (
        <VehicleDetail
          vehicleId={openVehicleId}
          role={session.role}
          onClose={() => setOpenVehicleId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
