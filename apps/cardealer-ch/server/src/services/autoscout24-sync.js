/**
 * AutoScout24-Anbindung — Push-Richtung, wie AUTOSCOUT24-API.md §1 begründet
 * (DMS ist die Quelle, AutoScout24 der Empfänger, nicht umgekehrt). Ein
 * Fahrzeug einmal erfassen, hier gezielt an AutoScout24 schicken.
 */
import { withTenant } from '@tiff/core-db'
import { createAutoScout24Client } from '../integrations/autoscout24/client.js'
import { resolveMakeAndModelKeys } from '../integrations/autoscout24/lookup.js'
import { mapVehicleToAutoScout24Listing } from '../integrations/autoscout24/mapping.js'
import { getVehicle, updateVehicle } from './vehicles.js'

const defaultClient = createAutoScout24Client()

async function getCredentials(tenantId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      'SELECT autoscout24_client_id, autoscout24_client_secret, autoscout24_seller_id FROM tenants WHERE id = $1',
      [tenantId],
    )
    const row = result.rows[0]
    if (!row?.autoscout24_client_id || !row?.autoscout24_client_secret || !row?.autoscout24_seller_id) {
      throw new Error(
        'Für diesen Mandanten sind keine AutoScout24-Zugangsdaten hinterlegt (tenants.autoscout24_*).',
      )
    }
    return {
      credentials: { clientId: row.autoscout24_client_id, clientSecret: row.autoscout24_client_secret },
      sellerId: row.autoscout24_seller_id,
    }
  })
}

/**
 * Erfasst oder aktualisiert das Inserat für ein Fahrzeug. Findet ein
 * bestehendes Inserat über `externalId` (die eigene Fahrzeug-ID) wieder,
 * statt bei jedem Aufruf ein neues zu erzeugen — genau das Muster, das
 * AUTOSCOUT24-API.md §2 dafür vorsieht.
 *
 * @param {object} [options] { client: für Tests injizierbar, makeKey/modelKey: überschreiben die automatische Auflösung }
 */
export async function pushVehicleToAutoScout24(tenantId, vehicleId, { client = defaultClient, makeKey, modelKey } = {}) {
  const vehicle = await getVehicle(tenantId, vehicleId)
  if (!vehicle) throw new Error('Fahrzeug nicht gefunden.')

  const { credentials, sellerId } = await getCredentials(tenantId)

  const keys =
    makeKey && modelKey
      ? { makeKey, modelKey }
      : await resolveMakeAndModelKeys(client, credentials, { make: vehicle.make, model: vehicle.model })

  const payload = mapVehicleToAutoScout24Listing(vehicle, keys)

  let listingId = vehicle.autoscout24ListingId
  if (!listingId) {
    const existing = await client.findByExternalId(credentials, sellerId, vehicle.id)
    listingId = existing?.id ?? null
  }

  if (listingId) {
    await client.updateListing(credentials, sellerId, listingId, payload)
  } else {
    const created = await client.createListing(credentials, sellerId, payload)
    listingId = created.id
  }

  const updated = await updateVehicle(tenantId, vehicleId, {
    autoscout24ListingId: listingId,
    autoscout24SyncedAt: new Date().toISOString(),
  })

  return { listingId, payload, vehicle: updated }
}

async function requireListingId(tenantId, vehicleId) {
  const vehicle = await getVehicle(tenantId, vehicleId)
  if (!vehicle) throw new Error('Fahrzeug nicht gefunden.')
  if (!vehicle.autoscout24ListingId) {
    throw new Error('Dieses Fahrzeug hat noch kein AutoScout24-Inserat — zuerst pushVehicleToAutoScout24() aufrufen.')
  }
  return vehicle.autoscout24ListingId
}

export async function activateAutoScout24Listing(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  await client.activateListing(credentials, sellerId, listingId)
}

export async function deactivateAutoScout24Listing(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  await client.deactivateListing(credentials, sellerId, listingId)
}

export async function removeAutoScout24Listing(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  await client.removeListing(credentials, sellerId, listingId)
  await updateVehicle(tenantId, vehicleId, { autoscout24ListingId: null, autoscout24SyncedAt: null })
}
