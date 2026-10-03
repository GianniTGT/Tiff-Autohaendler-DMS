import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Panel } from './ui.jsx'

/** Was für den ersten echten Betrieb eingerichtet sein muss — live aus den Daten, nicht von Hand abgehakt. */
function buildChecklist(tenant, vehicleCount) {
  const hasAddress = Boolean(tenant.addressStreet && tenant.addressZip && tenant.addressCity)
  return [
    { key: 'company', done: hasAddress && Boolean(tenant.legalName), tab: 'settings' },
    { key: 'uid', done: Boolean(tenant.uid), tab: 'settings' },
    { key: 'vatMethod', done: Boolean(tenant.vatMethod), tab: 'settings' },
    { key: 'qrIban', done: Boolean(tenant.qrIban), tab: 'settings' },
    { key: 'logo', done: Boolean(tenant.hasLogo), tab: 'settings', optional: true },
    { key: 'autoscout24', done: Boolean(tenant.autoscout24ClientId && tenant.autoscout24SellerId && tenant.autoscout24HasSecret), tab: 'settings', optional: true },
    { key: 'leadKey', done: Boolean(tenant.hasLeadKey), tab: 'settings', optional: true },
    { key: 'firstVehicle', done: vehicleCount > 0, tab: 'inventory' },
  ]
}

const TOPICS = ['vat', 'qr', 'archive', 'credit', 'roles', 'contracts']

export default function Help({ role, onNavigate }) {
  const [tenant, setTenant] = useState(null)
  const [vehicleCount, setVehicleCount] = useState(0)

  useEffect(() => {
    Promise.all([api.get('/api/tenant'), api.get('/api/vehicles')])
      .then(([tn, v]) => {
        setTenant(tn)
        setVehicleCount(v.length)
      })
      .catch(() => {})
  }, [])

  const items = tenant ? buildChecklist(tenant, vehicleCount) : []
  const open = items.filter((i) => !i.done && !i.optional).length

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('help.title')} />

      <Panel title={t('help.checklist.title')}>
        {!tenant ? (
          <p className="text-sm text-steel">{t('common.loading')}</p>
        ) : (
          <>
            <p className={`mb-3 text-sm font-semibold ${open === 0 ? 'text-profit' : 'text-warn'}`}>
              {open === 0 ? t('help.checklist.allDone') : t('help.checklist.open', { n: open })}
            </p>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.key} className="flex items-start gap-3 py-2">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold ${
                      item.done ? 'bg-profit text-white' : item.optional ? 'bg-tint text-mist' : 'bg-warn text-white'
                    }`}
                  >
                    {item.done ? '✓' : item.optional ? '–' : '!'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">
                      {t(`help.checklist.items.${item.key}.title`)}
                      {item.optional && <span className="ml-2 text-xs font-normal text-steel">{t('help.checklist.optional')}</span>}
                    </div>
                    <p className="text-xs text-steel">{t(`help.checklist.items.${item.key}.why`)}</p>
                  </div>
                  {!item.done && (item.tab !== 'settings' || role === 'inhaber') && (
                    <button className="btn-ghost" onClick={() => onNavigate?.(item.tab)}>
                      {t('help.checklist.go')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {TOPICS.map((topic) => (
        <Panel key={topic} title={t(`help.topics.${topic}.title`)}>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{t(`help.topics.${topic}.body`)}</p>
        </Panel>
      ))}

      <p className="text-xs text-steel">{t('help.contact')}</p>
    </div>
  )
}
