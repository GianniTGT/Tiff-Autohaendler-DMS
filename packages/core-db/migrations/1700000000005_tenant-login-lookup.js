/**
 * Löst ein Henne-Ei-Problem, das beim Entwurf des Login-Ablaufs auffiel:
 * `tenants` ist RLS-geschützt nach `id = app.tenant_id` (Migration
 * 1700000000000) — aber beim Login kennt niemand den Mandanten schon, das
 * ist ja gerade die Frage. Jede Anfrage über `withTenant()` scheitert also
 * zwangsläufig, bevor der Mandant überhaupt feststeht.
 *
 * Lösung: ein eigener, öffentlich lesbarer `slug` (z.B. "bit-automobile"),
 * über den sich NUR die Mandanten-ID auflösen lässt — nie Adresse, UID,
 * QR-IBAN oder sonst etwas Schützenswertes. Die Sicht `tenant_login_lookup`
 * gehört `tiff_migrator` (BYPASSRLS) und liest deshalb ungefiltert; `tiff_app`
 * bekommt SELECT nur auf diese schmale Sicht, nicht auf `tenants` selbst
 * direkt für diesen Zweck. Dieselbe Technik wie `public_vehicle_listing` in
 * der vorigen Migration, nur umgekehrt eingesetzt: dort wollten wir RLS
 * *respektieren* (`security_invoker = true`), hier wollen wir es für genau
 * diese zwei Spalten bewusst *umgehen* — deshalb bleibt `security_invoker`
 * hier auf dem Default `false`.
 *
 * Der Rest des Logins (Passwort prüfen, Sitzung anlegen) läuft danach ganz
 * normal durch `withTenant(tenantId, ...)`, sobald die ID bekannt ist — siehe
 * apps/cardealer-ch/server/src/services/auth.js.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('tenants', {
    slug: { type: 'text' },
  })
  pgm.sql(`UPDATE tenants SET slug = id::text WHERE slug IS NULL`)
  pgm.alterColumn('tenants', 'slug', { notNull: true })
  pgm.addConstraint('tenants', 'tenants_slug_unique', { unique: 'slug' })

  pgm.sql('CREATE VIEW tenant_login_lookup AS SELECT id, slug FROM tenants WHERE active')
  pgm.sql('GRANT SELECT ON tenant_login_lookup TO tiff_app')
}

export async function down(pgm) {
  pgm.sql('DROP VIEW IF EXISTS tenant_login_lookup')
  pgm.dropConstraint('tenants', 'tenants_slug_unique')
  pgm.dropColumn('tenants', 'slug')
}
