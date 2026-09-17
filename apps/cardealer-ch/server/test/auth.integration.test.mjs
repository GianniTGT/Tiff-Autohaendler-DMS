/**
 * Integrationstest gegen echtes PostgreSQL — Login, Sitzungsprüfung, Logout.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL, siehe
 * packages/core-db/test/tenant-isolation.integration.test.mjs für die
 * Begründung, warum das kein Mock sein darf.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import {
  login,
  logout,
  createUser,
  validateSessionCookie,
  encodeSessionCookie,
  decodeSessionCookie,
  LoginError,
} from '../src/services/auth.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

let adminPool
let tenantId
const TENANT_SLUG = 'test-garage-' + Math.random().toString(36).slice(2, 8)
const USER_EMAIL = 'sabit@example.test'
const USER_PASSWORD = 'correct horse battery staple'

async function setUp() {
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const result = await adminPool.query(
    "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'Testgarage', 'Testgarage AG', $1) RETURNING id",
    [TENANT_SLUG],
  )
  tenantId = result.rows[0].id
  await createUser({ tenantId, email: USER_EMAIL, name: 'Sabit', password: USER_PASSWORD, role: 'inhaber' })
}

async function tearDown() {
  if (adminPool) {
    await adminPool.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
  }
  await closePool()
}

test('decodeSessionCookie/encodeSessionCookie round-trip', { skip: !hasDb }, () => {
  const encoded = encodeSessionCookie('tenant-1', 'session-1')
  assert.deepEqual(decodeSessionCookie(encoded), { tenantId: 'tenant-1', sessionId: 'session-1' })
  assert.equal(decodeSessionCookie('garbage'), null)
  assert.equal(decodeSessionCookie(undefined), null)
})

test('login flow: success, wrong password, wrong tenant, session lifecycle', { skip: !hasDb }, async (t) => {
  await setUp()
  t.after(tearDown)

  await t.test('correct credentials return a session for the right tenant and role', async () => {
    const session = await login({ tenantSlug: TENANT_SLUG, email: USER_EMAIL, password: USER_PASSWORD })
    assert.equal(session.tenantId, tenantId)
    assert.equal(session.role, 'inhaber')
    assert.ok(session.sessionId)
  })

  await t.test('wrong password is rejected as LoginError', async () => {
    await assert.rejects(
      () => login({ tenantSlug: TENANT_SLUG, email: USER_EMAIL, password: 'totally wrong password' }),
      LoginError,
    )
  })

  await t.test('unknown tenant slug is rejected the same way as a wrong password', async () => {
    await assert.rejects(
      () => login({ tenantSlug: 'does-not-exist', email: USER_EMAIL, password: USER_PASSWORD }),
      LoginError,
    )
  })

  await t.test('a valid session cookie resolves to the right tenant/user/role', async () => {
    const session = await login({ tenantSlug: TENANT_SLUG, email: USER_EMAIL, password: USER_PASSWORD })
    const cookieValue = encodeSessionCookie(session.tenantId, session.sessionId)
    const resolved = await validateSessionCookie(cookieValue)
    assert.deepEqual(resolved, { tenantId: session.tenantId, userId: session.userId, role: 'inhaber' })
  })

  await t.test('a session cookie with the session id swapped to another tenant resolves to nothing', async () => {
    const session = await login({ tenantSlug: TENANT_SLUG, email: USER_EMAIL, password: USER_PASSWORD })
    const otherTenantId = '00000000-0000-0000-0000-000000000000'
    const tampered = encodeSessionCookie(otherTenantId, session.sessionId)
    assert.equal(await validateSessionCookie(tampered), null)
  })

  await t.test('logout invalidates the session', async () => {
    const session = await login({ tenantSlug: TENANT_SLUG, email: USER_EMAIL, password: USER_PASSWORD })
    const cookieValue = encodeSessionCookie(session.tenantId, session.sessionId)
    assert.notEqual(await validateSessionCookie(cookieValue), null)
    await logout(cookieValue)
    assert.equal(await validateSessionCookie(cookieValue), null)
  })

  await t.test('garbage cookie values never throw, only resolve to null', async () => {
    assert.equal(await validateSessionCookie(undefined), null)
    assert.equal(await validateSessionCookie('not-a-valid-cookie'), null)
    assert.equal(await validateSessionCookie('not-a-uuid.also-not-a-uuid'), null)
  })
})
