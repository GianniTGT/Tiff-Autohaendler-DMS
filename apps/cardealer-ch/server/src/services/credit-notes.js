/**
 * Gutschriften. Korrigiert wird nie die ausgestellte Rechnung (sie ist
 * archiviert und unveränderlich), sondern es entsteht ein eigenes Dokument
 * GS-JJJJ-NNNNN, das auf sie zeigt und den Restbetrag senkt (siehe Migration
 * 1700000000016: Verbuchung als Zahlung der Art `credit_note`).
 *
 * Zwei Arten:
 *  - `full`: die ganze Rechnung, Zeile für Zeile mit denselben MWST-Sätzen.
 *    Nur möglich, solange noch nichts gutgeschrieben wurde.
 *  - `partial`: ein Bruttobetrag; die MWST wird im Verhältnis der Rechnung
 *    herausgerechnet. Höchstens bis zum noch nicht gutgeschriebenen Rest.
 *
 * ACHTUNG: Die MWST-Behandlung (Entgeltsminderung) ist nach bestem Wissen
 * gebaut, aber nicht von einem Treuhänder bestätigt (ANFORDERUNGEN.md §10).
 */
import { withTenant } from '@tiff/core-db'
import { nextDocumentNumber } from './invoices.js'
import { archivePdf } from './archive.js'
import { adjustSaleForCredit } from './vehicle-sale.js'
import { renderCreditNotePdfBuffer, withLogo } from './invoice-pdf.js'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const badInput = (message) => Object.assign(new Error(message), { statusCode: 400 })

/** Bereits gutgeschriebener Bruttobetrag einer Rechnung. */
async function creditedSoFar(client, invoiceId) {
  const row = (
    await client.query(
      "SELECT COALESCE(SUM(total_rappen), 0) AS credited FROM documents WHERE type = 'credit_note' AND predecessor_id = $1",
      [invoiceId],
    )
  ).rows[0]
  return Number(row.credited)
}

/**
 * @param {object} input { reason, mode: 'full'|'partial', amountRappen (nur partial) }
 * @returns {Promise<object|null>} das Dokument inkl. `archive`; null, wenn die Rechnung fehlt
 */
