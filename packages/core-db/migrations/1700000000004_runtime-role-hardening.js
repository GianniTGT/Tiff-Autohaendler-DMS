/**
 * Härtung der Mandantentrennung — behebt eine Lücke, die beim ersten
 * lokalen Testlauf gegen echtes PostgreSQL auffiel:
 *
 * **Ein Tabellenbesitzer ist von Row Level Security standardmässig befreit.**
 * Wenn dieselbe Rolle, mit der sich die Anwendung verbindet, auch die
 * Tabellen angelegt hat (z.B. weil `CREATE DATABASE ... OWNER tiff_app`
 * verwendet wurde), greifen die Policies aus den vorigen Migrationen
 * überhaupt nicht — unabhängig davon, ob `app.tenant_id` gesetzt ist.
 * `withTenant()` in packages/core-db/src/index.js sähe dann aus wie ein
 * Schutz, wäre aber keiner.
 *
 * Die Korrektur hat zwei Teile, die beide nötig sind:
 *
 * 1. **Betrieblich** (nicht Teil dieser Migration, siehe README.md
 *    "Datenbank-Rollen"): Migrationen laufen als eine Besitzer-Rolle
 *    (`tiff_migrator`), die Anwendung verbindet sich als eine ANDERE, nicht
 *    besitzende Rolle (`tiff_app`) ohne BYPASSRLS. Weil unten jede
 *    Mandanten-Tabelle FORCE ROW LEVEL SECURITY bekommt, gilt das auch für
 *    den Besitzer — `tiff_migrator` braucht darum selbst BYPASSRLS, um
 *    administrativ arbeiten zu können (z.B. den ersten Mandanten anlegen).
 *    Das kann nur ein Postgres-Superuser setzen (`ALTER ROLE tiff_migrator
 *    BYPASSRLS`), keine Migration — siehe README.md.
 * 2. **Hier**: `tiff_app` bekommt nur die Rechte, die sie für ihre Arbeit
 *    braucht (kein DDL, kein Eigentum), und jede Mandanten-Tabelle bekommt
 *    zusätzlich `FORCE ROW LEVEL SECURITY` — das schliesst dieselbe Lücke
 *    ein zweites Mal, falls doch einmal als Besitzer verbunden wird (z.B.
 *    aus Versehen in einer Wartungs-Session). Verteidigung in der Tiefe,
 *    genau wie `withTenant()` selbst schon zweifach vorging (SCHWEIZ-SAAS.md §3).
 *
 * `ALTER DEFAULT PRIVILEGES` sorgt dafür, dass jede SPÄTERE Migration, die
 * eine neue Tabelle als `tiff_migrator` anlegt, automatisch dieselben
 * Rechte für `tiff_app` mitbekommt — eine vergessene Grant-Zeile in einer
 * künftigen Migration ist sonst dieselbe Art Lücke, nur eine Version später.
 */
export const shorthands = undefined

const TENANT_TABLES = [
  'tenants',
  'users',
  'sessions',
  'invitations',
  'audit_log',
  'parties',
  'documents',
  'document_lines',
  'payments',
  'vehicles',
]

export async function up(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiff_app') THEN
        CREATE ROLE tiff_app LOGIN;
      END IF;
    END
    $$;
  `)

  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)
  }

  pgm.sql('GRANT USAGE ON SCHEMA public TO tiff_app')
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tiff_app')
  pgm.sql('GRANT SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO tiff_app')
  pgm.sql(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tiff_app',
  )
  pgm.sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, UPDATE ON SEQUENCES TO tiff_app')

  // Absichtlich KEIN "ALTER ROLE tiff_app NOBYPASSRLS NOSUPERUSER" hier: das
  // Ändern des SUPERUSER-Attributs verlangt selbst SUPERUSER-Rechte, die
  // tiff_migrator bewusst nicht hat (§ oben — die Migrations-Rolle soll kein
  // Superuser sein müssen). Beides ist ohnehin der Standard für eine frisch
  // mit `CREATE ROLE tiff_app LOGIN` angelegte Rolle; wer BYPASSRLS prüfen
  // will, tut das mit `SELECT rolbypassrls FROM pg_roles WHERE rolname =
  // 'tiff_app'` bei der Einrichtung, nicht hier.
}

export async function down(pgm) {
  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`)
  }
  pgm.sql('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tiff_app')
  pgm.sql('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM tiff_app')
}
