/**
 * Zahlungen — manuell erfasst oder aus einem camt.054-Import (siehe
 * camt054.js). Schliesst den Geldkreislauf, den ANFORDERUNGEN.md §9 für
 * Phase 2 vorsieht: eine Rechnung, die vollständig bezahlt ist, heisst
 * 'paid' statt weiter 'issued'.
 */
import { withTenant } from '@tiff/core-db'

/** Rechnungssumme minus bereits erfasste Zahlungen. Nie negativ als Ergebnis interpretieren — eine Überzahlung bleibt sichtbar, wird hier aber nicht automatisch verrechnet. */
export async function getOutstandingAmount(tenantId, documentId) {
  return withTenant(tenantId, async (client) => {
    const docResult = await client.query('SELECT total_rappen FROM documents WHERE id = $1', [documentId])
    const document = docResult.rows[0]
    if (!document) return null
    const paidResult = await client.query(
      'SELECT COALESCE(SUM(amount_rappen), 0) AS paid FROM payments WHERE document_id = $1',
      [documentId],
    )
    return Number(document.total_rappen) - Number(paidResult.rows[0].paid)
  })
}

export async function listPayments(tenantId, documentId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      'SELECT * FROM payments WHERE document_id = $1 ORDER BY paid_at, created_at',
      [documentId],
    )
    return result.rows
  })
}

/**
 * @param {object} fields { documentId, amountRappen, paidAt, source }
 *   `source` default 'manual' — 'camt054' wird nur vom Import gesetzt.
 */
export async function recordPayment(tenantId, { documentId, amountRappen, paidAt, source = 'manual' }) {
  if (!documentId || !amountRappen || !paidAt) {
    throw new Error('recordPayment() braucht documentId, amountRappen und paidAt.')
  }

  return withTenant(tenantId, async (client) => {
    const docResult = await client.query('SELECT id, total_rappen FROM documents WHERE id = $1', [documentId])
    const document = docResult.rows[0]
    if (!document) throw new Error('Dokument nicht gefunden.')

    const paymentResult = await client.query(
      `INSERT INTO payments (id, tenant_id, document_id, amount_rappen, paid_at, source)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, documentId, amountRappen, paidAt, source],
    )

    const paidResult = await client.query(
      'SELECT COALESCE(SUM(amount_rappen), 0) AS paid FROM payments WHERE document_id = $1',
      [documentId],
    )
    const outstanding = Number(document.total_rappen) - Number(paidResult.rows[0].paid)
    if (outstanding <= 0) {
      await client.query("UPDATE documents SET status = 'paid' WHERE id = $1", [documentId])
    }

    return { payment: paymentResult.rows[0], outstandingRappen: outstanding }
  })
}
