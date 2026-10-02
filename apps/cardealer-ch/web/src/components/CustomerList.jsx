import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader } from './ui.jsx'

const EMPTY_FORM = {
  kind: 'person',
  companyName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  addressStreet: '',
  addressZip: '',
  addressCity: '',
}

export function partyName(p) {
  if (p.kind === 'company') return p.companyName || t('common.none')
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || t('common.none')
}

export default function CustomerList() {
  const [parties, setParties] = useState(null)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function reload() {
    try {
      setParties(await api.get('/api/parties'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleAdd(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const body = {}
      for (const [key, value] of Object.entries(form)) if (value !== '') body[key] = value
      await api.post('/api/parties', body)
      setForm(EMPTY_FORM)
      setShowForm(false)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const input = (key) => (
    <input
      className="field"
      placeholder={t(`customers.fields.${key}`)}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  )

  if (error) return <p className="p-6 text-danger">{error}</p>
  if (!parties) return <p className="p-6 text-steel">{t('common.loading')}</p>

  return (
    <div className="p-6">
      <PageHeader title={t('customers.title')}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('customers.add')}
        </button>
      </PageHeader>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <select
            className="field"
            aria-label={t('customers.fields.kind')}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            <option value="person">{t('customers.kind.person')}</option>
            <option value="company">{t('customers.kind.company')}</option>
          </select>
          {form.kind === 'company' ? (
            input('companyName')
          ) : (
            <>
              {input('firstName')}
              {input('lastName')}
            </>
          )}
          {input('email')}
          {input('phone')}
          {input('addressStreet')}
          {input('addressZip')}
          {input('addressCity')}
          <button type="submit" disabled={saving} className="btn sm:col-span-3">
            {t('common.save')}
          </button>
        </form>
      )}

      {parties.length === 0 ? (
        <div className="card p-8 text-center text-steel">{t('customers.empty')}</div>
      ) : (
        <div className="card overflow-x-auto"><table className="rows w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-3">{t('customers.name')}</th>
              <th className="p-3">{t('customers.fields.email')}</th>
              <th className="p-3">{t('customers.fields.phone')}</th>
              <th className="p-3">{t('customers.address')}</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id}>
                <td className="p-3 font-semibold text-ink">{partyName(p)}</td>
                <td className="p-3">{p.email || t('common.none')}</td>
                <td className="p-3">{p.phone || t('common.none')}</td>
                <td className="p-3 text-steel">
                  {[p.addressStreet, [p.addressZip, p.addressCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') ||
                    t('common.none')}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
