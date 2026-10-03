/**
 * Gutschriften (Korrektur ausgestellter Rechnungen).
 *
 * Eine archivierte Rechnung ist unveränderlich (OR 958f, Migration 13/14) — ein
 * Fehler wird nicht überschrieben, sondern durch eine Gutschrift ausgeglichen.
 * Die Gutschrift ist ein eigenes Dokument (`documents.type = 'credit_note'`,
 * Nummer GS-JJJJ-NNNNN) mit positiven Beträgen und `predecessor_id` auf die
 * Rechnung.
 *
 * Verrechnet wird sie wie eine Zahlung: eine Zeile in `payments` mit
 * `source = 'credit_note'`. So bleibt jede Restbetrags-Berechnung
 * (Rechnungsliste, Mahnwesen, Kalender, Übersicht) richtig, ohne dass an
 * einem Dutzend Stellen ein zweiter Abzug nachgetragen werden muss.
 * `credit_note_id` hält fest, welche Gutschrift die Buchung ausgelöst hat.
 *
 * `documents.note`: Grund der Gutschrift (Pflichtangabe), steht auch im PDF.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('documents', { note: { type: 'text' } })
  pgm.addColumn('payments', { credit_note_id: { type: 'uuid', references: 'documents' } })
  pgm.createIndex('payments', 'credit_note_id')
  pgm.createIndex('documents', 'predecessor_id')
}

export async function down(pgm) {
  pgm.dropIndex('documents', 'predecessor_id')
  pgm.dropIndex('payments', 'credit_note_id')
  pgm.dropColumn('payments', 'credit_note_id')
  pgm.dropColumn('documents', 'note')
}
