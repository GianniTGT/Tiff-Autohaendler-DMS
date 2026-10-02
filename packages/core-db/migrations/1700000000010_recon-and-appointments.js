/**
 * Werkstatt-Aufträge und Termine.
 *
 * `recon_jobs`: was an einem Fahrzeug noch zu tun ist (Manager: lib/recon.js).
 * `vehicle_costs` ist, was schon ausgegeben wurde; ein Auftrag ist, was noch
 * offen ist. Wird er erledigt und ein Betrag genannt, entsteht daraus eine
 * Kostenzeile (`cost_id`) — beide Listen verwenden dieselben Arten.
 * `estimate_rappen` NULL heisst "noch nicht geschätzt", nicht 0.
 *
 * `appointments`: manuell erfasste Termine (Besichtigung, Probefahrt,
 * Übergabe …). Fristen aus Fahrzeugen, Rechnungen und Aufträgen kommen nicht
 * hierher, sondern werden im Kalender aus den Quelldaten abgeleitet — sonst
 * stünde dasselbe Datum an zwei Stellen und liefe auseinander.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('recon_jobs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    vehicle_id: { type: 'uuid', notNull: true, references: 'vehicles', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: "kind IN ('part', 'labor', 'transport', 'fee', 'detail')" },
    description: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'open', check: "status IN ('open', 'doing', 'done', 'dropped')" },
    estimate_rappen: { type: 'bigint', check: 'estimate_rappen >= 0' },
    actual_rappen: { type: 'bigint', check: 'actual_rappen >= 0' },
    due_date: { type: 'date' },
    done_at: { type: 'date' },
    cost_id: { type: 'uuid', references: 'vehicle_costs', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('recon_jobs', 'vehicle_id')
  pgm.createIndex('recon_jobs', 'tenant_id')

  pgm.createTable('appointments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    kind: {
      type: 'text',
      notNull: true,
      default: 'appointment',
      check: "kind IN ('appointment', 'viewing', 'test_drive', 'delivery', 'other')",
    },
    on_date: { type: 'date', notNull: true },
    at_time: { type: 'text', check: "at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'" },
    vehicle_id: { type: 'uuid', references: 'vehicles', onDelete: 'SET NULL' },
    party_id: { type: 'uuid', references: 'parties', onDelete: 'SET NULL' },
    note: { type: 'text' },
    done: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('appointments', 'tenant_id')
  pgm.createIndex('appointments', 'on_date')

  for (const table of ['recon_jobs', 'appointments']) {
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
  pgm.dropTable('appointments')
  pgm.dropTable('recon_jobs')
}
