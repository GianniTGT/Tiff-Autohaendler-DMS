import { useState } from 'react'
import { api, ApiError } from '../api.js'
import { t } from '../i18n/index.js'
import lockup from '../assets/tiff-lockup-horizontal.png'

/**
 * Anmeldung wie im Manager: dunkle Bühne, grüne Linie oben, weisse Karte mit Marke, Produktname,
 * Feldern und «Passwort vergessen?», unten «Sicherer Zugang · Tiff Software Solutions».
 * Ein Hintergrundbild (web/public/login-bg.jpg) legt sich über die gezeichnete Bühne, sobald es da ist.
 */
export default function Login({ onLoggedIn }) {
  const [tenantSlug, setTenantSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [forgot, setForgot] = useState(false) // false | 'form' | 'sent'
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

  const phone = t('app.footer.phone')

  async function handleForgot(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.post('/api/auth/forgot', { tenantSlug, email })
      setForgot('sent')
    } catch {
      setError(t('login.connectionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-bg flex min-h-full flex-col">
      <div className="h-1.5 bg-brand" aria-hidden="true" />
      <div className="grid flex-1 place-items-center p-4">
        <form onSubmit={forgot === 'form' ? handleForgot : handleSubmit} className="w-full max-w-[360px] space-y-4 rounded-tiff bg-white p-7 shadow-2xl">
          <img src={lockup} alt={t('app.vendor')} className="h-12 w-auto" />
          <h1 className="font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-brand">{t('app.name')}</h1>

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
              placeholder={t('login.tenantPlaceholder')}
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
              placeholder="name@example.com"
              required
            />
          </div>

          {forgot === 'form' && <p className="text-sm text-steel">{t('login.forgotIntro')}</p>}
          {forgot === 'sent' && <p className="rounded-lg bg-profit-bg px-3 py-2 text-sm text-profit">{t('login.forgotSent')}</p>}

          {!forgot && (
          <div>
            <label className="field-label" htmlFor="password">
              {t('login.password')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="field pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(showPassword ? 'login.hidePassword' : 'login.showPassword')}
                title={t(showPassword ? 'login.hidePassword' : 'login.showPassword')}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-steel hover:text-brand"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </div>
          </div>
          )}

          {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

          {forgot !== 'sent' && (
            <button type="submit" disabled={busy} className="btn w-full">
              {forgot === 'form' ? t('login.forgotSubmit') : t('login.submit')}
            </button>
          )}

          <div className="text-center">
            {!forgot ? (
              <button type="button" className="text-xs text-brand underline" onClick={() => setForgot('form')}>
                {t('login.forgot')}
              </button>
            ) : (
              <button type="button" className="text-xs text-brand underline" onClick={() => setForgot(false)}>
                {t('login.backToLogin')}
              </button>
            )}
            {forgot === 'form' && <p className="mt-2 text-left text-xs text-steel">{t('login.forgotHint', { phone })}</p>}
          </div>
        </form>
      </div>
      <p className="px-6 pb-4 pt-2 text-center text-[11px] uppercase tracking-[3px] text-white/60">
        {t('login.secure')} · {t('app.vendor')}
      </p>
    </div>
  )
}
