import { useState } from 'react'
import { api, ApiError } from '../api.js'
import { t } from '../i18n/index.js'

export default function Login({ onLoggedIn }) {
  const [tenantSlug, setTenantSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const session = await api.post('/api/auth/login', { tenantSlug, email, password })
      onLoggedIn(session)
    } catch (err) {
      setError(err instanceof ApiError ? t('login.invalid') : 'Verbindung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-900">{t('app.name')}</h1>

        <div>
          <label className="block text-sm text-gray-600 mb-1" htmlFor="tenantSlug">
            Betrieb
          </label>
          <input
            id="tenantSlug"
            className="w-full border border-gray-300 rounded px-3 py-2"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            autoComplete="organization"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1" htmlFor="email">
            {t('login.email')}
          </label>
          <input
            id="email"
            type="email"
            className="w-full border border-gray-300 rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1" htmlFor="password">
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            className="w-full border border-gray-300 rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-gray-900 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {t('login.submit')}
        </button>
      </form>
    </div>
  )
}
