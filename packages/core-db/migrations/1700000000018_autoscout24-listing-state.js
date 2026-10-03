/**
 * Zustand des AutoScout24-Inserats am Fahrzeug.
 *
 * Bisher kannte das System nur "hat ein Inserat" (`autoscout24_listing_id`),
 * nicht ob es aktiv ist. Mit der automatischen Deaktivierung beim Verkauf
 * braucht es das:
 *  - `autoscout24_active`: true (aktiviert), false (deaktiviert), NULL (unbekannt —
 *    nach dem Anlegen, bevor jemand aktiviert hat).
 *  - `autoscout24_last_error`: warum die letzte automatische Änderung scheiterte.
 *    Ein verkauftes Fahrzeug, dessen Inserat nicht abgeschaltet werden konnte, ist
 *    ein Problem, das man sehen muss — nicht eines, das im Protokoll verschwindet.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumns('vehicles', {
    autoscout24_active: { type: 'boolean' },
    autoscout24_last_error: { type: 'text' },
  })
}

export async function down(pgm) {
  pgm.dropColumns('vehicles', ['autoscout24_active', 'autoscout24_last_error'])
}
