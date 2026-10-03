/** Der heute gültige Normalsatz (tax_rates), z. B. 8.1 — für die Umrechnung Angebotspreis (brutto) → Rechnungsposition (netto). */
import { withTenant } from '@tiff/core-db'
import { findTaxRate } from '@tiff/core-billing'

export async function currentStandardVatPercent(tenantId) {
  return withTenant(tenantId, async (client) => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const rate = findTaxRate((await client.query('SELECT * FROM tax_rates')).rows, 'standard', today)
    return rate ? Number(rate.rate_percent) : null
  })
}
