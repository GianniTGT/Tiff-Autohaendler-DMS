/**
 * AutoScout24-Zugangsdaten pro Mandant (Phase 3, ANFORDERUNGEN.md §9/§5).
 * `vehicles.autoscout24_listing_id`/`autoscout24_synced_at` gibt es schon
 * seit der Fahrzeug-Migration in Phase 0 — hier kommt nur hinzu, WOMIT sich
 * ein Mandant bei AutoScout24 ausweist.
 *
 * OFFEN UND UNGEKLÄRT, wie AUTOSCOUT24-API.md §5 selbst festhält: ob
 * `client_id`/`client_secret` pro Händler oder im Auftrag von TIFF Software
 * Solutions vergeben werden, ist eine kaufmännische Frage, keine technische
 * — diese Spalten gehen von "pro Mandant" aus, weil das der Normalfall bei
 * einer DMS-Partner-API ist, aber das muss mit AutoScout24 geklärt werden,
 * bevor der erste echte Händler das ausfüllt.
 *
 * `autoscout24_client_secret` liegt hier als Klartext — **das ist eine
 * bekannte Lücke, kein Versehen.** Es gibt in diesem Projekt noch keine
 * Secrets-Verwaltung (siehe SCHWEIZ-SAAS.md §2, "Secrets im Hoster-Tresor"
 * ist für die Produktionsumgebung vorgesehen, aber nicht gebaut). Vor dem
 * ersten produktiven Mandanten mit echten Zugangsdaten muss das verschlüsselt
 * oder in einen Secret-Store ausgelagert werden — nicht stillschweigend
 * ignorieren, siehe README.md.
 */
export const shorthands = undefined

export async function up(pgm) {
  pgm.addColumn('tenants', {
    autoscout24_client_id: { type: 'text' },
    autoscout24_client_secret: { type: 'text' },
    autoscout24_seller_id: { type: 'text' },
  })
}

export async function down(pgm) {
  pgm.dropColumn('tenants', ['autoscout24_client_id', 'autoscout24_client_secret', 'autoscout24_seller_id'])
}
