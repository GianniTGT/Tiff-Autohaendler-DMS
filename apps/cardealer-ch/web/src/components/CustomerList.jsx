import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'

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
      className="border border-gray-300 rounded px-2 py-1.5 text-sm"
      placeholder={t(`customers.fields.${key}`)}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  )

  if (error) return <p className="text-red-600 p-6">{error}</p>
  if (!parties) return <p className="p-6 text-gray-500">{t('common.loading')}</p>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{t('customers.title')}</h2>
        <button className="bg-gray-900 text-white rounded px-3 py-1.5 text-sm" onClick={() => setShowForm((v) => !v)}>
          {t('customers.add')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-3 gap-3">
          <select
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
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
          <button type="submit" disabled={saving} className="col-span-3 bg-gray-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
            {t('common.save')}
          </button>
        </form>
      )}

      {parties.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">{t('customers.empty')}</div>
      ) : (
        <table className="w-full bg-white rounded-lg shadow text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">{t('customers.name')}</th>
              <th className="p-3">{t('customers.fields.email')}</th>
              <th className="p-3">{t('customers.fields.phone')}</th>
              <th className="p-3">{t('customers.address')}</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-3">{partyName(p)}</td>
                <td className="p-3">{p.email || t('common.none')}</td>
                <td className="p-3">{p.phone || t('common.none')}</td>
                <td className="p-3 text-gray-500">
                  {[p.addressStreet, [p.addressZip, p.addressCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') ||
                    t('common.none')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
