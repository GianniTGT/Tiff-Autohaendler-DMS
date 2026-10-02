/**
 * Kosten pro Fahrzeug (Teile, Arbeit, Transport, Gebühren, Aufbereitung).
 *
 * Im US-Repo hängen die Kosten an den Werkstattaufträgen (lib/recon.js,
 * `JOB_KINDS`). Die Schweizer Fassung führt zuerst nur die Kosten — die
 * Aufträge/das Werkstatt-Board folgen später und werden dann auf diese
 * Tabelle verweisen, nicht sie ersetzen. Geld in Rappen (bigint), nie REAL.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('vehicle_costs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    vehicle_id: { type: 'uuid', notNull: true, references: 'vehicles', onDelete: 'CASCADE' },
    kind: {
      type: 'text',
      notNull: true,
      check: "kind IN ('part', 'labor', 'transport', 'fee', 'detail')",
    },
    description: { type: 'text', notNull: true },
    amount_rappen: { type: 'bigint', notNull: true, check: 'amount_rappen >= 0' },
    incurred_at: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('vehicle_costs', 'vehicle_id')
  pgm.createIndex('vehicle_costs', 'tenant_id')

  pgm.sql('ALTER TABLE vehicle_costs ENABLE ROW LEVEL SECURITY')
  pgm.sql('ALTER TABLE vehicle_costs FORCE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON vehicle_costs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `)
}

export async function down(pgm) {
  pgm.dropTable('vehicle_costs')
}
