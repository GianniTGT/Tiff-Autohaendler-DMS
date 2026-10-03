/**
 * Geschäftsjahr-Ende am Betrieb — für die Aufbewahrungsfrist.
 *
 * OR 958f zählt die zehn Jahre ab Ende des Geschäftsjahres, in dem der Beleg entstand. Bisher rechnete
 * das Archiv mit dem Kalenderjahr (31.12.). Ein Betrieb mit abweichendem Geschäftsjahr (z. B. Ende Juni)
 * bekommt mit dieser Spalte die richtige Frist; der Standard 12 (Dezember) ändert für alle anderen nichts.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumns('tenants', {
    fiscal_year_end_month: { type: 'smallint', notNull: true, default: 12, check: 'fiscal_year_end_month BETWEEN 1 AND 12' },
  })
}

export async function down(pgm) {
  pgm.dropColumns('tenants', ['fiscal_year_end_month'])
}
