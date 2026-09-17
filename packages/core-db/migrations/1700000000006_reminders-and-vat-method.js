/**
 * Phase 2 (ANFORDERUNGEN.md §9): Mahnwesen und MWST-Auswertung effektiv/Saldo.
 *
 * `documents.reminder_level`: 1./2./3. Mahnung — nur bei type='reminder'
 * gesetzt, sonst NULL. Kein eigener Verzugszins-Satz pro Mandant: OR 104
 * setzt 5% als gesetzlichen Verzugszins, das ist kein Wert, den ein Mandant
 * frei wählt (anders als der MWST-Satz, der aus tax_rates kommt).
 *
 * `tenants.net_tax_rate_percent`: der von der ESTV zugewiesene
 * Branchen-Pauschalsatz für die Saldosteuersatz-Methode (SCHWEIZ-SAAS.md
 * §4.2) — anders als die MWST-Sätze in tax_rates kein Wert, der sich mit der
 * Gesetzgebung ändert, sondern eine mandantenspezifische Zuteilung durch die
 * ESTV. Nur relevant, wenn tenants.vat_method = 'net_tax_rate'.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('documents', {
    reminder_level: { type: 'smallint', check: 'reminder_level BETWEEN 1 AND 3' },
  })
  pgm.addColumn('tenants', {
    net_tax_rate_percent: { type: 'numeric(5,3)' },
  })
}

export async function down(pgm) {
  pgm.dropColumn('tenants', 'net_tax_rate_percent')
  pgm.dropColumn('documents', 'reminder_level')
}
