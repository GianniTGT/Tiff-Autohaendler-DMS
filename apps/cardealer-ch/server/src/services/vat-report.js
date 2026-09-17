/**
 * MWST-Auswertung — effektiv oder Saldosteuersatz, je nach
 * `tenants.vat_method` (ANFORDERUNGEN.md §9 Phase 2, §4.2/§4.3).
 *
 * WICHTIG (wie schon in packages/core-billing/src/tax.js vermerkt): diese
 * Berechnung ist nach bestem Wissen aus MWSTG Art. 28a/24a nachgebaut, aber
 * NICHT von einem Treuhänder bestätigt. Vor der ersten echten Abrechnung
 * gegenprüfen (ANFORDERUNGEN.md §6/§10).
 *
 * Effektiv: Umsatzsteuer (aus den Rechnungen der Periode) minus fiktive
 * Vorsteuer (aus den in der Periode verkauften Fahrzeugen mit
 * vat_scheme='notional_input_tax'). Deckt bewusst nur ab, was das Schema
 * modelliert — echte Vorsteuer aus Wareneinkäufen/Dienstleistungen ausserhalb
 * des Fahrzeughandels (z.B. Miete, Material) ist hier nicht erfasst.
 *
 * Saldosteuersatz: der von der ESTV zugeteilte Branchen-Pauschalsatz auf dem
 * gesamten fakturierten Umsatz (inkl. MWST) — kein Vorsteuerabzug, das ist
 * der ganze Sinn der Methode.
 */
import { withTenant } from '@tiff/core-db'

export async function computeVatReport(tenantId, { from, to }) {
  if (!from || !to) throw new Error('computeVatReport() braucht from und to (ISO-Datum).')

  return withTenant(tenantId, async (client) => {
    const tenantResult = await client.query('SELECT vat_method, net_tax_rate_percent FROM tenants WHERE id = $1', [
      tenantId,
    ])
    const tenant = tenantResult.rows[0]
    if (!tenant?.vat_method) {
      throw new Error(
        'Für diesen Mandanten ist keine Abrechnungsart hinterlegt (vat_method). ' +
          'Muss zuerst mit einem Treuhänder festgelegt werden — ANFORDERUNGEN.md §10.',
      )
    }

    const invoiceTotalsResult = await client.query(
      `SELECT COALESCE(SUM(vat_rappen), 0) AS output_tax, COALESCE(SUM(total_rappen), 0) AS revenue
         FROM documents
        WHERE type = 'invoice' AND issue_date BETWEEN $1 AND $2`,
      [from, to],
    )
    const outputTaxRappen = Number(invoiceTotalsResult.rows[0].output_tax)
    const totalRevenueRappen = Number(invoiceTotalsResult.rows[0].revenue)

    const notionalInputTaxResult = await client.query(
      `SELECT COALESCE(SUM(notional_input_tax_rappen), 0) AS notional_input_tax
         FROM vehicles
        WHERE vat_scheme = 'notional_input_tax' AND sold_at BETWEEN $1 AND $2`,
      [from, to],
    )
    const notionalInputTaxRappen = Number(notionalInputTaxResult.rows[0].notional_input_tax)

    let payableRappen
    if (tenant.vat_method === 'net_tax_rate') {
      if (tenant.net_tax_rate_percent == null) {
        throw new Error(
          'Saldosteuersatz-Methode, aber kein Satz hinterlegt (tenants.net_tax_rate_percent) — ' +
            'den von der ESTV zugeteilten Branchensatz eintragen.',
        )
      }
      payableRappen = Math.round((totalRevenueRappen * Number(tenant.net_tax_rate_percent)) / 100)
    } else {
      payableRappen = outputTaxRappen - notionalInputTaxRappen
    }

    return {
      method: tenant.vat_method,
      from,
      to,
      outputTaxRappen,
      notionalInputTaxRappen,
      totalRevenueRappen,
      payableRappen,
    }
  })
}
