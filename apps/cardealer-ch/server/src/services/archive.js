/**
 * Belegarchiv — SHA-256-Hash des erzeugten PDF, unveränderlich gespeichert
 * (ANFORDERUNGEN.md §7/§9: "Rechnungen als PDF unveränderbar archivieren,
 * mit Hash und Audit-Eintrag", OR 958f/GeBüV 10 Jahre Aufbewahrung).
 *
 * Was das hier NICHT ist: ein Dateiarchiv. Die PDF-Bytes selbst werden
 * nicht gespeichert — nur ihr Fingerabdruck. Ein Objektspeicher (S3-
 * kompatibel, Schweizer Region) ist in SCHWEIZ-SAAS.md §2 als Infrastruktur
 * vorgesehen, aber noch nicht bestellt; bis dahin beweist der Hash, dass ein
 * später erneut erzeugtes PDF (deterministisch dank fixem CreationDate,
 * siehe invoice-pdf.js) inhaltlich mit dem archivierten übereinstimmt, auch
 * ohne dass die Datei selbst irgendwo liegt.
 */
import { createHash } from 'node:crypto'
import { withTenant } from '@tiff/core-db'

export class ArchiveIntegrityError extends Error {}

/**
 * Beim ersten Aufruf für ein Dokument wird der Hash gespeichert. Bei jedem
 * weiteren Aufruf wird geprüft, nicht überschrieben — eine Abweichung
 * bedeutet entweder einen Fehler im PDF-Aufbau oder eine nachträgliche
 * Änderung der Belegdaten, und beides muss auffallen, nie still repariert
 * werden.
 */
export async function archivePdf(tenantId, { documentId, userId, pdfBuffer }) {
  const hash = createHash('sha256').update(pdfBuffer).digest('hex')

  return withTenant(tenantId, async (client) => {
    const docResult = await client.query('SELECT pdf_hash FROM documents WHERE id = $1', [documentId])
    const existing = docResult.rows[0]
    if (!existing) throw new Error('Dokument nicht gefunden.')

    if (existing.pdf_hash) {
      if (existing.pdf_hash !== hash) {
        throw new ArchiveIntegrityError(
          `Der Hash von Dokument ${documentId} hat sich geändert (war ${existing.pdf_hash}, ist jetzt ${hash}). ` +
            'Das Dokument gilt als archiviert und darf sich nicht mehr ändern.',
        )
      }
      return { hash, firstArchival: false }
    }

    await client.query('UPDATE documents SET pdf_hash = $1 WHERE id = $2', [hash, documentId])
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'pdf_archived', 'document', $3, $4)`,
      [tenantId, userId ?? null, documentId, JSON.stringify({ hash })],
    )
    return { hash, firstArchival: true }
  })
}
