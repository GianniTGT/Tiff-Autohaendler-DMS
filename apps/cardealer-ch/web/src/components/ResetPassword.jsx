import { useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import lockup from '../assets/tiff-lockup-horizontal.png'

/** Neues Passwort setzen — die Seite hinter dem Link aus der E-Mail (?reset=<tenantId>.<token>). */
export default function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    if (password !== repeat) {
      setError(t('reset.mismatch'))
      return
    }
    setBusy(true)
    try {
      await api.post('/api/auth/reset', { token, password })
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-bg flex min-h-full flex-col">
      <div className="h-1.5 bg-brand" aria-hidden="true" />
      <div className="grid flex-1 place-items-center p-4">
        <form onSubmit={handleSubmit} className="w-full max-w-[360px] space-y-4 rounded-tiff bg-white p-7 shadow-2xl">
          <img src={lockup} alt={t('app.vendor')} className="h-12 w-auto" />
          <h1 className="font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-brand">{t('reset.title')}</h1>

          {done ? (
            <>
              <p className="rounded-lg bg-profit-bg px-3 py-2 text-sm text-profit">{t('reset.done')}</p>
              <button type="button" className="btn w-full" onClick={onDone}>
                {t('reset.toLogin')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-steel">{t('reset.intro')}</p>
              <div>
                <label className="field-label" htmlFor="newPassword">
                  {t('reset.password')}
                </label>
                <input id="newPassword" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
              </div>
              <div>
                <label className="field-label" htmlFor="repeatPassword">
                  {t('reset.repeat')}
                </label>
                <input id="repeatPassword" type="password" className="field" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" minLength={10} required />
              </div>
              {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
              <button type="submit" disabled={busy} className="btn w-full">
                {t('reset.submit')}
              </button>
              <div className="text-center">
                <button type="button" className="text-xs text-brand underline" onClick={onDone}>
                  {t('reset.toLogin')}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
      <p className="px-6 pb-4 pt-2 text-center text-[11px] uppercase tracking-[3px] text-white/60">
        {t('login.secure')} · {t('app.vendor')}
      </p>
    </div>
  )
}
