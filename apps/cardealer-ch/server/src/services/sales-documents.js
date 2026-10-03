/**
 * Belegkette: Offerte (OF) → Auftrag (AU) → Lieferschein (LS) → Rechnung (RE).
 *
 * Jeder Beleg ist ein eigenes, beim Ausstellen archiviertes Dokument
 * (unveränderlich, OR 958f) und zeigt über `predecessor_id` auf den
 * vorigen. Ändern heisst nie überschreiben: eine falsche Offerte wird
 * abgelehnt/ersetzt, ein falscher Auftrag storniert.
 *
 *  Offerte        issued → accepted (durch Auftrag) | declined
 *  Auftrag        issued → delivered (durch Lieferschein) → invoiced | cancelled
 *  Lieferschein   issued → invoiced
 *
 * Ein Auftrag mit Fahrzeug reserviert es (in_stock → reserved); Stornieren
 * gibt es wieder frei, sofern kein anderer offener Auftrag darauf besteht.
 * Abgelaufene Offerten (gültig bis < heute) lassen sich nicht mehr in einen
 * Auftrag wandeln — dann eine neue ausstellen.
 */
import { withTenant } from '@tiff/core-db'
import { nextDocumentNumber, addDays, createInvoice, getInvoice } from './invoices.js'
import { priceLines, insertLines } from './document-lines.js'
import { archivePdf, archiveIfComplete } from './archive.js'
import { renderSalesDocumentPdfBuffer, renderInvoicePdfBuffer, withLogo } from './invoice-pdf.js'

export const SALES_TYPES = Object.freeze(['offer', 'order', 'delivery_note'])
const OFFER_VALID_DAYS = 30

const badInput = (message) => Object.assign(new Error(message), { statusCode: 400 })
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const day = (v) => (v ? String(v).slice(0, 10) : null)

export const isExpiredOffer = (doc, now = today()) => doc.type === 'offer' && doc.status === 'issued' && day(doc.due_date) != null && day(doc.due_date) < now

async function assertParty(client, partyId) {
  if (!partyId) throw badInput('Bitte einen Kunden wählen.')
  const found = await client.query('SELECT 1 FROM parties WHERE id = $1', [partyId])
  if (found.rows.length === 0) throw badInput('Der Kunde wurde nicht gefunden.')
}

async function assertVehicle(client, vehicleId) {
  if (!vehicleId) return
  const found = await client.query('SELECT 1 FROM vehicles WHERE id = $1', [vehicleId])
  if (found.rows.length === 0) throw badInput('Das Fahrzeug wurde nicht gefunden.')
}

/** Zeilen eines Belegs in der Eingabeform, die priceLines() erwartet (MWST-Code statt Satz-ID). */
async function readLinesAsInput(client, documentId) {
  return (
    await client.query(
      `SELECT l.description, l.quantity, l.unit_price_rappen, t.code AS tax_code
         FROM document_lines l LEFT JOIN tax_rates t ON t.id = l.tax_rate_id
        WHERE l.document_id = $1 ORDER BY l.position`,
      [documentId],
    )
  ).rows.map((r) => ({ description: r.description, quantity: Number(r.quantity), unitPriceRappen: Number(r.unit_price_rappen), taxCode: r.tax_code ?? 'standard' }))
}

async function insertDocument(client, tenantId, { type, party, vehicleId, lines, predecessorId, validUntil, note }) {
  const date = today()
  const { number } = await nextDocumentNumber(client, tenantId, type, Number(date.slice(0, 4)))
  const { computedLines, subtotalRappen, vatRappen, totalRappen } = await priceLines(client, lines, date)
  const dueDate = type === 'offer' ? (validUntil ?? addDays(date, OFFER_VALID_DAYS)) : null
  if (dueDate && dueDate < date) throw badInput('«Gültig bis» liegt in der Vergangenheit.')

  const row = (
    await client.query(
      `INSERT INTO documents
         (id, tenant_id, party_id, type, number, status, issue_date, due_date, predecessor_id, vehicle_id,
          subtotal_rappen, vat_rappen, total_rappen, qr_reference_type, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'issued', $5, $6, $7, $8, $9, $10, $11, 'NON', $12) RETURNING *`,
      [tenantId, party, type, number, date, dueDate, predecessorId ?? null, vehicleId ?? null, subtotalRappen, vatRappen, totalRappen, note ? String(note).trim() : null],
    )
  ).rows[0]
  await insertLines(client, row.id, computedLines)
  return row
}

async function reserveVehicle(client, vehicleId) {
  if (vehicleId) await client.query("UPDATE vehicles SET status = 'reserved' WHERE id = $1 AND status = 'in_stock'", [vehicleId])
}

async function releaseVehicle(client, vehicleId, exceptOrderId) {
  if (!vehicleId) return
  const other = await client.query(
    "SELECT 1 FROM documents WHERE type = 'order' AND vehicle_id = $1 AND status IN ('issued', 'delivered') AND id <> $2 LIMIT 1",
    [vehicleId, exceptOrderId],
  )
  if (other.rows.length === 0) await client.query("UPDATE vehicles SET status = 'in_stock' WHERE id = $1 AND status = 'reserved'", [vehicleId])
}

