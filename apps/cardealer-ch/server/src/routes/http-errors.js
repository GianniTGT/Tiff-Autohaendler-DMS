/**
 * Meldung für den Client. Eigene Fehlermeldungen (Prüfungen in den Services) gehen unverändert hinaus;
 * Datenbankfehler der Klassen 22/23 (ungültige UUID, Datum, Fremdschlüssel) nicht — deren Text nennt
 * Tabellen, Spalten und Eingabewerte.
 */
export function clientMessage(err) {
  return typeof err.code === 'string' && /^(22|23)/.test(err.code) ? 'Ungültige Eingabe.' : err.message
}
