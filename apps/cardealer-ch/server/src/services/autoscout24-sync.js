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
import { decryptSecret } from './secrets.js'

// Austauschbar, damit Tests ohne Netzwerk und ohne echte Zugangsdaten laufen (configureAutoScout24Client).
let defaultClient = createAutoScout24Client()

export function configureAutoScout24Client(client) {
  defaultClient = client ?? createAutoScout24Client()
}

/** Zustand des Inserats am Fahrzeug festhalten (siehe Migration 18). `error: null` löscht einen früheren Fehler. */
async function setListingState(tenantId, vehicleId, { active, error }) {
  await withTenant(tenantId, (client) =>
    client.query('UPDATE vehicles SET autoscout24_active = $1, autoscout24_last_error = $2 WHERE id = $3', [active, error ?? null, vehicleId]),
  )
}

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
      credentials: { clientId: row.autoscout24_client_id, clientSecret: decryptSecret(row.autoscout24_client_secret) },
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
  await setListingState(tenantId, vehicleId, { active: true, error: null })
}

export async function deactivateAutoScout24Listing(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  await client.deactivateListing(credentials, sellerId, listingId)
  await setListingState(tenantId, vehicleId, { active: false, error: null })
}

export async function removeAutoScout24Listing(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  await client.removeListing(credentials, sellerId, listingId)
  await updateVehicle(tenantId, vehicleId, { autoscout24ListingId: null, autoscout24SyncedAt: null })
  await setListingState(tenantId, vehicleId, { active: null, error: null })
}

/**
 * Nach einem Verkauf das Inserat abschalten — damit niemand ein Auto anfragt, das nicht mehr da ist.
 *
 * Läuft NACH dem Verkauf und ausserhalb jeder Datenbank-Transaktion (ein Aufruf ins Netz gehört nicht
 * hinein), und wirft nie: scheitert AutoScout24 oder fehlen Zugangsdaten, bleibt der Verkauf bestehen. Der
 * Fehler wird am Fahrzeug festgehalten und erscheint in der Übersicht und unter Inserate, mit Möglichkeit,
 * es erneut zu versuchen.
 *
 * Deaktiviert, nicht gelöscht: bei einer Gutschrift (Verkauf aufgehoben) lässt sich das Inserat wieder aktivieren.
 *
 * @returns {Promise<{status: 'none'|'already'|'deactivated'|'failed', reason?: string}>}
 */
export async function deactivateListingAfterSale(tenantId, vehicleId, { client = defaultClient } = {}) {
  try {
    const vehicle = await getVehicle(tenantId, vehicleId)
    if (!vehicle?.autoscout24ListingId) return { status: 'none' }
    if (vehicle.autoscout24Active === false) return { status: 'already' }
    await deactivateAutoScout24Listing(tenantId, vehicleId, { client })
    return { status: 'deactivated' }
  } catch (err) {
    const reason = err.message
    try {
      await withTenant(tenantId, (client2) => client2.query('UPDATE vehicles SET autoscout24_last_error = $1 WHERE id = $2', [reason, vehicleId]))
    } catch {
      // der Fehler selbst lässt sich nicht festhalten — der Rückgabewert meldet ihn trotzdem
    }
    return { status: 'failed', reason }
  }
}
