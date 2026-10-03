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
import { createZip } from './zip.js'

export const RETENTION_YEARS = 10
export const ARCHIVE_TYPES = Object.freeze(['invoice', 'reminder', 'credit_note', 'sale_contract', 'purchase_contract'])

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

const FOLDER = { invoice: 'Rechnungen', reminder: 'Mahnungen', credit_note: 'Gutschriften', sale_contract: 'Kaufvertraege', purchase_contract: 'Ankaufsvertraege' }
/**
 * CSV-Zelle in Anführungszeichen. Beginnt der Text mit = + - @ (oder Tab/CR),
 * würde Excel ihn als Formel ausführen — der Name einer öffentlichen Anfrage
 * landet hier über den Kunden. Ein vorangestelltes ' macht daraus Text.
 */
export const csvCell = (v) => {
  let text = String(v ?? '')
  // Zeichencodes statt Zeichenklasse: = + - @ Tab Zeilenumbruch
  const first = text.charCodeAt(0)
  if ([61, 43, 45, 64, 9, 13].includes(first)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Das ganze Belegarchiv als ZIP: alle archivierten PDFs nach Art geordnet,
 * dazu `index.csv` (Nummer, Art, Datum, Partei, SHA-256, Aufbewahrung bis,
 * Prüfergebnis) und `LIESMICH.txt`. Jede Datei wird beim Export gegen ihren
 * Hash geprüft — ein verändertes oder fehlendes PDF wird nicht stillschweigend
 * mitgeliefert, sondern im Index als solches gekennzeichnet.
 * Alles liegt im Arbeitsspeicher; für das Archiv eines Kleinbetriebs genügt
 * das, bei sehr grossen Beständen müsste der Export streamen.
 */
export async function buildArchiveExport(tenantId, now = new Date()) {
  const rows = await listArchive(tenantId)
  const keys = await withTenant(tenantId, async (client) =>
    new Map((await client.query('SELECT id, pdf_storage_key FROM documents WHERE pdf_storage_key IS NOT NULL')).rows.map((r) => [r.id, r.pdf_storage_key])),
  )

  const files = []
  const lines = ['Nummer;Art;Datum;Partei;Fahrzeug;SHA-256;Aufbewahren bis;Pruefung']
  let problems = 0
  for (const row of rows) {
    let check = 'NICHT_ARCHIVIERT'
    if (row.archived) {
      const bytes = await store.getObject(keys.get(row.id))
      if (!bytes) check = 'DATEI_FEHLT'
      else if (createHash('sha256').update(bytes).digest('hex') !== row.hash) check = 'HASH_ABWEICHEND'
      else check = 'OK'
      if (bytes) files.push({ name: `${FOLDER[row.type]}/${row.number}.pdf`, data: bytes })
    }
    if (check !== 'OK') problems += 1
    lines.push([row.number, row.type, row.issueDate, row.partyName, row.vehicleLabel, row.hash, row.retainUntil, check].map(csvCell).join(';'))
  }

  const CRLF = '\r\n'
  const readme = [
    'Belegarchiv-Export',
    `Erstellt: ${now.toISOString()}`,
    `Belege insgesamt: ${rows.length}, davon mit Auffälligkeit: ${problems}`,
    '',
    'Jede Datei in den Ordnern ist das PDF, das bei der Ausstellung unveränderlich abgelegt wurde.',
    'Prüfen: SHA-256 der Datei berechnen und mit der Spalte "SHA-256" in index.csv vergleichen',
    '(Windows: certutil -hashfile Datei.pdf SHA256; Mac/Linux: shasum -a 256 Datei.pdf).',
    '',
    `Aufbewahrungsfrist: Ende des Belegjahres + ${RETENTION_YEARS} Jahre (OR 958f, GeBueV).`,
    'Prüfung "NICHT_ARCHIVIERT": Beleg ausgestellt, PDF aber noch nicht abgelegt — kein PDF im Export.',
  ].join(CRLF)

  // UTF-8-BOM, damit Excel Umlaute in der CSV richtig öffnet.
  files.push({ name: 'index.csv', data: Buffer.from(`﻿${lines.join(CRLF)}${CRLF}`, 'utf8') })
  files.push({ name: 'LIESMICH.txt', data: Buffer.from(`${readme}${CRLF}`, 'utf8') })
  return { zip: createZip(files, now), count: files.length - 2, problems }
}
