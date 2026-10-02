/**
 * Löschschutz für archivierte Belege — auf Datenbankebene, nicht nur im
 * Anwendungscode.
 *
 * Ein Beleg mit `pdf_hash` ist archiviert (OR 958f, GeBüV: unveränderbar,
 * 10 Jahre). Die Anwendungsrolle `tiff_app` darf ihn weder löschen noch Hash
 * oder Speicherschlüssel ändern: ein Fehler im Anwendungscode soll nie einen
 * Beleg vernichten können, den das Gesetz aufzubewahren verlangt.
 *
 * Die Prüfung gilt für `current_user = 'tiff_app'` (die Laufzeitrolle, siehe
 * README "Datenbank-Rollen"). Die Besitzer-Rolle `tiff_migrator` ist
 * ausgenommen — Wartung (z.B. Mandant nach Vertragsende und abgelaufener
 * Aufbewahrungsfrist entfernen) ist eine bewusste administrative Handlung,
 * kein Anwendungsfall. Heisst die Laufzeitrolle im Betrieb anders, muss diese
 * Bedingung mitgezogen werden.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.sql(`
    CREATE FUNCTION documents_protect_archived() RETURNS trigger AS $$
    BEGIN
      IF current_user <> 'tiff_app' OR OLD.pdf_hash IS NULL THEN
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
  pgm.sql(`
    CREATE TRIGGER documents_protect_archived
      BEFORE UPDATE OR DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION documents_protect_archived()
  `)
}

export async function down(pgm) {
  pgm.sql('DROP TRIGGER IF EXISTS documents_protect_archived ON documents')
  pgm.sql('DROP FUNCTION IF EXISTS documents_protect_archived()')
}
