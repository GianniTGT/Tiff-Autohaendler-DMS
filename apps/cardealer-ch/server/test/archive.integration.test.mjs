/**
 * Integrationstest gegen echtes PostgreSQL — Belegarchiv: PDF wird beim
 * ersten Mal in den Objektspeicher geschrieben, danach aus dem Speicher
 * gelesen statt neu gerendert, und ein abweichender Inhalt wird als
 * Integritätsfehler abgelehnt. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 *
 * Nutzt einen lokalen Objektspeicher in einem temporären Verzeichnis (nicht
 * den Default-Pfad `<cwd>/data/objects`), damit ein Testlauf keine Dateien
 * im Arbeitsbaum hinterlässt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { closePool } from '@tiff/core-db'
import { createInvoice, getInvoice } from '../src/services/invoices.js'
import { createParty } from '../src/services/parties.js'
import { renderInvoicePdfBuffer } from '../src/services/invoice-pdf.js'
import { archivePdf, getArchivedPdf, ArchiveIntegrityError } from '../src/services/archive.js'
import { createObjectStore } from '../src/integrations/object-storage/store.js'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)

test('Belegarchiv: Objektspeicher statt erneutem Rendern, Integritätsprüfung', { skip: !hasDb }, async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiff-archive-test-'))
  const objectStore = createObjectStore({ OBJECT_STORAGE_LOCAL_DIR: tmpDir })

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
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const party = await createParty(tenantId, { kind: 'person', firstName: 'Max', lastName: 'Muster' })
  const invoice = await createInvoice(tenantId, {
    partyId: party.id,
    issueDate: '2026-09-01',
    lines: [{ description: 'X', quantity: 1, unitPriceRappen: 100_000 }],
  })

  await t.test('getArchivedPdf liefert null, solange noch nichts archiviert wurde', async () => {
    const result = await getArchivedPdf(tenantId, invoice.id, { objectStore })
    assert.equal(result, null)
  })

  let firstBuffer
  await t.test('archivePdf speichert die Bytes im Objektspeicher und schreibt einen Audit-Eintrag', async () => {
    const full = await getInvoice(tenantId, invoice.id)
    firstBuffer = await renderInvoicePdfBuffer(full)
    const result = await archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: firstBuffer, objectStore })
    assert.equal(result.firstArchival, true)
    assert.equal(result.hash.length, 64)
    assert.ok(result.storageKey)

    const docResult = await adminPool.query('SELECT pdf_hash, pdf_storage_key FROM documents WHERE id = $1', [invoice.id])
    assert.equal(docResult.rows[0].pdf_hash, result.hash)
    assert.equal(docResult.rows[0].pdf_storage_key, result.storageKey)

    const auditResult = await adminPool.query(
      "SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'pdf_archived'",
      [invoice.id],
    )
    assert.equal(auditResult.rows.length, 1)
  })

  await t.test('getArchivedPdf liefert danach genau die archivierten Bytes zurück', async () => {
    const stored = await getArchivedPdf(tenantId, invoice.id, { objectStore })
    assert.ok(Buffer.isBuffer(stored))
    assert.ok(stored.equals(firstBuffer))
  })

  await t.test('ein zweiter Archivierungsversuch mit demselben Inhalt ist ein No-Op, kein zweiter Audit-Eintrag', async () => {
    const result = await archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: firstBuffer, objectStore })
    assert.equal(result.firstArchival, false)

    const auditResult = await adminPool.query(
      "SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'pdf_archived'",
      [invoice.id],
    )
    assert.equal(auditResult.rows.length, 1) // immer noch nur einer
  })

  await t.test('ein abweichender Inhalt für dasselbe Dokument wird als Integritätsfehler abgelehnt', async () => {
    const fakeBuffer = Buffer.from('etwas ganz anderes')
    await assert.rejects(
      () => archivePdf(tenantId, { documentId: invoice.id, userId: null, pdfBuffer: fakeBuffer, objectStore }),
      ArchiveIntegrityError,
    )
  })

  await t.test('ein späterer Layoutfehler-Fix würde die archivierte Rechnung nicht mehr betreffen', async () => {
    // Simuliert: der PDF-Rendering-Code hat sich geändert (andere Bytes),
    // aber getArchivedPdf() liest weiterhin die ursprünglich archivierte
    // Fassung — genau der Fehler, den Phase 2s Hash-Vergleich noch gehabt hätte.
    const differentBuffer = Buffer.from('ein ganz anderes PDF, als hätte sich der Rendering-Code geändert')
    const stored = await getArchivedPdf(tenantId, invoice.id, { objectStore })
    assert.ok(!stored.equals(differentBuffer))
    assert.ok(stored.equals(firstBuffer))
  })
})
