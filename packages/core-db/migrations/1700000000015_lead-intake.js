/**
 * Anfragen von der Website des Betriebs entgegennehmen.
 *
 * Die Website kennt keine Sitzung, nur einen Schlüssel. Wie beim Login
 * (1700000000005) steht die Anfrage vor demselben Henne-Ei-Problem:
 * `tenants` ist RLS-geschützt, aber wessen Mandant der Schlüssel gehört, ist
 * ja gerade die Frage. Die Sicht `tenant_lead_intake` zeigt deshalb nur, was
 * zur Prüfung nötig ist — Slug, **Hash** des Schlüssels (nie der Schlüssel
 * selbst, der wird nur einmal beim Erzeugen angezeigt) und die erlaubte
 * Website-Adresse. Nichts anderes aus `tenants`.
 *
 * `lead_allowed_origin`: die Adresse der Website (z.B.
 * https://www.bit-automobile.ch), die per Browser-Formular posten darf (CORS).
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumns('tenants', {
    lead_key_hash: { type: 'text' },
    lead_allowed_origin: { type: 'text' },
  })
  pgm.sql(
    'CREATE VIEW tenant_lead_intake AS SELECT id, slug, lead_key_hash, lead_allowed_origin FROM tenants WHERE active AND lead_key_hash IS NOT NULL',
  )
  pgm.sql('GRANT SELECT ON tenant_lead_intake TO tiff_app')
}

export async function down(pgm) {
  pgm.sql('DROP VIEW IF EXISTS tenant_lead_intake')
  pgm.dropColumns('tenants', ['lead_key_hash', 'lead_allowed_origin'])
}