export async function createCreditNote(tenantId, userId, invoiceId, { reason, mode, amountRappen } = {}) {
  if (!reason || !String(reason).trim()) throw badInput('Bitte den Grund der Gutschrift angeben.')
  if (mode !== 'full' && mode !== 'partial') throw badInput('Unbekannte Art der Gutschrift.')
  if (mode === 'partial' && (!Number.isInteger(amountRappen) || amountRappen <= 0)) {
    throw badInput('Der Betrag muss eine ganze Zahl in Rappen und grösser als 0 sein.')
  }

  let vehicleEffect = null
  const document = await withTenant(tenantId, async (client) => {
    const invoice = (await client.query("SELECT * FROM documents WHERE id = $1 AND type = 'invoice' FOR UPDATE", [invoiceId])).rows[0]
    if (!invoice) return null

    const invoiceTotal = Number(invoice.total_rappen)
    const credited = await creditedSoFar(client, invoiceId)
    const remaining = invoiceTotal - credited
    if (remaining <= 0) throw badInput('Diese Rechnung ist bereits vollständig gutgeschrieben.')
    if (mode === 'full' && credited > 0) {
      throw badInput('Diese Rechnung wurde schon teilweise gutgeschrieben — bitte einen Teilbetrag wählen.')
    }
    if (mode === 'partial' && amountRappen > remaining) {
      throw badInput('Der Betrag übersteigt den noch nicht gutgeschriebenen Rest der Rechnung.')
    }

    const total = mode === 'full' ? invoiceTotal : amountRappen
    // MWST im Verhältnis der Rechnung (bei Vollgutschrift exakt die der Rechnung).
    const vat = mode === 'full' ? Number(invoice.vat_rappen) : Math.round((total * Number(invoice.vat_rappen)) / invoiceTotal)
    const subtotal = total - vat

    const date = today()
    const { number } = await nextDocumentNumber(client, tenantId, 'credit_note', Number(date.slice(0, 4)))
    const note = (
      await client.query(
        `INSERT INTO documents
           (id, tenant_id, party_id, type, number, status, issue_date, predecessor_id, vehicle_id,
            subtotal_rappen, vat_rappen, total_rappen, qr_reference_type, note)
         VALUES (gen_random_uuid(), $1, $2, 'credit_note', $3, 'issued', $4, $5, $6, $7, $8, $9, 'NON', $10)
         RETURNING *`,
        [tenantId, invoice.party_id, number, date, invoiceId, invoice.vehicle_id, subtotal, vat, total, String(reason).trim()],
      )
    ).rows[0]

    if (mode === 'full') {
      const lines = (await client.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position', [invoiceId])).rows
      for (const line of lines) {
        await client.query(
          `INSERT INTO document_lines (id, document_id, position, description, quantity, unit_price_rappen, tax_rate_id, line_total_rappen)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [note.id, line.position, line.description, line.quantity, line.unit_price_rappen, line.tax_rate_id, line.line_total_rappen],
        )
      }
    } else {
      const taxRate = (await client.query('SELECT tax_rate_id FROM document_lines WHERE document_id = $1 ORDER BY position LIMIT 1', [invoiceId])).rows[0]?.tax_rate_id ?? null
      await client.query(
        `INSERT INTO document_lines (id, document_id, position, description, quantity, unit_price_rappen, tax_rate_id, line_total_rappen)
         VALUES (gen_random_uuid(), $1, 1, $2, 1, $3, $4, $3)`,
        [note.id, `Teilgutschrift zu Rechnung ${invoice.number} (Betrag exkl. MWST)`, subtotal, taxRate],
      )
    }

    // Wie eine Zahlung verbuchen: senkt den Restbetrag überall, wo er berechnet wird.
    await client.query(
      `INSERT INTO payments (id, tenant_id, document_id, amount_rappen, paid_at, source, credit_note_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'credit_note', $5)`,
      [tenantId, invoiceId, total, date, note.id],
    )
    const paid = Number((await client.query('SELECT COALESCE(SUM(amount_rappen), 0) AS paid FROM payments WHERE document_id = $1', [invoiceId])).rows[0].paid)
    if (invoiceTotal - paid <= 0) await client.query("UPDATE documents SET status = 'paid' WHERE id = $1", [invoiceId])
    // Hat diese Rechnung das Fahrzeug verkauft: Preis mindern bzw. Verkauf aufheben.
    vehicleEffect = await adjustSaleForCredit(client, invoice, { creditTotalRappen: total, fullyCredited: credited + total >= invoiceTotal })
    return note
  })
  if (!document) return null

  // Archivieren: eine Gutschrift braucht keinen QR-Zahlteil, ist also immer vollständig.
  let archive = { archived: true }
  try {
    const full = await withLogo(tenantId, await getCreditNote(tenantId, document.id))
    await archivePdf(tenantId, { documentId: document.id, userId, pdfBuffer: await renderCreditNotePdfBuffer(full) })
  } catch (err) {
    archive = { archived: false, reason: err.message }
  }
  // Wird der Verkauf aufgehoben, bleibt ein deaktiviertes Inserat deaktiviert (ein Netzaufruf ohne Rückfrage wäre
  // hier zu viel); die Oberfläche weist darauf hin.
  let listingStaysInactive = false
  if (vehicleEffect === 'released') {
    const v = await withTenant(tenantId, async (client) => (await client.query('SELECT autoscout24_listing_id, autoscout24_active FROM vehicles WHERE id = $1', [document.vehicle_id])).rows[0])
    listingStaysInactive = Boolean(v?.autoscout24_listing_id) && v.autoscout24_active === false
  }
  return { ...(await getCreditNote(tenantId, document.id)), archive, vehicleEffect, listingStaysInactive }
}

/** Gutschrift mit Positionen, Partei, Betrieb und Nummer der zugehörigen Rechnung. */
export async function getCreditNote(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const doc = (await client.query("SELECT * FROM documents WHERE id = $1 AND type = 'credit_note'", [id])).rows[0]
    if (!doc) return null
    const lines = (await client.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position', [id])).rows
    const party = doc.party_id ? ((await client.query('SELECT * FROM parties WHERE id = $1', [doc.party_id])).rows[0] ?? null) : null
    const tenant = (await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])).rows[0]
    const invoice = doc.predecessor_id
      ? ((await client.query('SELECT number, issue_date FROM documents WHERE id = $1', [doc.predecessor_id])).rows[0] ?? null)
      : null
    return { ...doc, lines, party, tenant, invoiceNumber: invoice?.number ?? null, invoiceIssueDate: invoice?.issue_date ?? null }
  })
}

export async function listCreditNotes(tenantId, invoiceId) {
  return withTenant(tenantId, async (client) =>
    (
      await client.query(
        `SELECT id, number, issue_date, total_rappen, vat_rappen, note, pdf_hash
           FROM documents WHERE type = 'credit_note' AND predecessor_id = $1 ORDER BY created_at DESC`,
        [invoiceId],
      )
    ).rows.map((r) => ({
      id: r.id,
      number: r.number,
      issueDate: r.issue_date,
      totalRappen: Number(r.total_rappen),
      vatRappen: Number(r.vat_rappen),
      reason: r.note,
      archived: Boolean(r.pdf_hash),
    })),
  )
}