/** Legt das PDF unveränderlich ab. Eine Offerte/ein Auftrag braucht keinen Zahlteil — ist also immer vollständig. */
async function archiveSalesDocument(tenantId, userId, id) {
  try {
    const full = await withLogo(tenantId, await getSalesDocument(tenantId, id))
    await archivePdf(tenantId, { documentId: id, userId, pdfBuffer: await renderSalesDocumentPdfBuffer(full) })
    return { archived: true }
  } catch (err) {
    return { archived: false, reason: err.message }
  }
}

/**
 * Offerte oder Auftrag direkt ausstellen (ohne Vorgänger). Der Lieferschein
 * entsteht nur aus einem Auftrag (convertSalesDocument).
 */
export async function createSalesDocument(tenantId, userId, type, { partyId, vehicleId, lines, validUntil, note } = {}) {
  if (type !== 'offer' && type !== 'order') throw badInput('Unbekannte Belegart.')
  const row = await withTenant(tenantId, async (client) => {
    await assertParty(client, partyId)
    await assertVehicle(client, vehicleId)
    const doc = await insertDocument(client, tenantId, { type, party: partyId, vehicleId, lines, validUntil, note })
    if (type === 'order') await reserveVehicle(client, vehicleId)
    return doc
  })
  const archive = await archiveSalesDocument(tenantId, userId, row.id)
  return { ...(await getSalesDocument(tenantId, row.id)), archive }
}

const NEXT = { offer: ['order'], order: ['delivery_note', 'invoice'], delivery_note: ['invoice'] }

/**
 * Wandelt einen Beleg in den nächsten der Kette. @returns {Promise<object|null>} der neue Beleg (bei
 * `invoice` die Rechnung samt `archive`); null, wenn der Quellbeleg fehlt.
 */
export async function convertSalesDocument(tenantId, userId, id, to, { note } = {}) {
  const outcome = await withTenant(tenantId, async (client) => {
    const source = (await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id])).rows[0]
    if (!source || !SALES_TYPES.includes(source.type)) return null
    if (!(NEXT[source.type] ?? []).includes(to)) {
      throw badInput(`Aus einer ${LABEL[source.type]} lässt sich kein(e) ${LABEL[to] ?? to} erstellen.`)
    }
    if (isExpiredOffer(source)) throw badInput('Diese Offerte ist abgelaufen — bitte eine neue Offerte ausstellen.')
    if (source.status === 'declined' || source.status === 'cancelled') throw badInput(`Ein ${source.status === 'declined' ? 'abgelehnter' : 'stornierter'} Beleg lässt sich nicht weiterführen.`)

    const successors = (await client.query('SELECT type, status FROM documents WHERE predecessor_id = $1', [id])).rows
    const lines = await readLinesAsInput(client, id)

    if (to === 'order') {
      if (source.status === 'accepted') throw badInput('Aus dieser Offerte wurde schon ein Auftrag erstellt.')
      const order = await insertDocument(client, tenantId, { type: 'order', party: source.party_id, vehicleId: source.vehicle_id, lines, predecessorId: id, note })
      await client.query("UPDATE documents SET status = 'accepted' WHERE id = $1", [id])
      await reserveVehicle(client, source.vehicle_id)
      return { kind: 'sales', id: order.id }
    }

    if (to === 'delivery_note') {
      if (successors.some((s) => s.type === 'delivery_note' && s.status !== 'cancelled')) throw badInput('Zu diesem Auftrag gibt es schon einen Lieferschein.')
      const dn = await insertDocument(client, tenantId, { type: 'delivery_note', party: source.party_id, vehicleId: source.vehicle_id, lines, predecessorId: id, note })
      await client.query("UPDATE documents SET status = 'delivered' WHERE id = $1", [id])
      return { kind: 'sales', id: dn.id }
    }

    // → Rechnung: aus Auftrag oder Lieferschein, höchstens einmal je Auftrag.
    const orderId = source.type === 'order' ? source.id : source.predecessor_id
    const chain = (await client.query('SELECT id FROM documents WHERE id = $1 OR predecessor_id = $1', [orderId ?? source.id])).rows.map((r) => r.id)
    const already = await client.query("SELECT number FROM documents WHERE type = 'invoice' AND predecessor_id = ANY($1) LIMIT 1", [chain])
    if (already.rows.length > 0) throw badInput(`Dazu gibt es schon die Rechnung ${already.rows[0].number}.`)
    return { kind: 'invoice', source, lines, orderId }
  })
  if (!outcome) return null

  if (outcome.kind === 'sales') return { ...(await getSalesDocument(tenantId, outcome.id)), archive: await archiveSalesDocument(tenantId, userId, outcome.id) }

  // Rechnung ausserhalb der Transaktion erstellen (createInvoice öffnet eine eigene), dann Kette fortschreiben.
  const { source, lines, orderId } = outcome
  const invoice = await createInvoice(tenantId, { partyId: source.party_id, vehicleId: source.vehicle_id, lines, predecessorId: source.id })
  await withTenant(tenantId, async (client) => {
    await client.query("UPDATE documents SET status = 'invoiced' WHERE id = ANY($1)", [[source.id, orderId].filter(Boolean)])
  })
  const archive = await archiveIfComplete(tenantId, userId, await withLogo(tenantId, await getInvoice(tenantId, invoice.id)), renderInvoicePdfBuffer)
  return { ...invoice, archive }
}

