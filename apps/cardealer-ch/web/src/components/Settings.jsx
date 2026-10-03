import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Panel, Notice } from './ui.jsx'

const FIELDS = [
  ['legalName', 'settings.company.legalName'],
  ['name', 'settings.company.name'],
  ['uid', 'settings.company.uid'],
  ['addressStreet', 'settings.company.street'],
  ['addressZip', 'settings.company.zip'],
  ['addressCity', 'settings.company.city'],
]

export default function Settings({ onSettingsChanged }) {
  const [tenant, setTenant] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logoVersion, setLogoVersion] = useState(Date.now())
  const logoInput = useRef(null)
  const [newKey, setNewKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const apply = (data) => {
    setTenant(data)
    setForm({
      ...Object.fromEntries(FIELDS.map(([k]) => [k, data[k] ?? ''])),
      vatLiable: Boolean(data.vatLiable),
      vatMethod: data.vatMethod ?? '',
      netTaxRatePercent: data.netTaxRatePercent ?? '',
      fiscalYearEndMonth: String(data.fiscalYearEndMonth ?? 12),
      qrIban: data.qrIban ?? '',
      leadAllowedOrigin: data.leadAllowedOrigin ?? '',
      autoscout24ClientId: data.autoscout24ClientId ?? '',
      autoscout24SellerId: data.autoscout24SellerId ?? '',
      autoscout24ClientSecret: '', // wird nie zurückgegeben; leer lassen behält das gespeicherte
    })
  }

  useEffect(() => {
    api
      .get('/api/tenant')
      .then(apply)
      .catch((err) => setError(err.message))
  }, [])

  /** Logo hoch- oder herunterladen: eigener Weg, nicht Teil des Formulars (Bytes statt Felder). */
  async function changeLogo(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setTenant({ ...(await api.get('/api/tenant')) })
      setLogoVersion(Date.now())
      onSettingsChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function changeLeadKey(action) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      setNewKey(result?.key ?? null)
      setCopied(false)
      setTenant({ ...(await api.get('/api/tenant')) })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      apply({ ...(await api.patch('/api/tenant', form)), canEdit: tenant.canEdit })
      setSaved(true)
      onSettingsChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!form) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>
  const readOnly = !tenant.canEdit
  const bind = (key) => ({
    className: 'field disabled:bg-tint',
    disabled: readOnly,
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  })

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('settings.title')} />
      {readOnly && <Notice tone="amber">{t('settings.readOnly')}</Notice>}
      {error && <Notice>{error}</Notice>}
      {saved && <Notice tone="green">{t('settings.saved')}</Notice>}

      <form onSubmit={save} className="space-y-4">
        <Panel title={t('settings.company.title')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([key, label]) => (
              <label key={key}>
                <span className="field-label">{t(label)}</span>
                <input {...bind(key)} />
              </label>
            ))}
          </div>
        </Panel>

        <Panel title={t('settings.logo.title')}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-32 items-center justify-center rounded-lg border border-line-strong bg-white p-1">
              {tenant.hasLogo ? (
                <img src={`/api/tenant/logo?v=${logoVersion}`} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-center text-xs text-mist">{t('settings.logo.none')}</span>
              )}
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) changeLogo(() => api.upload('/api/tenant/logo', file))
                  }}
                />
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => logoInput.current?.click()}>
                  {t('settings.logo.upload')}
                </button>
                {tenant.hasLogo && (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => changeLogo(() => api.del('/api/tenant/logo'))}>
                    {t('settings.logo.remove')}
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-steel">{t('settings.logo.hint')}</p>
        </Panel>

        <Panel title={t('settings.vat.title')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={form.vatLiable}
                onChange={(e) => setForm({ ...form, vatLiable: e.target.checked })}
              />
              {t('settings.vat.liable')}
            </label>
            <label>
              <span className="field-label">{t('settings.vat.method')}</span>
              <select {...bind('vatMethod')}>
                <option value="">{t('settings.vat.choose')}</option>
                <option value="effective">{t('reports.method.effective')}</option>
                <option value="net_tax_rate">{t('reports.method.net_tax_rate')}</option>
              </select>
            </label>
            {form.vatMethod === 'net_tax_rate' && (
              <label>
                <span className="field-label">{t('settings.vat.netRate')}</span>
                <input {...bind('netTaxRatePercent')} inputMode="decimal" />
              </label>
            )}
            <label>
              <span className="field-label">{t('settings.vat.fiscalYearEnd')}</span>
              <select {...bind('fiscalYearEndMonth')}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {new Date(2000, i, 1).toLocaleDateString('de-CH', { month: 'long' })}
                    {i === 11 ? ` ${t('settings.vat.calendarYear')}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-steel sm:col-span-2">{t('settings.vat.fiscalYearEndHint')}</p>
          </div>
        </Panel>

        <Panel title={t('settings.payment.title')}>
          <label>
            <span className="field-label">{t('settings.payment.qrIban')}</span>
            <input {...bind('qrIban')} placeholder="CH44 3199 9123 0008 8901 2" />
          </label>
          <p className="mt-1 text-xs text-steel">{t('settings.payment.qrIbanHint')}</p>
        </Panel>

        <Panel title={t('settings.leads.title')}>
          <p className="mb-3 text-sm text-steel">{t('settings.leads.intro')}</p>
          <label className="block">
            <span className="field-label">{t('settings.leads.origin')}</span>
            <input {...bind('leadAllowedOrigin')} placeholder="https://www.meine-garage.ch" />
            <span className="text-xs text-steel">{t('settings.leads.originHint')}</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold">{tenant.hasLeadKey ? t('settings.leads.active') : t('settings.leads.inactive')}</span>
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => (!tenant.hasLeadKey || window.confirm(t('settings.leads.confirmRegenerate'))) && changeLeadKey(() => api.post('/api/tenant/lead-key'))}
                >
                  {tenant.hasLeadKey ? t('settings.leads.regenerate') : t('settings.leads.generate')}
                </button>
                {tenant.hasLeadKey && (
                  <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={() => changeLeadKey(() => api.del('/api/tenant/lead-key'))}>
                    {t('settings.leads.revoke')}
                  </button>
                )}
              </>
            )}
          </div>

          {newKey && (
            <div className="mt-3 space-y-2 rounded-lg border border-brand-gold bg-warn-bg p-3">
              <p className="text-sm font-semibold text-warn">{t('settings.leads.shownOnce')}</p>
              <div className="flex items-center gap-2">
                <code className="block flex-1 break-all rounded bg-white p-2 font-mono text-xs">{newKey}</code>
                <button
                  type="button"
                  className="btn"
                  onClick={() => navigator.clipboard?.writeText(newKey).then(() => setCopied(true))}
                >
                  {copied ? t('settings.leads.copied') : t('settings.leads.copy')}
                </button>
              </div>
            </div>
          )}

          {tenant.hasLeadKey && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-steel">{t('settings.leads.endpoint')}</p>
              <code className="block break-all rounded bg-tint p-2 font-mono text-xs">POST {window.location.origin}/api/public/leads/{tenant.slug}</code>
              <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-steel">{t('settings.leads.example')}</p>
              <pre className="overflow-x-auto rounded bg-tint p-2 font-mono text-[11px] leading-snug">{`curl -X POST ${window.location.origin}/api/public/leads/${tenant.slug} \
  -H "Content-Type: application/json" -H "X-Api-Key: <Schlüssel>" \
  -d '{"name":"Max Muster","email":"max@example.ch","type":"test_drive","message":"Probefahrt?"}'`}</pre>
              <p className="text-xs text-steel">{t('settings.leads.fields')}</p>
            </div>
          )}
        </Panel>

        <Panel title={t('settings.autoscout24.title')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="field-label">{t('settings.autoscout24.clientId')}</span>
              <input {...bind('autoscout24ClientId')} autoComplete="off" />
            </label>
            <label>
              <span className="field-label">{t('settings.autoscout24.sellerId')}</span>
              <input {...bind('autoscout24SellerId')} autoComplete="off" />
            </label>
            <label className="sm:col-span-2">
              <span className="field-label">{t('settings.autoscout24.clientSecret')}</span>
              <input {...bind('autoscout24ClientSecret')} type="password" autoComplete="new-password" placeholder={tenant.autoscout24HasSecret ? t('settings.autoscout24.secretSaved') : t('settings.autoscout24.secretMissing')} />
            </label>
          </div>
          <p className="mt-2 text-xs text-steel">{t('settings.autoscout24.hint')}</p>
        </Panel>

        {!readOnly && (
          <button type="submit" disabled={busy} className="btn">
            {t('common.save')}
          </button>
        )}
      </form>
    </div>
  )
}
