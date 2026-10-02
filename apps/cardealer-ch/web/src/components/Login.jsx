import { useState } from 'react'
import { api, ApiError } from '../api.js'
import { t } from '../i18n/index.js'
import lockup from '../assets/tiff-lockup-horizontal.png'

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
      setError(err instanceof ApiError ? t('login.invalid') : t('login.connectionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-bg grid min-h-full place-items-center p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4 p-6 shadow-2xl">
        <img src={lockup} alt={t('app.vendor')} className="mx-auto h-14 w-auto" />
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-brand-deep">{t('app.name')}</h1>
          <p className="text-sm text-steel">{t('login.tagline')}</p>
        </div>

        <div>
          <label className="field-label" htmlFor="tenantSlug">
            {t('login.tenant')}
          </label>
          <input
            id="tenantSlug"
            className="field"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            autoComplete="organization"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="email">
            {t('login.email')}
          </label>
          <input
            id="email"
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="password">
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={busy} className="btn w-full">
          {t('login.submit')}
        </button>
      </form>
    </div>
  )
}
