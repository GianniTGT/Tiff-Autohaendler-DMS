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
import {
  listPhotosForAutoScout24,
  getPhotoBytesByStorageKey,
  setAutoScout24ImageKey,
  clearAutoScout24ImageKeys,
} from './photos.js'

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

/** Nur den Fehlertext setzen oder löschen, ohne den Aktiv-Zustand anzufassen. */
async function setListingError(tenantId, vehicleId, error) {
  await withTenant(tenantId, (client) =>
    client.query('UPDATE vehicles SET autoscout24_last_error = $1 WHERE id = $2', [error ?? null, vehicleId]),
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
    // Ein neues Inserat kennt keine unserer Bildschlüssel — die gehörten (falls vorhanden) zu einem
    // früheren, inzwischen entfernten Inserat. Also alle Fotos frisch hochladen.
    await clearAutoScout24ImageKeys(tenantId, vehicleId)
  }

  const updated = await updateVehicle(tenantId, vehicleId, {
    autoscout24ListingId: listingId,
    autoscout24SyncedAt: new Date().toISOString(),
  })

  // Fotos erst nach dem Inserat, und ein Fehler dabei wirft nicht: die Fahrzeugdaten sind oben, die
  // Inserat-ID ist gespeichert — das soll nicht als «Push gescheitert» erscheinen. Der Fehler steht am
  // Fahrzeug (Übersicht, Inserate) und «Fotos übertragen» versucht es gezielt noch einmal.
  let photos
  try {
    photos = await syncPhotos(client, credentials, sellerId, tenantId, vehicleId, listingId)
    await setListingError(tenantId, vehicleId, null)
  } catch (err) {
    photos = { status: 'failed', reason: err.message }
    await setListingError(tenantId, vehicleId, `Fotos: ${err.message}`)
  }

  return { listingId, payload, vehicle: updated, photos }
}

const EXTENSION_BY_TYPE = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })

/**
 * Fotos des Fahrzeugs zum Inserat bringen — zwei Schritte wie in client.js beschrieben.
 *
 * Hochgeladen wird nur, was bei AutoScout24 noch fehlt (kein `autoscout24_image_key`, Migration 19);
 * der Key wird sofort nach jedem einzelnen Upload gespeichert, damit ein Abbruch bei Foto 7 die
 * ersten sechs nicht noch einmal kostet. Die geordnete Liste (Titelbild zuerst) wird dagegen bei
 * jedem Aufruf neu gesetzt — so kommen auch Umsortieren und Löschen an, ohne dass ein Byte hinaufgeht.
 *
 * Ohne eigene Fotos wird die Bildliste bei AutoScout24 NICHT angerührt: ein Händler, der dort von Hand
 * Bilder eingestellt hat, soll sie durch eine Preisänderung hier nicht verlieren.
 *
 * @returns {Promise<{status: 'synced'|'none', total: number, uploaded: number, reused: number}>}
 */
async function syncPhotos(client, credentials, sellerId, tenantId, vehicleId, listingId) {
  const photos = await listPhotosForAutoScout24(tenantId, vehicleId)
  if (photos.length === 0) return { status: 'none', total: 0, uploaded: 0, reused: 0 }

  const keys = []
  let uploaded = 0
  for (const photo of photos) {
    if (photo.autoscout24ImageKey) {
      keys.push(photo.autoscout24ImageKey)
      continue
    }
    const buffer = await getPhotoBytesByStorageKey(photo.storageKey)
    if (!buffer) throw new Error('Ein Foto fehlt im Objektspeicher — bitte löschen und neu hochladen.')
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: photo.contentType }), `${photo.id}.${EXTENSION_BY_TYPE[photo.contentType] ?? 'bin'}`)
    const result = await client.uploadImage(credentials, sellerId, listingId, form)
    if (!result?.key) throw new Error('AutoScout24 hat für ein Foto keinen Bildschlüssel zurückgegeben.')
    await setAutoScout24ImageKey(tenantId, vehicleId, photo.id, result.key)
    keys.push(result.key)
    uploaded += 1
  }

  await client.setImages(credentials, sellerId, listingId, keys)
  return { status: 'synced', total: photos.length, uploaded, reused: photos.length - uploaded }
}

/**
 * Nur die Fotos abgleichen (Knopf «Fotos übertragen»), z. B. nachdem der Push die Fahrzeugdaten
 * übertragen hat, die Fotos aber scheiterten, oder nach Umsortieren. Wirft bei Fehlern — und hält
 * sie am Fahrzeug fest; bei Erfolg wird ein früherer Fehler gelöscht.
 */
export async function syncPhotosToAutoScout24(tenantId, vehicleId, { client = defaultClient } = {}) {
  const listingId = await requireListingId(tenantId, vehicleId)
  const { credentials, sellerId } = await getCredentials(tenantId)
  try {
    const result = await syncPhotos(client, credentials, sellerId, tenantId, vehicleId, listingId)
    await setListingError(tenantId, vehicleId, null)
    return result
  } catch (err) {
    await setListingError(tenantId, vehicleId, `Fotos: ${err.message}`)
    throw err
  }
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
  // Die Bildschlüssel gehörten zu diesem Inserat; ein nächstes bekommt die Fotos neu.
  await clearAutoScout24ImageKeys(tenantId, vehicleId)
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
