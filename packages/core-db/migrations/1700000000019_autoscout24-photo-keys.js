/**
 * Fotos an AutoScout24: welcher Bildschlüssel dort zu welchem unserer Fotos gehört.
 *
 * AutoScout24 nimmt Fotos in zwei Schritten (OpenAPI-Spezifikation, `UploadSellerListingImage` und
 * `SetSellerListingImages`): erst jede Datei einzeln hochladen (liefert einen `key`), dann einmal die
 * geordnete Liste aller Keys setzen. Ohne diese Spalte müsste jeder Push alle Fotos erneut hochladen —
 * bis zu 40 Dateien à 10 MB für eine Preisänderung. Mit ihr geht nur hinauf, was dort noch fehlt;
 * die Reihenfolge (Titelbild zuerst) wird trotzdem bei jedem Push neu gesetzt.
 *
 * NULL = noch nicht bei AutoScout24. Wird geleert, wenn das Inserat entfernt wird (die Keys gehören zum
 * Inserat, nicht zum Fahrzeug).
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumns('vehicle_photos', {
    autoscout24_image_key: { type: 'text' },
  })
}

export async function down(pgm) {
  pgm.dropColumns('vehicle_photos', ['autoscout24_image_key'])
}
