/**
 * Betriebslogo. Nur PNG und JPEG: pdfkit bettet nur diese beiden ein, und ein
 * Logo, das auf dem Bildschirm erscheint, auf dem PDF aber fehlt, wäre
 * schlimmer als eine klare Ablehnung beim Hochladen. Der Typ wird an den
 * Bytes erkannt (photos.js), nicht dem Header geglaubt.
 */
import { withTenant } from '@tiff/core-db'
import { createObjectStore } from '../integrations/object-storage/store.js'
import { detectImageType } from './photos.js'

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
const store = createObjectStore()

export async function setLogo(tenantId, buffer) {
  const kind = detectImageType(buffer)
  if (!kind || kind.type === 'image/webp') throw new Error('Das Logo muss ein PNG oder JPEG sein.')
  if (buffer.length > MAX_LOGO_BYTES) throw new Error('Das Logo ist grösser als 2 MB.')

  const key = `${tenantId}/branding/logo.${kind.ext}`
  await store.putObject(key, buffer, kind.type)
  const previous = await withTenant(tenantId, async (client) => {
    const old = (await client.query('SELECT logo_storage_key FROM tenants WHERE id = $1', [tenantId])).rows[0]?.logo_storage_key
    await client.query('UPDATE tenants SET logo_storage_key = $1, logo_content_type = $2 WHERE id = $3', [key, kind.type, tenantId])
    return old
  })
  // PNG ersetzt JPEG (oder umgekehrt): die alte Datei hat einen anderen Schlüssel und wäre sonst verwaist.
  if (previous && previous !== key) await store.deleteObject(previous).catch(() => {})
  return { contentType: kind.type }
}

/** @returns {Promise<{buffer: Buffer, contentType: string}|null>} */
export async function getLogo(tenantId) {
  const row = await withTenant(tenantId, async (client) =>
    (await client.query('SELECT logo_storage_key, logo_content_type FROM tenants WHERE id = $1', [tenantId])).rows[0],
  )
  if (!row?.logo_storage_key) return null
  const buffer = await store.getObject(row.logo_storage_key)
  return buffer ? { buffer, contentType: row.logo_content_type } : null
}

export async function removeLogo(tenantId) {
  const key = await withTenant(tenantId, async (client) => {
    const old = (await client.query('SELECT logo_storage_key FROM tenants WHERE id = $1', [tenantId])).rows[0]?.logo_storage_key
    await client.query('UPDATE tenants SET logo_storage_key = NULL, logo_content_type = NULL WHERE id = $1', [tenantId])
    return old
  })
  if (key) await store.deleteObject(key).catch(() => {})
  return Boolean(key)
}

/** Nur die Bytes — für das PDF. Ein fehlendes oder unlesbares Logo darf nie ein PDF verhindern. */
export async function loadLogoBuffer(tenantId) {
  try {
    return (await getLogo(tenantId))?.buffer ?? null
  } catch {
    return null
  }
}
