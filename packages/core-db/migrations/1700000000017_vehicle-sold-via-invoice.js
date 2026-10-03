/**
 * Verkaufsabschluss an der Rechnung.
 *
 * Wird eine Rechnung mit Fahrzeug ausgestellt, gilt das Fahrzeug als
 * verkauft. `sold_via_document_id` hält fest, WELCHE Rechnung den Verkauf
 * ausgelöst hat — nur dann darf eine Gutschrift ihn wieder aufheben oder den
 * Preis mindern. Ein von Hand abgeschlossener Verkauf (ohne diese Verknüpfung)
 * bleibt von Gutschriften unberührt.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('vehicles', { sold_via_document_id: { type: 'uuid', references: 'documents', onDelete: 'SET NULL' } })
  pgm.createIndex('vehicles', 'sold_via_document_id')
}

export async function down(pgm) {
  pgm.dropIndex('vehicles', 'sold_via_document_id')
  pgm.dropColumn('vehicles', 'sold_via_document_id')
}
