/**
 * Mandantenfähigkeit: ein Schema, tenant_id überall, durchgesetzt von Postgres
 * (Row Level Security). Siehe business/SCHWEIZ-SAAS.md §3.
 *
 * Von Tag eins einbauen, auch bei einem einzigen Mandanten — tenant_id
 * nachträglich in bestehende Tabellen einzuziehen ist ein Umbau bei
 * laufendem Betrieb, keine Migration.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createExtension('pgcrypto', { ifNotExists: true })

  pgm.createTable('tenants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    // Rechtsträger, wie er auf Rechnung, Kaufvertrag und QR-Rechnung steht —
    // nie automatisch identisch mit der Marke/Website (siehe BETRIEB-UND-HOSTING.md §9.1).
    legal_name: { type: 'text', notNull: true },
    uid: { type: 'text' }, // Schweizer UID, Format CHE-123.456.789 MWST
    vat_liable: { type: 'boolean', notNull: true, default: false },
    vat_method: { type: 'text' }, // 'effective' | 'net_tax_rate' (Saldosteuersatz)
    address_street: { type: 'text' },
    address_zip: { type: 'text' },
    address_city: { type: 'text' },
    qr_iban: { type: 'text' }, // für die QR-Rechnung, IID 30000-31999
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    email: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    // scrypt, wie im Alaska-Produkt bewährt (SCHWEIZ-SAAS.md §2). Argon2id ist
    // ein späteres Upgrade, kein Startproblem.
    password_hash: { type: 'text', notNull: true },
    // Rollen sind pro Betrieb frei — nicht 1:1 aus TCM übernehmen, sondern beim
    // Piloten erfragen (SCHWEIZ-SAAS.md §1.4). Startbelegung: 'inhaber' | 'verkauf'
    // | 'werkstatt' | 'buchhaltung'.
    role: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('users', 'users_tenant_email_unique', {
    unique: ['tenant_id', 'email'],
  })

  pgm.createTable('sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    // Server-Session statt JWT: ein deaktivierter Benutzer muss sofort draussen
    // sein, die Rolle wird bei jedem Request aus der DB gelesen (SCHWEIZ-SAAS.md §2, §19).
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  })

  pgm.createTable('invitations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    email: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    token: { type: 'text', notNull: true, unique: true },
    accepted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  })

  pgm.createTable('audit_log', {
    id: { type: 'bigserial', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', references: 'users' },
    action: { type: 'text', notNull: true },
    entity: { type: 'text', notNull: true },
    entity_id: { type: 'text' },
    details: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })

  // RLS auf allen mandantengebundenen Tabellen. Die Anwendung verbindet sich
  // als Rolle ohne BYPASSRLS; withTenant() in core-db/src/index.js setzt
  // app.tenant_id für die Dauer der Transaktion.
  for (const table of ['users', 'sessions', 'invitations', 'audit_log']) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `)
  }
  // tenants selbst: ein Mandant sieht nur sich selbst.
  pgm.sql('ALTER TABLE tenants ENABLE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_self ON tenants
      USING (id = current_setting('app.tenant_id', true)::uuid)
  `)
}

export async function down(pgm) {
  pgm.dropTable('audit_log')
  pgm.dropTable('invitations')
  pgm.dropTable('sessions')
  pgm.dropTable('users')
  pgm.dropTable('tenants')
}
