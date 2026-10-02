/**
 * Belegarchiv — die Sicht darauf: welche Belege es gibt, ob ihr PDF
 * unveränderlich abgelegt ist, bis wann es aufzubewahren ist, und ob die
 * abgelegten Bytes noch zum gespeicherten Hash passen.
 *
 * Aufbewahrung: 10 Jahre (OR 958f, GeBüV), gezählt ab Ende des
 * Geschäftsjahres, in dem der Beleg entstand (OR 958f Abs. 1). Ohne
 * Geschäftsjahres-Angabe im System rechnet diese Sicht mit dem
 * Kalenderjahr: Ende des Belegjahres + 10 Jahre. Das ist die vorsichtige
 * Lesart; abweichende Geschäftsjahre kann ein Treuhänder nur länger machen.
 */
import { createHash } from 'node:crypto'
import { withTenant } from '@tiff/core-db'
import { createObjectStore } from '../integrations/object-storage/store.js'

export const RETENTION_YEARS = 10
export const ARCHIVE_TYPES = Object.freeze(['invoice', 'reminder', 'sale_contract', 'purchase_contract'])

const store = createObjectStore()

/** Letzter Aufbewahrungstag: 31.12. des Belegjahres + 10 Jahre. */
export function retainUntil(issueDate) {
  const year = Number(String(issueDate).slice(0, 4))
  return `${year + RETENTION_YEARS}-12-31`
}

export async function listArchive(tenantId) {
  return withTenant(tenantId, async (client) => {
    const rows = (
      await client.query(
        `SELECT d.id, d.type, d.number, d.issue_date, d.pdf_hash, d.pdf_storage_key, d.reminder_level,
                COALESCE(p.company_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS party_name,
                NULLIF(TRIM(CONCAT_WS(' ', v.make, v.model)), '') AS vehicle_label
           FROM documents d
           LEFT JOIN parties p ON p.id = d.party_id
           LEFT JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.type = ANY($1)
          ORDER BY d.issue_date DESC, d.number DESC`,
        [ARCHIVE_TYPES],
      )
    ).rows
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      number: r.number,
      issueDate: r.issue_date,
      partyName: r.party_name,
      vehicleLabel: r.vehicle_label,
      reminderLevel: r.reminder_level,
      archived: Boolean(r.pdf_hash && r.pdf_storage_key),
      hash: r.pdf_hash,
      retainUntil: retainUntil(r.issue_date),
    }))
  })
}

/**
 * Liest die abgelegten Bytes und vergleicht ihren SHA-256 mit dem
 * gespeicherten. `ok: false` heisst: die Datei im Speicher ist nicht mehr
 * die, die archiviert wurde (verändert, beschädigt oder weg).
 * @returns {Promise<{ok: boolean, reason?: string, hash?: string, storedHash?: string}|null>} null, wenn das Dokument fehlt
 */
export async function verifyArchived(tenantId, documentId) {
  const row = await withTenant(tenantId, async (client) =>
    (await client.query('SELECT pdf_hash, pdf_storage_key FROM documents WHERE id = $1', [documentId])).rows[0],
  )
  if (!row) return null
  if (!row.pdf_hash || !row.pdf_storage_key) return { ok: false, reason: 'NOT_ARCHIVED' }

  const bytes = await store.getObject(row.pdf_storage_key)
  if (!bytes) return { ok: false, reason: 'FILE_MISSING', storedHash: row.pdf_hash }
  const hash = createHash('sha256').update(bytes).digest('hex')
  return hash === row.pdf_hash ? { ok: true, hash, storedHash: row.pdf_hash } : { ok: false, reason: 'HASH_MISMATCH', hash, storedHash: row.pdf_hash }
}
