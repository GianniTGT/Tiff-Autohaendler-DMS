/**
 * Mahnwesen — 1./2./3. Mahnung mit Verzugszins nach OR Art. 104 (5%,
 * ANFORDERUNGEN.md §9 Phase 2). Eine Mahnung ist ein eigenes Dokument
 * (type='reminder'), das über `predecessor_id` auf die ursprüngliche
 * Rechnung zeigt — dieselbe Belegkette wie Offerte -> Auftrag -> ... in
 * ANFORDERUNGEN.md §5.
 */
import { withTenant } from '@tiff/core-db'
import { calculateLateInterest, daysOverdue } from '@tiff/core-billing'
import { buildQrrReference } from '@tiff/core-billing/src/qr-invoice.js'
import { addDays, nextDocumentNumber } from './invoices.js'

const REMINDER_PAYMENT_TERM_DAYS = 10 // kürzere Frist als bei der Erstrechnung — üblich für Mahnungen
const MAX_REMINDER_LEVEL = 3

async function outstandingForInvoice(client, invoiceId) {
  const paidResult = await client.query(
    'SELECT COALESCE(SUM(amount_rappen), 0) AS paid FROM payments WHERE document_id = $1',
    [invoiceId],
  )
  return paidResult.rows[0].paid
}

/** Alle Rechnungen, die überfällig UND noch nicht vollständig bezahlt sind. */
export async function listOverdueInvoices(tenantId, asOfDate) {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10)
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT d.*, COALESCE(p.paid, 0) AS paid_rappen,
              (SELECT MAX(reminder_level) FROM documents r WHERE r.predecessor_id = d.id AND r.type = 'reminder') AS last_reminder_level
         FROM documents d
         LEFT JOIN (
           SELECT document_id, SUM(amount_rappen) AS paid FROM payments GROUP BY document_id
         ) p ON p.document_id = d.id
        WHERE d.type = 'invoice' AND d.due_date < $1 AND d.status != 'paid'
        ORDER BY d.due_date`,
      [today],
    )
    return result.rows
      .map((r) => ({ ...r, outstandingRappen: Number(r.total_rappen) - Number(r.paid_rappen) }))
      .filter((r) => r.outstandingRappen > 0)
  })
}

/**
 * @param {object} params { invoiceId, asOfDate }
 * @throws wenn die Rechnung nicht existiert, bereits bezahlt ist, oder
 *   bereits die 3. Mahnung gestellt wurde (danach ist Betreibung Sache eines
 *   Menschen, nicht der Software).
 */
export async function createReminder(tenantId, { invoiceId, asOfDate }) {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10)

  return withTenant(tenantId, async (client) => {
    const invoiceResult = await client.query("SELECT * FROM documents WHERE id = $1 AND type = 'invoice'", [invoiceId])
    const invoice = invoiceResult.rows[0]
    if (!invoice) throw new Error('Rechnung nicht gefunden.')

    const paid = await outstandingForInvoice(client, invoiceId)
    const outstandingRappen = Number(invoice.total_rappen) - Number(paid)
    if (outstandingRappen <= 0) throw new Error('Diese Rechnung ist bereits vollständig bezahlt.')

    const levelResult = await client.query(
      "SELECT MAX(reminder_level) AS max_level FROM documents WHERE predecessor_id = $1 AND type = 'reminder'",
      [invoiceId],
    )
    const level = (levelResult.rows[0].max_level ?? 0) + 1
    if (level > MAX_REMINDER_LEVEL) {
      throw new Error(`Für diese Rechnung wurde bereits die ${MAX_REMINDER_LEVEL}. Mahnung gestellt.`)
    }

    const dueDateIso = invoice.due_date instanceof Date ? invoice.due_date.toISOString().slice(0, 10) : invoice.due_date
    const overdueDays = daysOverdue(dueDateIso, today)
    const interestRappen = calculateLateInterest(outstandingRappen, dueDateIso, today)
    const totalRappen = outstandingRappen + interestRappen

    const tenantResult = await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
    const tenant = tenantResult.rows[0]

    const year = Number(today.slice(0, 4))
    const { number } = await nextDocumentNumber(client, tenantId, 'reminder', year)

    let qrReferenceType = 'NON'
    let qrReference = null
    if (tenant.qr_iban) {
      qrReferenceType = 'QRR'
      qrReference = buildQrrReference(`${year}${String(number).replace(/\D/g, '')}`)
    }

    const reminderResult = await client.query(
      `INSERT INTO documents
         (id, tenant_id, party_id, type, number, status, issue_date, due_date, predecessor_id,
          vehicle_id, subtotal_rappen, vat_rappen, total_rappen, qr_reference_type, qr_reference, reminder_level)
       VALUES (gen_random_uuid(), $1, $2, 'reminder', $3, 'issued', $4, $5, $6, $7, $8, 0, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        invoice.party_id,
        number,
        today,
        addDays(today, REMINDER_PAYMENT_TERM_DAYS),
        invoiceId,
        invoice.vehicle_id,
        totalRappen,
        totalRappen,
        qrReferenceType,
        qrReference,
        level,
      ],
    )
    const reminder = reminderResult.rows[0]

    const lines = [
      {
        position: 1,
        description: `Offener Betrag Rechnung ${invoice.number}`,
        quantity: 1,
        unitPriceRappen: outstandingRappen,
        lineTotal: outstandingRappen,
      },
    ]
    if (interestRappen > 0) {
      lines.push({
        position: 2,
        description: `Verzugszins (${overdueDays} Tage à 5%, OR Art. 104)`,
        quantity: 1,
        unitPriceRappen: interestRappen,
        lineTotal: interestRappen,
      })
    }
    for (const line of lines) {
      await client.query(
        `INSERT INTO document_lines (id, document_id, position, description, quantity, unit_price_rappen, line_total_rappen)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [reminder.id, line.position, line.description, line.quantity, line.unitPriceRappen, line.lineTotal],
      )
    }

    return { ...reminder, level, overdueDays, interestRappen, outstandingRappen, lines }
  })
}

export async function getReminder(tenantId, id) {
  return withTenant(tenantId, async (client) => {
    const docResult = await client.query("SELECT * FROM documents WHERE id = $1 AND type = 'reminder'", [id])
    const document = docResult.rows[0]
    if (!document) return null
    const linesResult = await client.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY position', [id])
    let party = null
    if (document.party_id) {
      const partyResult = await client.query('SELECT * FROM parties WHERE id = $1', [document.party_id])
      party = partyResult.rows[0] ?? null
    }
    const tenantResult = await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
    return { ...document, lines: linesResult.rows, party, tenant: tenantResult.rows[0] }
  })
}

export const REMINDER_LABEL = Object.freeze({ 1: '1. Mahnung', 2: '2. Mahnung', 3: '3. Mahnung' })
