/**
 * Anfragen (Leads) und Fahrzeugfotos.
 *
 * `leads`: Interessenten-Anfragen (Manager: FAZA2.md §2, lib/lead-fields.js).
 * Die US-Fassung hat eine Anzahlungs-Prüfung für die hauseigene Finanzierung
 * — die gibt es in der Schweiz nicht (Leasing/Finanzierung läuft über eine
 * Bank), deshalb ist `financing` hier nur eine Anfrageart, ohne Rechenregel.
 * `party_id` verknüpft die Anfrage mit einem Kunden, sobald daraus einer
 * gemacht wurde.
 *
 * `vehicle_photos`: die Bytes liegen im Objektspeicher (store.js), hier nur
 * der Schlüssel und die Reihenfolge. Höchstens ein Titelbild pro Fahrzeug
 * (partieller Unique-Index) — das erzwingt die Datenbank, nicht nur die UI.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('leads', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    type: {
      type: 'text',
      notNull: true,
      default: 'inquiry',
      check: "type IN ('inquiry', 'test_drive', 'trade_in', 'financing', 'other')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'new',
      check: "status IN ('new', 'contacted', 'test_drive', 'won', 'lost')",
    },
    name: { type: 'text', notNull: true },
    email: { type: 'text' },
    phone: { type: 'text' },
    message: { type: 'text' },
    vehicle_id: { type: 'uuid', references: 'vehicles', onDelete: 'SET NULL' },
    party_id: { type: 'uuid', references: 'parties', onDelete: 'SET NULL' },
    source: { type: 'text', notNull: true, default: 'manual', check: "source IN ('manual', 'website', 'autoscout24')" },
    notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('leads', 'tenant_id')
  pgm.createIndex('leads', 'status')

  pgm.createTable('vehicle_photos', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    vehicle_id: { type: 'uuid', notNull: true, references: 'vehicles', onDelete: 'CASCADE' },
    storage_key: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    position: { type: 'integer', notNull: true, default: 0 },
    is_cover: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('vehicle_photos', 'vehicle_id')
  pgm.createIndex('vehicle_photos', 'tenant_id')
  pgm.sql('CREATE UNIQUE INDEX vehicle_photos_one_cover ON vehicle_photos (vehicle_id) WHERE is_cover')

  for (const table of ['leads', 'vehicle_photos']) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `)
  }
}

export async function down(pgm) {
  pgm.dropTable('vehicle_photos')
  pgm.dropTable('leads')
}
