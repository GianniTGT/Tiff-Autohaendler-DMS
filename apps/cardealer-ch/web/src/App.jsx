import { useEffect, useState } from 'react'
import { api } from './api.js'
import { t } from './i18n/index.js'
import Login from './components/Login.jsx'
import VehicleList from './components/VehicleList.jsx'
import CustomerList from './components/CustomerList.jsx'
import InvoiceList from './components/InvoiceList.jsx'

const TABS = [
  { key: 'inventory', label: 'nav.inventory', Screen: VehicleList },
  { key: 'customers', label: 'nav.customers', Screen: CustomerList },
  { key: 'invoices', label: 'documents.invoices.title', Screen: InvoiceList },
]

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = wird geprüft, null = abgemeldet
  const [tab, setTab] = useState('inventory')

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
  }, [])

  async function handleLogout() {
    await api.post('/api/auth/logout')
    setSession(null)
  }

  if (session === undefined) {
    return <p className="p-6 text-gray-500">{t('common.loading')}</p>
  }

  if (session === null) {
    return <Login onLoggedIn={setSession} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-gray-900">{t('app.name')}</span>
        <div className="text-sm text-gray-500 flex items-center gap-3">
          <span>
            {t('app.signedInAs')}: {t(`roles.${session.role}`)}
          </span>
          <button onClick={handleLogout} className="text-gray-900 underline">
            {t('app.signOut')}
          </button>
        </div>
      </header>
      <nav className="bg-white border-b px-6 flex gap-4 text-sm">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-2 border-b-2 ${tab === key ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500'}`}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {(() => {
        const { Screen } = TABS.find((x) => x.key === tab)
        return <Screen key={tab} />
      })()}
    </div>
  )
}
