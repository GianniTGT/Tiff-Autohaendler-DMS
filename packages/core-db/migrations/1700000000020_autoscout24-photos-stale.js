/**
 * «Fotos seit dem letzten Abgleich verändert» am Fahrzeug.
 *
 * Die Zahl der hochgeladenen Fotos (autoscout24_image_key, Migration 19) sagt nur, was noch fehlt — nicht,
 * dass ein Foto gelöscht, umsortiert oder zum Titelbild gemacht wurde. Nach so einer Änderung zeigt das
 * Inserat bei AutoScout24 noch den alten Stand, und die Übersicht würde trotzdem «alles übertragen»
 * melden. Jede Foto-Änderung setzt das Kennzeichen, ein erfolgreicher Abgleich löscht es.
 *
 * Es unterscheidet auch «nie Fotos gehabt» (Bildliste bei AutoScout24 bleibt unangetastet) von «alle
 * gelöscht» (Bildliste wird geleert) — ohne das Kennzeichen sähen beide Fälle gleich aus.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumns('vehicles', {
    autoscout24_photos_stale: { type: 'boolean', notNull: true, default: false },
  })
}

export async function down(pgm) {
  pgm.dropColumns('vehicles', ['autoscout24_photos_stale'])
}
