/**
 * Belegarchiv — die Sicht darauf: welche Belege es gibt, ob ihr PDF
 * unveränderlich abgelegt ist, bis wann es aufzubewahren ist, und ob die
 * abgelegten Bytes noch zum gespeicherten Hash passen.
 *
 * Aufbewahrung: 10 Jahre (OR 958f, GeBüV), gezählt ab Ende des
 * Geschäftsjahres, in dem der Beleg entstand (OR 958f Abs. 1). Wann das
 * Geschäftsjahr endet, steht am Betrieb (`tenants.fiscal_year_end_month`,
 * Migration 21; Standard Dezember = Kalenderjahr).
 */
import { createHash } from 'node:crypto'
import { withTenant } from '@tiff/core-db'
import { createObjectStore } from '../integrations/object-storage/store.js'
import { createZipStream } from './zip.js'

export const RETENTION_YEARS = 10
export const ARCHIVE_TYPES = Object.freeze(['offer', 'order', 'delivery_note', 'invoice', 'reminder', 'credit_note', 'sale_contract', 'purchase_contract'])

const store = createObjectStore()

/**
 * Letzter Aufbewahrungstag: Ende des Geschäftsjahres, in dem der Beleg entstand, plus 10 Jahre.
 * Endet das Geschäftsjahr im Juni, gehört ein Beleg vom September schon zum Geschäftsjahr, das im
 * Juni des Folgejahres endet. Der Monatsletzte wird für das Zieljahr bestimmt (Schaltjahr-Februar).
 */
export function retainUntil(issueDate, fiscalYearEndMonth = 12) {
  const text = String(issueDate instanceof Date ? issueDate.toISOString() : issueDate)
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const endMonth = Number.isInteger(fiscalYearEndMonth) && fiscalYearEndMonth >= 1 && fiscalYearEndMonth <= 12 ? fiscalYearEndMonth : 12
  const fiscalYearEnd = month <= endMonth ? year : year + 1
  const targetYear = fiscalYearEnd + RETENTION_YEARS
  const lastDay = new Date(Date.UTC(targetYear, endMonth, 0)).getUTCDate() // Tag 0 des Folgemonats = Monatsletzter
  return `${targetYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

async function fiscalYearEndMonthOf(client, tenantId) {
  const row = (await client.query('SELECT fiscal_year_end_month FROM tenants WHERE id = $1', [tenantId])).rows[0]
  return row?.fiscal_year_end_month ?? 12
}

export async function listArchive(tenantId) {
  return withTenant(tenantId, async (client) => {
    const endMonth = await fiscalYearEndMonthOf(client, tenantId)
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
      retainUntil: retainUntil(r.issue_date, endMonth),
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

const FOLDER = { offer: 'Offerten', order: 'Auftraege', delivery_note: 'Lieferscheine', invoice: 'Rechnungen', reminder: 'Mahnungen', credit_note: 'Gutschriften', sale_contract: 'Kaufvertraege', purchase_contract: 'Ankaufsvertraege' }
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

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/**
 * Das ganze Belegarchiv als ZIP-Datenstrom: alle archivierten PDFs nach Art
 * geordnet, dazu `index.csv` (Nummer, Art, Datum, Partei, SHA-256,
 * Aufbewahrung bis, Prüfergebnis) und `LIESMICH.txt`. Jede Datei wird beim
 * Export gegen ihren Hash geprüft — ein verändertes oder fehlendes PDF wird
 * nicht stillschweigend mitgeliefert, sondern im Index als solches
 * gekennzeichnet.
 *
 * Streamt: im Speicher liegt immer nur das PDF, das gerade geschrieben wird,
 * plus der Index (eine Zeile pro Beleg). Index und Liesmich kommen zuletzt,
 * weil sie das Prüfergebnis aller Dateien zusammenfassen. `stats` ist
 * vollständig, sobald der Strom zu Ende ist.
 *
 * @returns {Promise<{stream: import('node:stream').Readable, stats: {count: number, problems: number, total: number}}>}
 */
export async function createArchiveExport(tenantId, now = new Date()) {
  const rows = await listArchive(tenantId)
  const { keys, endMonth } = await withTenant(tenantId, async (client) => ({
    keys: new Map((await client.query('SELECT id, pdf_storage_key FROM documents WHERE pdf_storage_key IS NOT NULL')).rows.map((r) => [r.id, r.pdf_storage_key])),
    endMonth: await fiscalYearEndMonthOf(client, tenantId),
  }))
  const stats = { count: 0, problems: 0, total: rows.length }
  const CRLF = '\r\n'

  async function* files() {
    const lines = ['Nummer;Art;Datum;Partei;Fahrzeug;SHA-256;Aufbewahren bis;Pruefung']
    for (const row of rows) {
      let check = 'NICHT_ARCHIVIERT'
      if (row.archived) {
        const bytes = await store.getObject(keys.get(row.id))
        if (!bytes) check = 'DATEI_FEHLT'
        else if (createHash('sha256').update(bytes).digest('hex') !== row.hash) check = 'HASH_ABWEICHEND'
        else check = 'OK'
        if (bytes) {
          stats.count += 1
          yield { name: `${FOLDER[row.type]}/${row.number}.pdf`, data: bytes }
        }
      }
      if (check !== 'OK') stats.problems += 1
      lines.push([row.number, row.type, row.issueDate, row.partyName, row.vehicleLabel, row.hash, row.retainUntil, check].map(csvCell).join(';'))
    }

    const readme = [
      'Belegarchiv-Export',
      `Erstellt: ${now.toISOString()}`,
      `Belege insgesamt: ${rows.length}, davon mit Auffälligkeit: ${stats.problems}`,
      '',
      'Jede Datei in den Ordnern ist das PDF, das bei der Ausstellung unveränderlich abgelegt wurde.',
      'Prüfen: SHA-256 der Datei berechnen und mit der Spalte "SHA-256" in index.csv vergleichen',
      '(Windows: certutil -hashfile Datei.pdf SHA256; Mac/Linux: shasum -a 256 Datei.pdf).',
      '',
      `Aufbewahrungsfrist: ${RETENTION_YEARS} Jahre ab Ende des Geschäftsjahres, in dem der Beleg entstand (OR 958f, GeBueV).`,
      `Geschäftsjahr dieses Betriebs endet im ${MONTH_NAMES[endMonth - 1]}${endMonth === 12 ? ' (Kalenderjahr)' : ''}.`,
      'Prüfung "NICHT_ARCHIVIERT": Beleg ausgestellt, PDF aber noch nicht abgelegt — kein PDF im Export.',
    ].join(CRLF)

    // UTF-8-BOM, damit Excel Umlaute in der CSV richtig öffnet.
    yield { name: 'index.csv', data: Buffer.from(`\uFEFF${lines.join(CRLF)}${CRLF}`, 'utf8') }
    yield { name: 'LIESMICH.txt', data: Buffer.from(`${readme}${CRLF}`, 'utf8') }
  }

  return { stream: createZipStream(files(), now), stats }
}

/** Derselbe Export, vollständig im Speicher — für Tests und kleine Archive. */
export async function buildArchiveExport(tenantId, now = new Date()) {
  const { stream, stats } = await createArchiveExport(tenantId, now)
  const parts = []
  for await (const chunk of stream) parts.push(chunk)
  return { zip: Buffer.concat(parts), count: stats.count, problems: stats.problems }
}