/** Offerte ablehnen oder Auftrag stornieren. */
export async function setSalesDocumentStatus(tenantId, id, status) {
  return withTenant(tenantId, async (client) => {
    const doc = (await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id])).rows[0]
    if (!doc || !SALES_TYPES.includes(doc.type)) return null
    if (doc.type === 'offer' && status === 'declined') {
      if (doc.status !== 'issued') throw badInput('Nur eine offene Offerte lässt sich ablehnen.')
    } else if (doc.type === 'order' && status === 'cancelled') {
      if (doc.status !== 'issued') throw badInput(doc.status === 'cancelled' ? 'Der Auftrag ist schon storniert.' : 'Ein Auftrag mit Lieferschein oder Rechnung lässt sich nicht mehr stornieren.')
    } else {
      throw badInput('Dieser Statuswechsel ist nicht möglich.')
    }
    await client.query('UPDATE documents SET status = $1 WHERE id = $2', [status, id])
    if (doc.type === 'order') await releaseVehicle(client, doc.vehicle_id, id)
    return (await getSalesDocumentWithClient(client, id))
  })
}

async function getSalesDocumentWithClient(client, id) {
  const doc = (await client.query('SELECT * FROM documents WHERE id = $1', [id])).rows[0]
  if (!doc || !SALES_TYPES.includes(doc.type)) return null
  const lines = (await client.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position', [id])).rows
  const party = doc.party_id ? ((await client.query('SELECT * FROM parties WHERE id = $1', [doc.party_id])).rows[0] ?? null) : null
  const tenant = (await client.query('SELECT * FROM tenants WHERE id = $1', [doc.tenant_id])).rows[0]
  const vehicle = doc.vehicle_id ? ((await client.query('SELECT * FROM vehicles WHERE id = $1', [doc.vehicle_id])).rows[0] ?? null) : null
  const predecessor = doc.predecessor_id ? ((await client.query('SELECT id, type, number, issue_date FROM documents WHERE id = $1', [doc.predecessor_id])).rows[0] ?? null) : null
  const successors = (await client.query('SELECT id, type, number, status FROM documents WHERE predecessor_id = $1 ORDER BY created_at', [id])).rows
  return { ...doc, lines, party, tenant, vehicle, predecessor, successors, expired: isExpiredOffer(doc) }
}

/** Beleg mit Positionen, Partei, Fahrzeug, Betrieb und Kette (Vorgänger/Nachfolger). */
export async function getSalesDocument(tenantId, id) {
  return withTenant(tenantId, (client) => getSalesDocumentWithClient(client, id))
}

export async function listSalesDocuments(tenantId, { type } = {}) {
  if (type && !SALES_TYPES.includes(type)) throw badInput('Unbekannte Belegart.')
  return withTenant(tenantId, async (client) => {
    const rows = (
      await client.query(
        `SELECT d.id, d.type, d.number, d.status, d.issue_date, d.due_date, d.total_rappen, d.pdf_hash,
                COALESCE(p.company_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS party_name,
                NULLIF(TRIM(CONCAT_WS(' ', v.make, v.model)), '') AS vehicle_label,
                pre.number AS predecessor_number,
                (SELECT number FROM documents s WHERE s.predecessor_id = d.id AND s.type = 'invoice' LIMIT 1) AS invoice_number
           FROM documents d
           LEFT JOIN parties p ON p.id = d.party_id
           LEFT JOIN vehicles v ON v.id = d.vehicle_id
           LEFT JOIN documents pre ON pre.id = d.predecessor_id
          WHERE d.type = ANY($1)
          ORDER BY d.issue_date DESC, d.number DESC`,
        [type ? [type] : SALES_TYPES],
      )
    ).rows
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      number: r.number,
      status: r.status,
      issueDate: r.issue_date,
      validUntil: r.due_date,
      totalRappen: Number(r.total_rappen),
      partyName: r.party_name,
      vehicleLabel: r.vehicle_label,
      predecessorNumber: r.predecessor_number,
      invoiceNumber: r.invoice_number,
      archived: Boolean(r.pdf_hash),
      expired: isExpiredOffer({ type: r.type, status: r.status, due_date: r.due_date }),
    }))
  })
}

const LABEL = { offer: 'Offerte', order: 'Auftrag', delivery_note: 'Lieferschein', invoice: 'Rechnung' }
