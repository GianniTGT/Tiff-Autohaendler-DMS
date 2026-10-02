/**
 * Rechnungen/Mahnungen werden beim Ausstellen sofort archiviert — aber nur,
 * wenn sie vollständig sind. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-issue-'))

const { closePool } = await import('@tiff/core-db')
const { createInvoice, getInvoice } = await import('../src/services/invoices.js')
const { createParty } = await import('../src/services/parties.js')
const { archiveIfComplete } = await import('../src/services/archive.js')
const { renderInvoicePdfBuffer, withLogo } = await import('../src/services/invoice-pdf.js')
const { verifyArchived, listArchive } = await import('../src/services/archive-browser.js')
const { updateTenantSettings } = await import('../src/services/tenant-settings.js')

test('Archivieren beim Ausstellen', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city)
       VALUES (gen_random_uuid(), 'issue', 'Issue AG', $1, 'Teststrasse 1', '3000', 'Bern') RETURNING id`,
      ['issue-' + Math.random().toString(36).slice(2, 8)],
    )
  ).rows[0].id
  t.after(async () => {
    await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [tenantId])
    await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const full = await createParty(tenantId, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const noAddress = await createParty(tenantId, { kind: 'person', firstName: 'Ohne', lastName: 'Adresse' })
  const issue = async (partyId) => {
    const inv = await createInvoice(tenantId, { partyId, issueDate: '2026-06-01', lines: [{ description: 'Test', quantity: 1, unitPriceRappen: 100_000 }] })
    return archiveIfComplete(tenantId, null, await withLogo(tenantId, await getInvoice(tenantId, inv.id)), renderInvoicePdfBuffer).then((r) => ({ ...r, id: inv.id }))
  }

  await t.test('ohne QR-IBAN: nicht archiviert, mit Begründung', async () => {
    const r = await issue(full.id)
    assert.equal(r.archived, false)
    assert.match(r.reason, /QR-IBAN/)
    assert.equal((await verifyArchived(tenantId, r.id)).reason, 'NOT_ARCHIVED')
  })

  await updateTenantSettings(tenantId, { qrIban: 'CH44 3199 9123 0008 8901 2' })

  await t.test('Kundenadresse fehlt: nicht archiviert', async () => {
    const r = await issue(noAddress.id)
    assert.equal(r.archived, false)
    assert.match(r.reason, /Adresse der Kundschaft/)
  })

  await t.test('vollständig: sofort archiviert, Hash stimmt, genau ein Audit-Eintrag', async () => {
    const r = await issue(full.id)
    assert.equal(r.archived, true)
    assert.equal((await verifyArchived(tenantId, r.id)).ok, true)
    const audit = await adminPool.query('SELECT action FROM audit_log WHERE entity_id = $1', [r.id])
    assert.deepEqual(audit.rows.map((a) => a.action), ['pdf_archived'])
    const row = (await listArchive(tenantId)).find((x) => x.id === r.id)
    assert.equal(row.archived, true)
  })

  await t.test('ein Fehler beim Rendern verhindert nie das Ausstellen (wirft nicht)', async () => {
    const inv = await createInvoice(tenantId, { partyId: full.id, lines: [{ description: 'x', quantity: 1, unitPriceRappen: 1000 }] })
    const r = await archiveIfComplete(tenantId, null, await getInvoice(tenantId, inv.id), async () => { throw new Error('Renderfehler') })
    assert.deepEqual(r, { archived: false, reason: 'Renderfehler' })
  })
})
