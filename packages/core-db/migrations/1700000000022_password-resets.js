/**
 * Passwort per E-Mail neu setzen.
 *
 * «Passwort vergessen?» legt hier einen Eintrag mit dem SHA-256 eines zufälligen Tokens ab; der Token
 * selbst steht nur im Link der E-Mail. Eine Stunde gültig, einmal verwendbar (`used_at`). Pro Person
 * nur der jüngste Antrag — ein neuer Antrag löscht die alten. Mandantengetrennt wie alles andere.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.createTable('password_resets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('password_resets', 'user_id')
  pgm.sql('ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY')
  pgm.sql('ALTER TABLE password_resets FORCE ROW LEVEL SECURITY')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON password_resets
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `)
}

export async function down(pgm) {
  pgm.dropTable('password_resets')
}
