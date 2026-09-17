/**
 * Belegarchiv — SHA-256-Hash UND die tatsächlichen PDF-Bytes, unveränderlich
 * abgelegt (ANFORDERUNGEN.md §7/§9: "Rechnungen als PDF unveränderbar
 * archivieren, mit Hash und Audit-Eintrag", OR 958f/GeBüV 10 Jahre
 * Aufbewahrung).
 *
 * **Phase 2 hatte nur den Hash** und verglich ihn bei jedem Abruf gegen ein
 * frisch gerendertes PDF — das funktioniert nur, solange der
 * PDF-Rendering-Code sich nie ändert. Ein künftiger Layout-Fix hätte bei
 * jeder historischen Rechnung `ArchiveIntegrityError` ausgelöst, obwohl
 * inhaltlich nichts falsch war (siehe die Migration
 * 1700000000008_pdf-storage-key.js). **Der Objektspeicher ist die
 * Korrektur:** einmal archiviert, kommt das PDF beim nächsten Abruf aus dem
 * Speicher (`getArchivedPdf()`), nicht aus einer erneuten Erzeugung. Nur
 * beim allerersten Archivieren wird überhaupt gerendert.
 */
import { createHash } from 'node:crypto'
import { withTenant } from '@tiff/core-db'
import { createObjectStore } from '../integrations/object-storage/store.js'

export class ArchiveIntegrityError extends Error {}

const defaultObjectStore = createObjectStore()

function storageKeyFor(tenantId, documentId) {
  return `${tenantId}/documents/${documentId}.pdf`
}

/**
 * Archiviert ein PDF, wenn es das noch nicht ist. Wird archivePdf() aus
 * irgendeinem Grund doch ein zweites Mal mit anderen Bytes aufgerufen (z.B.
 * ein Aufrufer, der `getArchivedPdf()` übersprungen hat), wird das als
 * Integritätsfehler gemeldet statt still ignoriert — dieselbe Disziplin wie
 * in Phase 2, nur seltener nötig, weil routes/invoices.js jetzt zuerst
 * `getArchivedPdf()` fragt.
 */
export async function archivePdf(tenantId, { documentId, userId, pdfBuffer, objectStore = defaultObjectStore }) {
  const hash = createHash('sha256').update(pdfBuffer).digest('hex')

  return withTenant(tenantId, async (client) => {
    const docResult = await client.query('SELECT pdf_hash, pdf_storage_key FROM documents WHERE id = $1', [
      documentId,
    ])
    const existing = docResult.rows[0]
    if (!existing) throw new Error('Dokument nicht gefunden.')

    if (existing.pdf_hash) {
      if (existing.pdf_hash !== hash) {
        throw new ArchiveIntegrityError(
          `Der Hash von Dokument ${documentId} hat sich geändert (war ${existing.pdf_hash}, ist jetzt ${hash}). ` +
            'Das Dokument gilt als archiviert und darf sich nicht mehr ändern.',
        )
      }
      return { hash, firstArchival: false, storageKey: existing.pdf_storage_key }
    }

    const storageKey = storageKeyFor(tenantId, documentId)
    await objectStore.putObject(storageKey, pdfBuffer, 'application/pdf')

    await client.query('UPDATE documents SET pdf_hash = $1, pdf_storage_key = $2 WHERE id = $3', [
      hash,
      storageKey,
      documentId,
    ])
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'pdf_archived', 'document', $3, $4)`,
      [tenantId, userId ?? null, documentId, JSON.stringify({ hash, storageKey, backend: objectStore.backend })],
    )
    return { hash, firstArchival: true, storageKey }
  })
}

/**
 * @returns {Promise<Buffer|null>} die archivierten Bytes, oder null, wenn
 *   für dieses Dokument noch nichts archiviert wurde.
 */
export async function getArchivedPdf(tenantId, documentId, { objectStore = defaultObjectStore } = {}) {
  const storageKey = await withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT pdf_storage_key FROM documents WHERE id = $1', [documentId])
    return result.rows[0]?.pdf_storage_key ?? null
  })
  if (!storageKey) return null
  return objectStore.getObject(storageKey)
}
