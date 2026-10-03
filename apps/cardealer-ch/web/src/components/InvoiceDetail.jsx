import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatMoney, francsToRappen, rappenToFrancs } from '@tiff/core-billing'
import { t } from '../i18n/index.js'
import { partyName } from './CustomerList.jsx'
import { Drawer, Panel, Tag, Notice, formatDay, todayIso } from './ui.jsx'

const MAX_REMINDER_LEVEL = 3

// Gutschriften stellen nur Inhaber und Buchhaltung aus (roles.js: canSeeCompanyTotals); der Server prüft selbst.
const CAN_CREDIT = ['inhaber', 'buchhaltung']

export default function InvoiceDetail({ invoiceId, role, onClose, onChanged }) {
  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [reminders, setReminders] = useState([])
  const [creditNotes, setCreditNotes] = useState([])
  const [creditForm, setCreditForm] = useState({ mode: 'full', amount: '', reason: '' })
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [payForm, setPayForm] = useState({ amount: '', date: todayIso() })

  async function load() {
    try {
      const [inv, pay, rem, cn] = await Promise.all([
        api.get(`/api/invoices/${invoiceId}`),
        api.get(`/api/invoices/${invoiceId}/payments`),
        api.get(`/api/invoices/${invoiceId}/reminders`),
        api.get(`/api/invoices/${invoiceId}/credit-notes`),
      ])
      setCreditNotes(cn)
      setInvoice(inv)
      setPayments(pay)
      setReminders(rem)
      const outstanding = Number(inv.total_rappen) - pay.reduce((s, p) => s + Number(p.amount_rappen), 0)
      setPayForm((f) => ({ ...f, amount: outstanding > 0 ? String(rappenToFrancs(outstanding)) : '' }))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [invoiceId])

  async function run(action) {
    setBusy(true)
    setError(null)
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

  const recordPayment = (e) => {
    e.preventDefault()
    return run(() => api.post(`/api/invoices/${invoiceId}/payments`, { amountRappen: francsToRappen(payForm.amount), paidAt: payForm.date }))
  }
  const issueCreditNote = (event) => {
    event.preventDefault()
    const what = creditForm.mode === 'full' ? t('documents.invoices.credit.full').toLowerCase() : `${formatMoney(francsToRappen(creditForm.amount) ?? 0)}`
    if (!window.confirm(t('documents.invoices.credit.confirm', { what }))) return
    return run(async () => {
      const created = await api.post(`/api/invoices/${invoiceId}/credit-notes`, {
        mode: creditForm.mode,
        reason: creditForm.reason,
        amountRappen: creditForm.mode === 'partial' ? francsToRappen(creditForm.amount) : undefined,
      })
      setNotice(created.archive?.archived
        ? { tone: 'green', text: t('documents.invoices.credit.created', { number: created.number }) }
        : { tone: 'amber', text: t('documents.invoices.credit.notArchived', { number: created.number, reason: created.archive?.reason ?? '' }) })
      setCreditForm({ mode: 'full', amount: '', reason: '' })
    })
  }
  const createReminder = () => run(() => api.post(`/api/invoices/${invoiceId}/reminders`, { asOfDate: todayIso() }))

  if (!invoice) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose}>
        {error && <Notice>{error}</Notice>}
      </Drawer>
    )
  }

  const total = Number(invoice.total_rappen)
  const paid = payments.reduce((s, p) => s + Number(p.amount_rappen), 0)
  const outstanding = Math.max(0, total - paid)
  const overdue = outstanding > 0 && String(invoice.due_date).slice(0, 10) < todayIso()
  const level = reminders.length ? Math.max(...reminders.map((r) => r.reminder_level)) : 0
  const credited = creditNotes.reduce((s, c) => s + c.totalRappen, 0)
  const creditable = Math.max(0, total - credited)

  return (
    <Drawer
      title={invoice.number}
      subtitle={`${invoice.party ? partyName({ kind: invoice.party.kind, companyName: invoice.party.company_name, firstName: invoice.party.first_name, lastName: invoice.party.last_name }) : t('common.none')} · ${t('documents.invoices.detail.dueOn')} ${formatDay(invoice.due_date)}`}
      onClose={onClose}
    >
      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!invoice.tenant?.qr_iban && <Notice tone="amber">{t('documents.invoices.detail.noQr')}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={outstanding === 0 ? 'green' : overdue ? 'red' : 'amber'}>
          {t(`documents.invoices.status.${outstanding === 0 ? 'paid' : overdue ? 'overdue' : 'issued'}`)}
        </Tag>
        <a className="btn-ghost" href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
          {t('documents.invoices.detail.pdfInvoice')}
        </a>
      </div>

      <Panel title={t('documents.invoices.detail.positions')}>
        <table className="w-full text-sm">
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id ?? l.position} className="border-b border-line last:border-0">
                <td className="py-1.5">{l.description}</td>
                <td className="num py-1.5 text-right">{formatMoney(Number(l.line_total_rappen ?? l.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-steel">{t('documents.invoices.detail.subtotal')}</dt>
            <dd className="num">{formatMoney(Number(invoice.subtotal_rappen))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-steel">{t('documents.invoices.detail.vat')}</dt>
            <dd className="num">{formatMoney(Number(invoice.vat_rappen))}</dd>
          </div>
          <div className="flex justify-between border-t border-line-strong pt-1 font-semibold">
            <dt>{t('documents.invoices.detail.total')}</dt>
            <dd className="num">{formatMoney(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-steel">{t('documents.invoices.paidAmount')}</dt>
            <dd className="num">{formatMoney(paid)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-brand-deep">
            <dt>{t('documents.invoices.outstanding')}</dt>
            <dd className="num">{formatMoney(outstanding)}</dd>
          </div>
        </dl>
        {invoice.qr_reference && (
          <p className="mt-2 font-mono text-xs text-steel">
            {t('documents.invoices.detail.qrRef')}: {invoice.qr_reference}
          </p>
        )}
      </Panel>

      <Panel title={t('documents.invoices.detail.payments')}>
        {payments.length === 0 ? (
          <p className="mb-3 text-sm text-steel">{t('documents.invoices.detail.noPayments')}</p>
        ) : (
          <ul className="mb-3 divide-y divide-line text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>
                  {formatDay(p.paid_at)} <span className="text-mist">· {t(`documents.invoices.detail.source.${p.source}`)}</span>
                </span>
                <span className="num">{formatMoney(Number(p.amount_rappen))}</span>
              </li>
            ))}
          </ul>
        )}
        {outstanding > 0 && (
          <form onSubmit={recordPayment} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label>
              <span className="field-label">{t('documents.invoices.detail.amount')}</span>
              <input required className="field" inputMode="decimal" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </label>
            <label>
              <span className="field-label">{t('documents.invoices.detail.paidOn')}</span>
              <input required type="date" className="field" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
            </label>
            <button type="submit" disabled={busy} className="btn">
              {t('documents.invoices.detail.save')}
            </button>
          </form>
        )}
      </Panel>

      <Panel title={t('documents.invoices.credit.title')}>
        {creditNotes.length === 0 ? (
          <p className="text-sm text-steel">{t('documents.invoices.credit.none')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {creditNotes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  <b>{c.number}</b> · {formatDay(c.issueDate)} · {c.reason}
                </span>
                <span className="flex items-center gap-3">
                  <span className="num">{formatMoney(c.totalRappen)}</span>
                  <a className="text-brand underline" href={`/api/credit-notes/${c.id}/pdf`} target="_blank" rel="noreferrer">
                    {t('documents.invoices.pdf')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-steel">{creditable > 0 ? t('documents.invoices.credit.remaining', { amount: formatMoney(creditable) }) : t('documents.invoices.credit.fully')}</p>
        {CAN_CREDIT.includes(role) && creditable > 0 && (
          <form onSubmit={issueCreditNote} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="field-label">{t('documents.invoices.credit.mode')}</span>
              <select className="field" value={creditForm.mode} onChange={(e) => setCreditForm({ ...creditForm, mode: e.target.value })}>
                <option value="full" disabled={credited > 0}>
                  {t('documents.invoices.credit.full')}
                </option>
                <option value="partial">{t('documents.invoices.credit.partial')}</option>
              </select>
            </label>
            {creditForm.mode === 'partial' && (
              <label>
                <span className="field-label">{t('documents.invoices.credit.amount')}</span>
                <input required className="field" inputMode="decimal" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} />
              </label>
            )}
            <label className="sm:col-span-2">
              <span className="field-label">{t('documents.invoices.credit.reason')}</span>
              <input required className="field" value={creditForm.reason} onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })} />
            </label>
            <button type="submit" disabled={busy} className="btn sm:col-span-2">
              {t('documents.invoices.credit.submit')}
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-steel">{t('documents.invoices.credit.hint')}</p>
      </Panel>

      <Panel
        title={t('documents.invoices.detail.reminders')}
        actions={
          overdue && level < MAX_REMINDER_LEVEL ? (
            <button className="btn" disabled={busy} onClick={createReminder}>
              {t('documents.invoices.detail.createReminder')} ({t('documents.invoices.detail.reminderLevel', { n: level + 1 })})
            </button>
          ) : null
        }
      >
        {reminders.length === 0 ? (
          <p className="text-sm text-steel">{t('documents.invoices.detail.noReminders')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-1.5">
                <span>
                  {t('documents.invoices.detail.reminderLevel', { n: r.reminder_level })} · {r.number} · {formatDay(r.issue_date)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="num">{formatMoney(Number(r.total_rappen))}</span>
                  <a className="text-brand underline" href={`/api/reminders/${r.id}/pdf`} target="_blank" rel="noreferrer">
                    {t('documents.invoices.pdf')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
        {level >= MAX_REMINDER_LEVEL && outstanding > 0 && <p className="mt-2 text-xs text-steel">{t('documents.invoices.detail.reminderBlocked')}</p>}
      </Panel>
    </Drawer>
  )
}
