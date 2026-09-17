#!/usr/bin/env node
/**
 * Legt für die lokale Entwicklung einen Mandanten und die erste Person an.
 * Kein Self-Service-Onboarding (das gibt es erst in Phase 3, ANFORDERUNGEN.md
 * §9) — für den Piloten reicht ein Skript, das ein Mensch einmal ausführt.
 *
 * Aufruf:
 *   node --env-file=.env packages/core-db/scripts/seed-dev-tenant.mjs \
 *     --slug=bit-automobile --name="ImmoBit AG" --email=sabit@example.com --password="..."
 */
import pg from 'pg'
import { hashPassword } from '@tiff/core-auth'

function arg(name, fallback) {
  const prefix = `--${name}=`
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

const slug = arg('slug')
const legalName = arg('name')
const email = arg('email')
const password = arg('password')

if (!slug || !legalName || !email || !password) {
  console.error(
    'Braucht --slug, --name, --email, --password. Beispiel:\n' +
      '  node --env-file=.env packages/core-db/scripts/seed-dev-tenant.mjs --slug=bit-automobile --name="ImmoBit AG" --email=sabit@example.com --password="..."',
  )
  process.exit(1)
}

// Läuft bewusst über MIGRATE_DATABASE_URL (tiff_migrator, BYPASSRLS) statt
// über withTenant(): das Anlegen eines MANDANTEN selbst kann nicht innerhalb
// des eigenen Mandanten-Scopes passieren, den es ja erst schafft — siehe
// packages/core-db/migrations/1700000000005_tenant-login-lookup.js.
const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })

const tenantResult = await pool.query(
  'INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id',
  [legalName, slug],
)
const tenantId = tenantResult.rows[0].id

const passwordHash = await hashPassword(password)
await pool.query(
  "INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (gen_random_uuid(), $1, $2, $2, $3, 'inhaber')",
  [tenantId, email, passwordHash],
)

console.log(`Mandant '${legalName}' angelegt (Slug: ${slug}, ID: ${tenantId}), Login: ${email}`)
await pool.end()
