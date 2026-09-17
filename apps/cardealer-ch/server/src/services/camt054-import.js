/**
 * camt.054-Import: liest die Bankdatei, ordnet jede Gutschrift über die
 * QR-Referenz einer Rechnung zu und bucht sie als Zahlung. Nichts wird
 * stillschweigend übersprungen — jeder Eintrag kommt mit einem Grund
 * zurück, warum er zugeordnet wurde oder nicht (ANFORDERUNGEN.md §9).
 */
import { withTenant } from '@tiff/core-db'
import { parseCamt054 } from '@tiff/core-billing'
import { recordPayment } from './payments.js'

async function findDocumentIdByQrReference(tenantId, reference) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT id FROM documents WHERE qr_reference = $1', [reference])
    return result.rows[0]?.id ?? null
  })
}

/** Grobe Idempotenz: dieselbe camt.054-Datei zweimal eingelesen soll nicht doppelt gutschreiben. */
async function alreadyImported(tenantId, documentId, amountRappen, paidAt) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT 1 FROM payments
        WHERE document_id = $1 AND amount_rappen = $2 AND paid_at = $3 AND source = 'camt054'`,
      [documentId, amountRappen, paidAt],
    )
    return result.rows.length > 0
  })
}

/**
 * @param {string} xml
 * @returns {Promise<Array<{amountRappen:number, valueDate:string, reference:string|null,
 *   matched:boolean, reason?:string, documentId?:string, outstandingRappen?:number}>>}
 */
export async function importCamt054(tenantId, xml) {
  const entries = parseCamt054(xml)
  const results = []

  for (const entry of entries) {
    if (entry.creditDebitIndicator !== 'CRDT') {
      results.push({ ...entry, matched: false, reason: 'DEBIT_ENTRY' })
      continue
    }
    if (!entry.reference || !entry.referenceIsStructured) {
      results.push({ ...entry, matched: false, reason: 'NO_STRUCTURED_REFERENCE' })
      continue
    }

    const documentId = await findDocumentIdByQrReference(tenantId, entry.reference)
    if (!documentId) {
      results.push({ ...entry, matched: false, reason: 'NO_MATCHING_INVOICE' })
      continue
    }

    if (await alreadyImported(tenantId, documentId, entry.amountRappen, entry.valueDate)) {
      results.push({ ...entry, matched: false, reason: 'ALREADY_IMPORTED', documentId })
      continue
    }

    const { outstandingRappen } = await recordPayment(tenantId, {
      documentId,
      amountRappen: entry.amountRappen,
      paidAt: entry.valueDate,
      source: 'camt054',
    })
    results.push({ ...entry, matched: true, documentId, outstandingRappen })
  }

  return results
}
