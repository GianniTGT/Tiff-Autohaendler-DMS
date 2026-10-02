import { useEffect, useState } from 'react'
import { api } from './api.js'
import { t } from './i18n/index.js'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'
import VehicleList from './components/VehicleList.jsx'
import VehicleDetail from './components/VehicleDetail.jsx'
import CustomerList from './components/CustomerList.jsx'
import InvoiceList from './components/InvoiceList.jsx'
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

// Wer Firmenzahlen sieht, steht in packages/core-auth/src/roles.js
// (canSeeCompanyTotals). Hier nur die Menü-Sicht; der Server prüft selbst.
const SEES_TOTALS = ['inhaber', 'buchhaltung']

const TABS = [
  { key: 'dashboard', label: 'nav.dashboard', Screen: Dashboard },
  { key: 'inventory', label: 'nav.inventory', Screen: VehicleList },
  { key: 'listings', label: 'nav.listings', Screen: Listings },
  { key: 'leads', label: 'nav.leads', Screen: Leads },
  { key: 'customers', label: 'nav.customers', Screen: CustomerList },
  { key: 'invoices', label: 'documents.invoices.title', Screen: InvoiceList },
  { key: 'recon', label: 'nav.recon', Screen: Workshop },
  { key: 'calendar', label: 'nav.calendar', Screen: Calendar },
  { key: 'archive', label: 'nav.archive', Screen: Archive },
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

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
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
  }

  if (session === undefined) {
    return <p className="p-6 text-steel">{t('common.loading')}</p>
  }
  if (session === null) {
    return <Login onLoggedIn={setSession} />
  }

  const tabs = TABS.filter((x) => (!x.totalsOnly || SEES_TOTALS.includes(session.role)) && (!x.ownerOnly || session.role === 'inhaber'))
  const active = tabs.find((x) => x.key === tab) ?? tabs[0]
  const Screen = active.Screen

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col bg-brand py-5 text-on-brand lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="mx-4 mb-4 rounded-tiff bg-white px-3 py-2.5">
          <img src={lockup} alt={t('app.vendor')} className="h-10 w-auto" />
        </div>
        {company && (
          <div className="mb-3 border-b border-white/15 px-5 pb-4">
            {company.hasLogo && (
              <img src={`/api/tenant/logo?v=${company.version}`} alt="" className="mb-2 max-h-12 max-w-[120px] rounded bg-white/95 object-contain p-1" />
            )}
            <small className="block text-[11px] uppercase tracking-[2.5px] text-on-brand-dim">{company.name}</small>
            <b className="block font-display text-xl font-bold uppercase tracking-wide text-on-brand-pure">{t('app.name')}</b>
          </div>
        )}
        <nav className="flex flex-row gap-1 overflow-x-auto px-3 lg:flex-col lg:overflow-visible">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left font-display text-[17px] font-semibold uppercase tracking-wide transition-colors ${
                active.key === key
                  ? 'bg-brand-dark text-on-brand-pure shadow-[inset_3px_0_0_0_#C9A053]'
                  : 'text-on-brand hover:bg-brand-dark/60'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden px-5 pt-6 text-sm text-on-brand-dim lg:block">
          <div>
            {t('app.signedInAs')}: <b className="text-on-brand-pure">{t(`roles.${session.role}`)}</b>
          </div>
          <button onClick={handleLogout} className="mt-1 underline hover:text-on-brand-pure">
            {t('app.signOut')}
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-end gap-3 border-b border-line-strong bg-white px-6 py-2 text-sm text-steel lg:hidden">
          <span>
            {t('app.signedInAs')}: {t(`roles.${session.role}`)}
          </span>
          <button onClick={handleLogout} className="text-brand underline">
            {t('app.signOut')}
          </button>
        </header>
        <main>
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
      </div>

      {openInvoiceId && (
        <InvoiceDetail
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {openVehicleId && (
        <VehicleDetail
          vehicleId={openVehicleId}
          onClose={() => setOpenVehicleId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
