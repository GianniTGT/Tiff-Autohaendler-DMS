/**
 * Integrationstest gegen echtes PostgreSQL — Belegarchiv: Hash wird beim
 * ersten Mal gespeichert, ist danach unveränderlich, und dieselbe Rechnung
 * erzeugt bei erneutem Rendern denselben Hash (dank festem CreationDate).
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { closePool } from '@tiff/core-db'
import { createInvoice, getInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { renderInvoicePdfBuffer } from '../src/services/invoice-pdf.js'
import { archivePdf, ArchiveIntegrityError } from '../src/services/archive.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Belegarchiv: Hash speichern, Wiedererzeugung ist deterministisch, Integritätsprüfung', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'archive-test-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      "INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'A', 'A AG', $1) RETURNING id",
      [slug],
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
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Max', lastName: 'Muster' })
  const invoice = await createInvoice(tenantId, {
    partyId: party.id,
    issueDate: '2026-09-01',
    lines: [{ description: 'X', quantity: 1, unitPriceRappen: 100_000 }],
  })

  await t.test('zweimaliges Rendern derselben Rechnung erzeugt denselben PDF-Hash', async () => {
    const full = await getInvoice(tenantId, invoice.id)
    const bufferA = await renderInvoicePdfBuffer(full)
    const bufferB = await renderInvoicePdfBuffer(full)
    const { createHash } = await import('node:crypto')
    const hashA = createHash('sha256').update(bufferA).digest('hex')
    const hashB = createHash('sha256').update(bufferB).digest('hex')
    assert.equal(hashA, hashB)
  })

  await t.test('archivePdf speichert den Hash beim ersten Mal und schreibt einen Audit-Eintrag', async () => {
    const full = await getInvoice(tenantId, invoice.id)
    const buffer = await renderInvoicePdfBuffer(full)
    const result = await archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: buffer })
    assert.equal(result.firstArchival, true)
    assert.equal(result.hash.length, 64)

    const docResult = await adminPool.query('SELECT pdf_hash FROM documents WHERE id = $1', [invoice.id])
    assert.equal(docResult.rows[0].pdf_hash, result.hash)

    const auditResult = await adminPool.query(
      "SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'pdf_archived'",
      [invoice.id],
    )
    assert.equal(auditResult.rows.length, 1)
  })

  await t.test('ein zweiter Archivierungsversuch mit demselben Inhalt ist ein No-Op, kein zweiter Audit-Eintrag', async () => {
    const full = await getInvoice(tenantId, invoice.id)
    const buffer = await renderInvoicePdfBuffer(full)
    const result = await archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: buffer })
    assert.equal(result.firstArchival, false)

    const auditResult = await adminPool.query(
      "SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'pdf_archived'",
      [invoice.id],
    )
    assert.equal(auditResult.rows.length, 1) // immer noch nur einer
  })

  await t.test('ein abweichender Hash für dasselbe Dokument wird als Integritätsfehler abgelehnt', async () => {
    const fakeBuffer = Buffer.from('etwas ganz anderes')
    await assert.rejects(
      () => archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: fakeBuffer }),
      ArchiveIntegrityError,
    )
  })
})
