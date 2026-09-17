/**
 * Integrationstest gegen echtes PostgreSQL — Kunden/Lieferanten.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { listParties, getParty, createParty, updateParty } from '../src/services/parties.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Parteien: erfassen, lesen, ändern, suchen, Mandantentrennung', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const tenantA = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'A', 'A AG', $1) RETURNING id",
      ['parties-test-a-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id
  const tenantB = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'B', 'B AG', $1) RETURNING id",
      ['parties-test-b-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id

  t.after(async () => {
    await adminPool.query('DELETE FROM parties WHERE tenant_id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]])
    await adminPool.end()
    await closePool()
  })

  await t.test('createParty für eine Person', async () => {
    const party = await createParty(tenantA, {
      kind: 'person',
      firstName: 'Sabit',
      lastName: 'Kadriu',
      email: 'sabit@example.test',
      phone: '079 000 00 00',
    })
    assert.equal(party.kind, 'person')
    assert.equal(party.lastName, 'Kadriu')
  })

  await t.test('createParty für eine Firma', async () => {
    const party = await createParty(tenantA, { kind: 'company', companyName: 'ImmoBit AG', uid: 'CHE-123.456.788' })
    assert.equal(party.companyName, 'ImmoBit AG')
  })

  await t.test('getParty liefert die erfasste Partei zurück', async () => {
    const created = await createParty(tenantA, { kind: 'person', firstName: 'Erina', lastName: 'Test' })
    const fetched = await getParty(tenantA, created.id)
    assert.equal(fetched.firstName, 'Erina')
  })

  await t.test('updateParty ändert nur die übergebenen Felder', async () => {
    const created = await createParty(tenantA, { kind: 'person', firstName: 'Isa', lastName: 'Test', phone: '000' })
    const updated = await updateParty(tenantA, created.id, { phone: '079 111 11 11' })
    assert.equal(updated.phone, '079 111 11 11')
    assert.equal(updated.firstName, 'Isa')
  })

  await t.test('listParties mit Suche filtert nach Name/E-Mail/Telefon', async () => {
    await createParty(tenantA, { kind: 'person', firstName: 'Zaza', lastName: 'Findme', email: 'findme@example.test' })
    const results = await listParties(tenantA, { search: 'findme' })
    assert.ok(results.some((p) => p.lastName === 'Findme'))
  })

  await t.test('Mandant B sieht Mandant As Parteien nicht', async () => {
    const bList = await listParties(tenantB)
    assert.equal(bList.length, 0)
  })
})
