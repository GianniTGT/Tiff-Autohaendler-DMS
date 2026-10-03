/**
 * Inserate: welche Fahrzeuge bei AutoScout24 stehen, welche bereit wären und
 * was zu einem Inserat noch fehlt. Das eigentliche Übertragen steht in
 * autoscout24-sync.js; hier nur die Übersicht davor.
 *
 * `missing` listet die Pflichtfelder des Mappings (mapping.js, REQUIRED) —
 * ausser `makeKey`/`modelKey`: die löst der Push selbst über
 * AutoScout24s Nachschlagewerke auf, die muss niemand von Hand eintippen.
 */
import { withTenant } from '@tiff/core-db'
import { listVehicles } from './vehicles.js'

/** Fahrzeugfeld -> was die Person im Formular sucht. */
export const LISTING_REQUIRED_FIELDS = Object.freeze([
  'make',
  'model',
  'vehicleCategory',
  'bodyColor',
  'bodyType',
  'conditionType',
  'firstRegistrationDate',
  'askingPriceRappen',
  'warrantyType',
])

export function missingListingFields(vehicle) {
  return LISTING_REQUIRED_FIELDS.filter((f) => vehicle[f] == null || vehicle[f] === '')
}

export async function hasAutoScout24Credentials(tenantId) {
  return withTenant(tenantId, async (client) => {
    const row = (await client.query('SELECT autoscout24_client_id, autoscout24_client_secret, autoscout24_seller_id FROM tenants WHERE id = $1', [tenantId])).rows[0]
    return Boolean(row?.autoscout24_client_id && row?.autoscout24_client_secret && row?.autoscout24_seller_id)
  })
}

/** Fahrzeuge im Bestand mit Inserate-Status. Kein Preis ausser dem Angebotspreis, den das Inserat ohnehin zeigt. */
export async function getListings(tenantId) {
  const [vehicles, configured] = await Promise.all([listVehicles(tenantId), hasAutoScout24Credentials(tenantId)])
  const rows = vehicles
    .filter((v) => v.status === 'in_stock' || v.status === 'reserved' || v.autoscout24ListingId)
    .map((v) => {
      const missing = missingListingFields(v)
      return {
        id: v.id,
        make: v.make,
        model: v.model,
        vin: v.vin,
        status: v.status,
        askingPriceRappen: v.askingPriceRappen,
        listingId: v.autoscout24ListingId ?? null,
        active: v.autoscout24Active ?? null,
        lastError: v.autoscout24LastError ?? null,
        // Verkauft, aber das Inserat ist nicht (nachweislich) abgeschaltet: das muss jemand sehen.
        soldStillListed: v.status === 'sold' && Boolean(v.autoscout24ListingId) && v.autoscout24Active !== false,
        syncedAt: v.autoscout24SyncedAt ?? null,
        missing,
        ready: missing.length === 0,
      }
    })
  return { configured, rows }
}
