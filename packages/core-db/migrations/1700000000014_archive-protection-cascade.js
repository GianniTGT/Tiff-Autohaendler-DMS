/**
 * Schliesst eine Lücke in 1700000000013 (Löschschutz archivierter Belege),
 * die der erste Test sofort fand: ein `DELETE FROM tenants` der Anwendungsrolle
 * löst über ON DELETE CASCADE das Löschen der Belege aus — und diese
 * Kaskade läuft intern unter dem Tabellenbesitzer, `current_user` ist dort
 * nicht mehr `tiff_app`. Der Trigger sah einen "Administrator" und liess es zu.
 *
 * Zwei Korrekturen, beide nötig:
 *  1. Der Trigger prüft `session_user` (wer wirklich verbunden ist), das
 *     sich durch die interne Rechteumstellung der Kaskade nicht ändert.
 *  2. Die Anwendungsrolle verliert das Recht, Mandanten zu löschen — die
 *     Anwendung löscht nie einen Mandanten (das ist Wartung durch
 *     `tiff_migrator`, nach Vertragsende und abgelaufener Aufbewahrung).
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION documents_protect_archived() RETURNS trigger AS $$
    BEGIN
      IF session_user <> 'tiff_app' OR OLD.pdf_hash IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Archivierte Belege dürfen nicht gelöscht werden (OR 958f, GeBüV).'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;

      IF NEW.pdf_hash IS DISTINCT FROM OLD.pdf_hash OR NEW.pdf_storage_key IS DISTINCT FROM OLD.pdf_storage_key THEN
        RAISE EXCEPTION 'Hash und Speicherort eines archivierten Belegs dürfen nicht geändert werden (OR 958f, GeBüV).'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `)
  pgm.sql('REVOKE DELETE ON tenants FROM tiff_app')
}

export async function down(pgm) {
  pgm.sql('GRANT DELETE ON tenants TO tiff_app')
}
