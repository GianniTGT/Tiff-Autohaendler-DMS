import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'
import { PageHeader, Tag, Notice } from './ui.jsx'

const ROLES = ['inhaber', 'verkauf', 'werkstatt', 'buchhaltung']
const EMPTY_FORM = { name: '', email: '', password: '', role: 'verkauf' }

function UserRow({ user, isSelf, busy, onPatch }) {
  const [settingPassword, setSettingPassword] = useState(false)
  const [password, setPassword] = useState('')

  return (
    <tr>
      <td className="p-3 font-semibold text-ink">
        {user.name} {isSelf && <span className="font-normal text-steel">({t('users.you')})</span>}
      </td>
      <td className="p-3">{user.email}</td>
      <td className="p-3">
        <select className="field w-auto" aria-label={t('users.cols.role')} value={user.role} disabled={busy} onChange={(e) => onPatch(user.id, { role: e.target.value }, t('users.updated'))}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
      </td>
      <td className="p-3">
        <Tag tone={user.active ? 'green' : 'red'}>{user.active ? t('users.active') : t('users.inactive')}</Tag>
      </td>
      <td className="p-3">
        {settingPassword ? (
          <form
            className="flex flex-wrap justify-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onPatch(user.id, { password }, t('users.passwordSet'))
              setPassword('')
              setSettingPassword(false)
            }}
          >
            <input required minLength={10} type="text" autoComplete="off" className="field w-48" placeholder={t('users.form.password')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="btn" disabled={busy}>
              {t('users.actions.setPassword')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSettingPassword(false)}>
              {t('users.actions.cancel')}
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => setSettingPassword(true)}>
              {t('users.actions.resetPassword')}
            </button>
            {!isSelf && (
              <button className="btn-ghost" disabled={busy} onClick={() => onPatch(user.id, { active: !user.active }, t('users.updated'))}>
                {user.active ? t('users.actions.deactivate') : t('users.actions.activate')}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export default function Users({ role, userId }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      setUsers(await api.get('/api/users'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (role === 'inhaber') reload()
  }, [role])

  async function run(action, okMessage) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await reload()
      setMessage(okMessage)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (role !== 'inhaber') {
    return (
      <div className="p-6">
        <Notice tone="amber">{t('users.ownerOnly')}</Notice>
      </div>
    )
  }
  if (!users) return <p className="p-6 text-steel">{error ?? t('common.loading')}</p>

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t('users.title')}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t('users.add')}
        </button>
      </PageHeader>

      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="green">{message}</Notice>}

      {showForm && (
        <form
          className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await api.post('/api/users', form)
              setForm(EMPTY_FORM)
              setShowForm(false)
            }, t('users.created'))
          }}
        >
          <input required className="field" placeholder={t('users.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required type="email" className="field" placeholder={t('users.form.email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required minLength={10} type="text" autoComplete="off" className="field" placeholder={t('users.form.password')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="field" aria-label={t('users.form.role')} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)} — {t(`roles.describe.${r}`)}
              </option>
            ))}
          </select>
          <p className="text-xs text-steel sm:col-span-2">{t('users.form.hint')}</p>
          <button type="submit" disabled={busy} className="btn sm:col-span-2">
            {t('users.form.save')}
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="rows w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-3">{t('users.cols.name')}</th>
              <th className="p-3">{t('users.cols.email')}</th>
              <th className="p-3">{t('users.cols.role')}</th>
              <th className="p-3">{t('users.cols.status')}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === userId} busy={busy} onPatch={(id, body, ok) => run(() => api.patch(`/api/users/${id}`, body), ok)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
