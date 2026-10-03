/**
 * Fahrzeugfotos. Die Bytes liegen im Objektspeicher (integrations/object-
 * storage/store.js: lokal im Entwicklungsbetrieb, S3-kompatibel im Betrieb),
 * die Datenbank kennt nur Schlüssel, Reihenfolge und das Titelbild.
 *
 * Der Dateityp wird an den ersten Bytes erkannt, nicht dem Header des
 * Clients geglaubt: `Content-Type: image/jpeg` zu behaupten kostet nichts,
 * und was hier abgelegt wird, wird später an Browser ausgeliefert.
 */
import { randomUUID } from 'node:crypto'
import { withTenant } from '@tiff/core-db'
import { createObjectStore } from '../integrations/object-storage/store.js'

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_PHOTOS_PER_VEHICLE = 40

const store = createObjectStore()

/** @returns {{ type: string, ext: string }|null} */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' }
  }
  return null
}

/**
 * Jede Foto-Änderung merkt am Fahrzeug «Fotos seit dem letzten Abgleich verändert» (Migration 20) — die
 * Inserate-Übersicht zeigt das, und der Abgleich weiss, dass er die Bildliste neu setzen muss.
 */
function markPhotosChanged(client, vehicleId) {
  return client.query('UPDATE vehicles SET autoscout24_photos_stale = true WHERE id = $1', [vehicleId])
}

function toPhoto(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    position: row.position,
    isCover: row.is_cover,
    // Bildschlüssel bei AutoScout24 (Migration 19); null = dort noch nicht hochgeladen.
    autoscout24ImageKey: row.autoscout24_image_key ?? null,
  }
}

export async function listPhotos(tenantId, vehicleId) {
  return withTenant(tenantId, async (client) =>
    (await client.query('SELECT * FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY position, created_at', [vehicleId])).rows.map(toPhoto),
  )
}

