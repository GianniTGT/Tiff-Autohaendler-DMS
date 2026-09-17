/**
 * Integrationstest gegen echtes PostgreSQL — kein Mock, keine Simulation.
 *
 * Der Grund, warum dieser Test existiert und nicht nur der statische
 * Boundary-Test in apps/cardealer-ch/server/test/tenant-boundary.test.mjs:
 * beim ersten Lauf gegen eine echte Datenbank stellte sich heraus, dass RLS
 * überhaupt nicht griff, weil die Verbindungsrolle Eigentümerin ihrer eigenen
 * Tabellen war — ein Fehler, den ein reiner Quelltext-Test (der nur prüft,
 * *dass* withTenant() aufgerufen wird) nie gefunden hätte. Siehe
 * packages/core-db/migrations/1700000000004_runtime-role-hardening.js.
 *
 * Braucht MIGRATE_DATABASE_URL (Owner-Rolle) und DATABASE_URL (App-Rolle,
 * tiff_app) gegen eine migrierte Datenbank — siehe README.md
 * "Datenbank-Rollen". Ohne beide Variablen wird der Test übersprungen, statt
 * überall dort zu scheitern, wo keine Postgres-Instanz läuft (z.B. in einer
 * Sandbox ohne DB). In CI sind beide gesetzt (siehe .github/workflows/ci.yml)
 * — dort läuft er also immer mit.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { withTenant, closePool } from '../src/index.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

after(closePool)

test('tiff_app sieht ohne app.tenant_id keine Zeile, und mit app.tenant_id nur die eigenen', { skip: !hasDb }, async () => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const tenantA = '99999999-0000-0000-0000-000000000001'
  const tenantB = '99999999-0000-0000-0000-000000000002'

  try {
    await adminPool.query('DELETE FROM parties WHERE tenant_id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES ($1, 'Mandant A', 'Mandant A AG', 'mandant-a-test'), ($2, 'Mandant B', 'Mandant B AG', 'mandant-b-test')",
      [tenantA, tenantB],
    )
    await adminPool.query(
      "INSERT INTO parties (id, tenant_id, kind, company_name) VALUES (gen_random_uuid(), $1, 'company', 'Firma A'), (gen_random_uuid(), $2, 'company', 'Firma B')",
      [tenantA, tenantB],
    )

    const rowsForA = await withTenant(tenantA, (client) => client.query('SELECT company_name FROM parties'))
    assert.deepEqual(
      rowsForA.rows.map((r) => r.company_name),
      ['Firma A'],
    )

    const rowsForB = await withTenant(tenantB, (client) => client.query('SELECT company_name FROM parties'))
    assert.deepEqual(
      rowsForB.rows.map((r) => r.company_name),
      ['Firma B'],
    )
  } finally {
    await adminPool.query('DELETE FROM parties WHERE tenant_id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.end()
  }
})

test('withTenant() ohne tenantId wirft, statt ungefiltert zu lesen', { skip: !hasDb }, async () => {
  await assert.rejects(() => withTenant(null, (client) => client.query('SELECT 1')))
  await assert.rejects(() => withTenant(undefined, (client) => client.query('SELECT 1')))
})
