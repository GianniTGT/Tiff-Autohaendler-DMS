/**
 * Geheimnisse in der Datenbank (AutoScout24-Client-Secret) verschlüsselt
 * ablegen: AES-256-GCM, Schlüssel aus `APP_SECRET_KEY` (32 Byte, hex oder
 * base64) — nicht in der Datenbank, damit ein Datenbank-Backup allein nichts
 * preisgibt.
 *
 * Format: `enc:v1:<iv>:<tag>:<ciphertext>` (base64). Ein Wert ohne dieses
 * Präfix gilt als Klartext aus der Zeit davor und wird weiter gelesen
 * (decryptSecret), beim nächsten Speichern aber verschlüsselt abgelegt.
 *
 * Ohne `APP_SECRET_KEY`:
 *  - Betrieb (`NODE_ENV=production`): Fehler beim Speichern und Lesen — lieber
 *    gar nichts speichern als im Klartext.
 *  - Entwicklung: ein fester Entwicklungsschlüssel, damit lokal nichts extra
 *    einzurichten ist. Der schützt nichts und ist bewusst als solcher benannt.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const PREFIX = 'enc:v1:'

function loadKey(env = process.env) {
  const raw = env.APP_SECRET_KEY
  if (raw) {
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new Error('APP_SECRET_KEY muss 32 Byte lang sein (64 Hex-Zeichen oder Base64).')
    return key
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET_KEY fehlt — ohne ihn werden keine Zugangsdaten gespeichert oder gelesen.')
  }
  return scryptSync('tiff-autohaendler-dms-nur-fuer-die-entwicklung', 'dev-salt', 32)
}

export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX)

export function encryptSecret(plain, env = process.env) {
  const key = loadKey(env)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`
}

export function decryptSecret(stored, env = process.env) {
  if (stored == null) return null
  if (!isEncrypted(stored)) return stored // Klartext aus der Zeit vor der Verschlüsselung
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', loadKey(env), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
