/**
 * Objektspeicher für archivierte Belege (ANFORDERUNGEN.md §9 Phase 3,
 * SCHWEIZ-SAAS.md §2: "S3-kompatibler Objektspeicher, Schweizer Region" —
 * Exoscale SOS, cloudscale.ch, Infomaniak Swiss Backup, oder für lokale
 * Entwicklung MinIO).
 *
 * Zwei Rückgrate, dieselbe schmale Schnittstelle (`putObject`/`getObject`/
 * `deleteObject`), damit `archive.js` nie wissen muss, welches gerade läuft:
 *
 *  - **lokal (Default)**: schreibt ins Dateisystem. Für Entwicklung ohne
 *    Objektspeicher-Zugangsdaten — genau der Fall, in dem diese Session
 *    gerade läuft. NICHT für den Betrieb: der Container ist vergänglich.
 *  - **S3-kompatibel**: sobald `OBJECT_STORAGE_ENDPOINT` gesetzt ist. Nutzt
 *    `@aws-sdk/client-s3` mit `forcePathStyle`, weil das die meisten
 *    S3-kompatiblen Anbieter (Exoscale, cloudscale, MinIO) so erwarten —
 *    reines AWS S3 selbst bräuchte es nicht, schadet dort aber auch nicht.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import fs from 'node:fs/promises'
import path from 'node:path'

export function createObjectStore(env = process.env) {
  return env.OBJECT_STORAGE_ENDPOINT ? createS3Store(env) : createLocalStore(env)
}

function createLocalStore(env) {
  const baseDir = env.OBJECT_STORAGE_LOCAL_DIR ?? path.join(process.cwd(), 'data', 'objects')

  function resolve(key) {
    // Kein Pfad, der aus baseDir hinausführt — auch nicht über eine
    // dokumentId, die (sollte nie passieren, aber die Prüfung ist billig)
    // Pfadtrenner enthält.
    const resolved = path.normalize(path.join(baseDir, key))
    if (!resolved.startsWith(path.normalize(baseDir))) {
      throw new Error(`Ungültiger Objektschlüssel: ${key}`)
    }
    return resolved
  }

  return {
    backend: 'local',
    async putObject(key, buffer) {
      const filePath = resolve(key)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, buffer)
      return key
    },
    async getObject(key) {
      try {
        return await fs.readFile(resolve(key))
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    async deleteObject(key) {
      await fs.rm(resolve(key), { force: true })
    },
  }
}

function createS3Store(env) {
  const client = new S3Client({
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    region: env.OBJECT_STORAGE_REGION ?? 'ch-gva-2',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
    },
  })
  const bucket = env.OBJECT_STORAGE_BUCKET

  return {
    backend: 's3',
    async putObject(key, buffer, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }))
      return key
    },
    async getObject(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        return Buffer.from(await result.Body.transformToByteArray())
      } catch (err) {
        if (err.name === 'NoSuchKey') return null
        throw err
      }
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
