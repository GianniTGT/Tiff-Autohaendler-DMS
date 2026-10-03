import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'
import { Drawer, Panel, Tag, Notice, formatDay, salesState, STATE_TONE, listingNotice } from './ui.jsx'

/** Was sich aus welchem Beleg als Nächstes machen lässt (spiegelt services/sales-documents.js; der Server prüft selbst). */
const NEXT_STEPS = {
  offer: [{ to: 'order', primary: true }],
  order: [{ to: 'delivery_note' }, { to: 'invoice', primary: true }],
  delivery_note: [{ to: 'invoice', primary: true }],
}

export default function SalesDetail({ docId, onClose, onChanged, onOpenDoc, onOpenInvoice }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setDoc(await api.get(`/api/sales-documents/${docId}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    setDoc(null)
    setNotice(null)
    load()
  }, [docId])

  async function run(action) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const convert = (to) =>
    run(async () => {
      const created = await api.post(`/api/sales-documents/${docId}/convert`, { to, note: to === 'delivery_note' ? note || undefined : undefined })
      const ln = listingNotice(created.listing)
      setNotice({
        tone: created.archive?.archived && ln?.tone !== 'amber' ? 'green' : 'amber',
        text: (created.archive?.archived ? t('sales.detail.created', { number: created.number }) : t('sales.notArchived', { number: created.number, reason: created.archive?.reason ?? '' })) + (created.soldVehicle ? ` ${t('documents.invoices.vehicleSold')}` : '') + (ln ? ` ${t(ln.key, ln.vars)}` : ''),
      })
      setNote('')
    })

  const setStatus = (status) => {
    if (!window.confirm(t(`sales.detail.confirm.${status}`))) return
    return run(() => api.post(`/api/sales-documents/${docId}/status`, { status }))
  }

  if (!doc) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose}>
        {error && <Notice>{error}</Notice>}
      </Drawer>
    )
  }

  const state = salesState(doc)
  const open = doc.status === 'issued' || doc.status === 'accepted' || doc.status === 'delivered'
  const steps = open && !doc.expired ? NEXT_STEPS[doc.type] ?? [] : []
  const hasStep = (to) => doc.successors.some((s) => s.type === to && s.status !== 'cancelled' && s.status !== 'declined')
  const showPrices = doc.type !== 'delivery_note'
  const vat = Number(doc.vat_rappen)

  return (
    <Drawer
      title={doc.number}
      subtitle={`${t(`sales.types.${doc.type}`)} · ${doc.party ? partyName({ kind: doc.party.kind, companyName: doc.party.company_name, firstName: doc.party.first_name, lastName: doc.party.last_name }) : t('common.none')} · ${formatDay(doc.issue_date)}`}
      onClose={onClose}
    >
      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={STATE_TONE[state]}>{t(`sales.status.${doc.type}.${state}`)}</Tag>
        {doc.type === 'offer' && doc.due_date && <span className="text-sm text-steel">{t('sales.validUntilShort', { date: formatDay(doc.due_date) })}</span>}
        <a className="btn-ghost" href={`/api/sales-documents/${doc.id}/pdf`} target="_blank" rel="noreferrer">
          {t('sales.detail.pdf')}
        </a>
      </div>
      {doc.expired && <Notice tone="amber">{t('sales.detail.expired')}</Notice>}

      <Panel title={t('sales.detail.chain')}>
        <ol className="space-y-1 text-sm">
          {doc.predecessor && (
            <li>
              <span className="text-steel">{t('sales.detail.from')}: </span>
              <button className="font-semibold text-brand underline" onClick={() => onOpenDoc(doc.predecessor.id)}>
                {doc.predecessor.number}
              </button>
            </li>
          )}
          <li className="font-semibold">{doc.number}</li>
          {doc.successors.map((s) => (
            <li key={s.id}>
              <span className="text-steel">{t('sales.detail.to')}: </span>
              {s.type === 'invoice' ? (
                <button className="font-semibold text-brand underline" onClick={() => onOpenInvoice(s.id)}>
                  {s.number}
                </button>
              ) : (
                <button className="font-semibold text-brand underline" onClick={() => onOpenDoc(s.id)}>
                  {s.number}
                </button>
              )}{' '}
              <span className="text-xs text-steel">({t(`sales.types.${s.type}`)})</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={t(doc.type === 'delivery_note' ? 'sales.detail.scope' : 'documents.invoices.detail.positions')}>
        <table className="w-full text-sm">
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-1.5">{l.description}</td>
                <td className="num py-1.5 text-right text-steel">{Number(l.quantity)}×</td>
                {showPrices && <td className="num py-1.5 text-right">{formatMoney(Number(l.line_total_rappen))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {showPrices && (
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-steel">{t('documents.invoices.detail.subtotal')}</dt>
              <dd className="num">{formatMoney(Number(doc.subtotal_rappen))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-steel">{t('documents.invoices.detail.vat')}</dt>
              <dd className="num">{formatMoney(vat)}</dd>
            </div>
            <div className="flex justify-between border-t border-line-strong pt-1 font-semibold">
              <dt>{t('documents.invoices.detail.total')}</dt>
              <dd className="num">{formatMoney(Number(doc.total_rappen))}</dd>
            </div>
          </dl>
        )}
        {doc.note && <p className="mt-3 text-sm text-steel">{doc.note}</p>}
      </Panel>

      {(steps.length > 0 || (doc.type === 'offer' && doc.status === 'issued' && !doc.expired) || (doc.type === 'order' && doc.status === 'issued')) && (
        <Panel title={t('sales.detail.next')}>
          {doc.type === 'order' && doc.status === 'issued' && (
            <input className="field mb-3" placeholder={t('sales.detail.deliveryNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          <div className="flex flex-wrap gap-2">
            {steps.map((step) => (
              <button key={step.to} className={step.primary ? 'btn' : 'btn-ghost'} disabled={busy || hasStep(step.to)} onClick={() => convert(step.to)}>
                {t(`sales.detail.make.${step.to}`)}
              </button>
            ))}
            {doc.type === 'offer' && doc.status === 'issued' && !doc.expired && (
              <button className="btn-ghost text-danger" disabled={busy} onClick={() => setStatus('declined')}>
                {t('sales.detail.decline')}
              </button>
            )}
            {doc.type === 'order' && doc.status === 'issued' && (
              <button className="btn-ghost text-danger" disabled={busy} onClick={() => setStatus('cancelled')}>
                {t('sales.detail.cancel')}
              </button>
            )}
          </div>
          {doc.type === 'order' && <p className="mt-2 text-xs text-steel">{t('sales.detail.reserveHint')}</p>}
        </Panel>
      )}
    </Drawer>
  )
}
