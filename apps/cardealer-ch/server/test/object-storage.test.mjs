/**
 * Reiner Unit-Test des lokalen Objektspeicher-Backends — kein Netzwerk,
 * keine DB. Das S3-kompatible Backend (createS3Store) ist absichtlich NICHT
 * hier getestet: es baut auf der offiziellen `@aws-sdk/client-s3` auf und
 * bräuchte einen echten S3-kompatiblen Endpunkt (Exoscale/cloudscale/
 * Infomaniak/MinIO) für einen ehrlichen Test — "gemessen, nicht vermutet".
 * Siehe ANFORDERUNGEN.md §10.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createObjectStore } from '../src/integrations/object-storage/store.js'

test('lokaler Objektspeicher: schreiben, lesen, löschen', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiff-object-store-test-'))
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }))

  const store = createObjectStore({ OBJECT_STORAGE_LOCAL_DIR: tmpDir })
  assert.equal(store.backend, 'local')

  await t.test('putObject legt Unterordner automatisch an', async () => {
    await store.putObject('tenant-1/documents/doc-1.pdf', Buffer.from('%PDF-fake-content'))
    const exists = await fs
      .access(path.join(tmpDir, 'tenant-1', 'documents', 'doc-1.pdf'))
      .then(() => true)
      .catch(() => false)
    assert.equal(exists, true)
  })

  await t.test('getObject liefert genau die geschriebenen Bytes', async () => {
    const buffer = await store.getObject('tenant-1/documents/doc-1.pdf')
    assert.equal(buffer.toString(), '%PDF-fake-content')
  })

  await t.test('getObject liefert null für einen unbekannten Schlüssel, statt zu werfen', async () => {
    const result = await store.getObject('tenant-1/documents/does-not-exist.pdf')
    assert.equal(result, null)
  })

  await t.test('deleteObject entfernt die Datei, ein zweites Löschen wirft nicht', async () => {
    await store.deleteObject('tenant-1/documents/doc-1.pdf')
    assert.equal(await store.getObject('tenant-1/documents/doc-1.pdf'), null)
    await store.deleteObject('tenant-1/documents/doc-1.pdf') // idempotent
  })

  await t.test('ein Schlüssel, der aus dem Basisverzeichnis hinausführt, wird abgelehnt', async () => {
    await assert.rejects(() => store.putObject('../../etc/passwd', Buffer.from('x')))
  })
})