/** @returns {Promise<object|null>} null, wenn das Fahrzeug nicht existiert */
export async function addPhoto(tenantId, vehicleId, buffer) {
  const kind = detectImageType(buffer)
  if (!kind) throw new Error('Das ist kein Foto (erlaubt: JPEG, PNG, WebP).')
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error('Das Foto ist grösser als 10 MB.')

  const id = randomUUID()
  const key = `${tenantId}/vehicles/${vehicleId}/${id}.${kind.ext}`

  return withTenant(tenantId, async (client) => {
    const vehicle = await client.query('SELECT 1 FROM vehicles WHERE id = $1', [vehicleId])
    if (vehicle.rows.length === 0) return null
    const stats = (await client.query('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM vehicle_photos WHERE vehicle_id = $1', [vehicleId])).rows[0]
    if (Number(stats.n) >= MAX_PHOTOS_PER_VEHICLE) throw new Error(`Höchstens ${MAX_PHOTOS_PER_VEHICLE} Fotos pro Fahrzeug.`)

    await store.putObject(key, buffer, kind.type)
    try {
      const result = await client.query(
        `INSERT INTO vehicle_photos (id, tenant_id, vehicle_id, storage_key, content_type, size_bytes, position, is_cover)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, tenantId, vehicleId, key, kind.type, buffer.length, Number(stats.last) + 1, Number(stats.n) === 0],
      )
      await markPhotosChanged(client, vehicleId)
      return toPhoto(result.rows[0])
    } catch (err) {
      await store.deleteObject(key).catch(() => {}) // keine verwaiste Datei, wenn der Eintrag scheitert
      throw err
    }
  })
}

/** @returns {Promise<{buffer: Buffer, contentType: string}|null>} */
export async function getPhotoBytes(tenantId, vehicleId, photoId) {
  const row = await withTenant(tenantId, async (client) =>
    (await client.query('SELECT storage_key, content_type FROM vehicle_photos WHERE id = $1 AND vehicle_id = $2', [photoId, vehicleId])).rows[0],
  )
  if (!row) return null
  const buffer = await store.getObject(row.storage_key)
  return buffer ? { buffer, contentType: row.content_type } : null
}

export async function setCover(tenantId, vehicleId, photoId) {
  return withTenant(tenantId, async (client) => {
    const exists = await client.query('SELECT 1 FROM vehicle_photos WHERE id = $1 AND vehicle_id = $2', [photoId, vehicleId])
    if (exists.rows.length === 0) return false
    await client.query('UPDATE vehicle_photos SET is_cover = false WHERE vehicle_id = $1', [vehicleId])
    await client.query('UPDATE vehicle_photos SET is_cover = true WHERE id = $1', [photoId])
    await markPhotosChanged(client, vehicleId)
    return true
  })
}

/** Ein Foto um eine Stelle nach vorne (-1) oder hinten (+1) verschieben; Positionen werden dabei neu durchnummeriert. */
export async function movePhoto(tenantId, vehicleId, photoId, direction) {
  if (direction !== -1 && direction !== 1) throw new Error('direction muss -1 oder 1 sein.')
  return withTenant(tenantId, async (client) => {
    const rows = (await client.query('SELECT id FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY position, created_at', [vehicleId])).rows
    const index = rows.findIndex((r) => r.id === photoId)
    if (index < 0) return false
    const target = index + direction
    if (target >= 0 && target < rows.length) {
      ;[rows[index], rows[target]] = [rows[target], rows[index]]
    }
    for (const [position, row] of rows.entries()) {
      await client.query('UPDATE vehicle_photos SET position = $1 WHERE id = $2', [position, row.id])
    }
    await markPhotosChanged(client, vehicleId)
    return true
  })
}

export async function deletePhoto(tenantId, vehicleId, photoId) {
  const removed = await withTenant(tenantId, async (client) => {
    const row = (await client.query('DELETE FROM vehicle_photos WHERE id = $1 AND vehicle_id = $2 RETURNING storage_key, is_cover', [photoId, vehicleId])).rows[0]
    if (!row) return null
    // War es das Titelbild, rückt das erste verbliebene nach.
    if (row.is_cover) {
      await client.query(
        `UPDATE vehicle_photos SET is_cover = true
          WHERE id = (SELECT id FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY position, created_at LIMIT 1)`,
        [vehicleId],
      )
    }
    await markPhotosChanged(client, vehicleId)
    return row
  })
  if (!removed) return false
  await store.deleteObject(removed.storage_key).catch(() => {})
  return true
}

/**
 * Fotos in der Reihenfolge, in der sie bei AutoScout24 stehen sollen: Titelbild zuerst (dort ist das
 * erste Bild das Hauptbild), dann nach Position. Die Bytes holt der Abgleich über getPhotoBytes() —
 * mit Mandant und Fahrzeug, nie über einen rohen Speicherschlüssel.
 */
export async function listPhotosForAutoScout24(tenantId, vehicleId) {
  return withTenant(tenantId, async (client) =>
    (
      await client.query('SELECT * FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY is_cover DESC, position, created_at', [vehicleId])
    ).rows.map(toPhoto),
  )
}

/** Nach einem erfolgreichen Abgleich: die Fotos bei AutoScout24 entsprechen wieder dem Stand hier. */
export async function markPhotosSynced(tenantId, vehicleId) {
  await withTenant(tenantId, (client) =>
    client.query('UPDATE vehicles SET autoscout24_photos_stale = false WHERE id = $1', [vehicleId]),
  )
}

export async function setAutoScout24ImageKey(tenantId, vehicleId, photoId, imageKey) {
  await withTenant(tenantId, (client) =>
    client.query('UPDATE vehicle_photos SET autoscout24_image_key = $1 WHERE id = $2 AND vehicle_id = $3', [imageKey, photoId, vehicleId]),
  )
}

/** Alle Bildschlüssel eines Fahrzeugs vergessen — wenn das Inserat weg ist oder neu angelegt wurde, gelten sie nicht mehr. */
export async function clearAutoScout24ImageKeys(tenantId, vehicleId) {
  await withTenant(tenantId, (client) =>
    client.query('UPDATE vehicle_photos SET autoscout24_image_key = NULL WHERE vehicle_id = $1', [vehicleId]),
  )
}

/** Pro Fahrzeug: wie viele Fotos es gibt und wie viele davon bei AutoScout24 liegen — für die Inserate-Übersicht. */
export async function countPhotosByVehicle(tenantId) {
  return withTenant(tenantId, async (client) => {
    const rows = (
      await client.query(
        'SELECT vehicle_id, COUNT(*)::int AS total, COUNT(autoscout24_image_key)::int AS synced FROM vehicle_photos GROUP BY vehicle_id',
      )
    ).rows
    return new Map(rows.map((r) => [r.vehicle_id, { total: r.total, synced: r.synced }]))
  })
}
