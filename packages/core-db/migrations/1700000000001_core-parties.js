/**
 * Parteien: Kunden und Lieferanten. Branchenneutral gehalten (Regel aus
 * SCHWEIZ-SAAS.md §3: "im Kern kommt kein Vokabular der Branche vor") — eine
 * Partei ist eine Firma oder eine Person, kein "Käufer" oder "Verkäufer".
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('parties', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: "kind IN ('person', 'company')" },
    // Firma: company_name gesetzt. Person: first_name/last_name gesetzt.
    company_name: { type: 'text' },
    first_name: { type: 'text' },
    last_name: { type: 'text' },
    uid: { type: 'text' }, // UID der Gegenpartei, falls Firma (CHE-...)
    email: { type: 'text' },
    phone: { type: 'text' },
    address_street: { type: 'text' },
    address_zip: { type: 'text' },
    address_city: { type: 'text' },
    // Schweizer Fahrausweis-/ID-Nummer, für den Ankaufsvertrag mit Privatpersonen
    // (ANFORDERUNGEN.md §7) — nicht mit US buyer-fields.js verwechseln, dort war
    // es eine US-Führerschein-Nummer mit anderem rechtlichem Zweck.
    id_document_type: { type: 'text' }, // 'passport' | 'id_card' | 'drivers_license'
    id_document_number: { type: 'text' },
    notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('parties', 'tenant_id')

  pgm.sql('ALTER TABLE parties ENABLE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON parties
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `)
}

export async function down(pgm) {
  pgm.dropTable('parties')
}
