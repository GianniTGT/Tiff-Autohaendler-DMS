/**
 * Betriebslogo und Verträge im Belegarchiv.
 *
 * `tenants.logo_*`: das Logo liegt im Objektspeicher (wie die Belege), hier
 * nur Schlüssel und Typ. Es erscheint im Briefkopf der PDFs
 * (packages/core-docs/src/layout.js, `letterhead`).
 *
 * `documents.type` kennt jetzt auch `sale_contract` (Kaufvertrag) und
 * `purchase_contract` (Ankaufsvertrag). Damit laufen Verträge durch dieselbe
 * Kette wie Rechnungen: Nummer aus `number_sequences`, SHA-256-Hash und
 * Bytes im Objektspeicher (archive.js), Audit-Eintrag. Der Ankaufsvertrag
 * ist der Beleg für den fiktiven Vorsteuerabzug und muss 10 Jahre
 * aufbewahrt werden (OR 958f, GeBüV; ANFORDERUNGEN.md §7).
 */
export const shorthands = undefined

const TYPES_BEFORE = ['offer', 'order', 'delivery_note', 'invoice', 'reminder', 'credit_note']
const TYPES_AFTER = [...TYPES_BEFORE, 'sale_contract', 'purchase_contract']
const list = (types) => types.map((t) => `'${t}'`).join(', ')

export async function up(pgm) {
  pgm.addColumns('tenants', {
    logo_storage_key: { type: 'text' },
    logo_content_type: { type: 'text' },
  })
  pgm.sql('ALTER TABLE documents DROP CONSTRAINT documents_type_check')
  pgm.sql(`ALTER TABLE documents ADD CONSTRAINT documents_type_check CHECK (type IN (${list(TYPES_AFTER)}))`)
}

export async function down(pgm) {
  pgm.sql("DELETE FROM documents WHERE type IN ('sale_contract', 'purchase_contract')")
  pgm.sql('ALTER TABLE documents DROP CONSTRAINT documents_type_check')
  pgm.sql(`ALTER TABLE documents ADD CONSTRAINT documents_type_check CHECK (type IN (${list(TYPES_BEFORE)}))`)
  pgm.dropColumns('tenants', ['logo_storage_key', 'logo_content_type'])
}
