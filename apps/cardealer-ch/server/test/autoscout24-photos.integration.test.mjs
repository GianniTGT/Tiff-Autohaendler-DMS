/**
 * Fotos an AutoScout24 — mit einem Ersatz-Client, ohne Netzwerk und ohne echte Zugangsdaten.
 * Prüft die Zusagen aus autoscout24-sync.js: nur hochladen, was dort noch fehlt; Titelbild zuerst;
 * Reihenfolge und Löschungen kommen ohne erneuten Upload an; ein Foto-Fehler lässt den Push der
 * Fahrzeugdaten bestehen und wird am Fahrzeug sichtbar; ohne eigene Fotos wird bei AutoScout24
 * nichts angerührt; ein entferntes Inserat vergisst seine Bildschlüssel.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
process.env.OBJECT_STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-as24-photos-')) // vor dem Import

const { closePool } = await import('@tiff/core-db')
const { createVehicle, getVehicle } = await import('../src/services/vehicles.js')
const photos = await import('../src/services/photos.js')
const sync = await import('../src/services/autoscout24-sync.js')
const { getListings } = await import('../src/services/listings.js')
const { updateTenantSettings } = await import('../src/services/tenant-settings.js')

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)])

/** Zeichnet Uploads und gesetzte Bildlisten auf; `failUploadsWith` lässt den nächsten Upload scheitern. */
function fakeClient() {
  const uploads = [] // { listingId, fileName, type, size }
  const imageLists = [] // [listingId, keys]
  const calls = []
  let failNext = null
  let n = 0
  return {
    uploads,
    imageLists,
    calls,
    failNextUpload(message) {
      failNext = message
    },
    reset() {
      uploads.length = 0
      imageLists.length = 0
      calls.length = 0
    },
    listMakes: async () => [{ key: 'vw', name: 'VW' }],
    listModels: async () => [{ key: 'golf', name: 'Golf' }],
    findByExternalId: async () => null,
    createListing: async () => {
      calls.push('createListing')
      return { id: 'L-1' }
    },
    updateListing: async (_c, _s, listingId) => {
      calls.push(['updateListing', listingId])
      return { id: listingId }
    },
    removeListing: async () => {
      calls.push('removeListing')
    },
    uploadImage: async (_c, _s, listingId, form) => {
      if (failNext) {
        const m = failNext
        failNext = null
        throw new Error(m)
      }
      const file = form.get('file')
      uploads.push({ listingId, fileName: file.name, type: file.type, size: file.size })
      n += 1
      return { key: `k-${n}` }
    },
    setImages: async (_c, _s, listingId, keys) => {
      imageLists.push([listingId, [...keys]])
    },
  }
}

test('Fotos an AutoScout24', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const slug = 'as24-photos-' + Math.random().toString(36).slice(2, 8)
  const tenantId = (
    await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), 'P', 'P AG', $1) RETURNING id`,
      [slug],
    )
  ).rows[0].id
  await updateTenantSettings(tenantId, { autoscout24ClientId: 'cid', autoscout24SellerId: '42', autoscout24ClientSecret: 'geheim' })
  const client = fakeClient()

  t.after(async () => {
    await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [tenantId])
    await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await adminPool.end()
    await closePool()
    fs.rmSync(process.env.OBJECT_STORAGE_LOCAL_DIR, { recursive: true, force: true })
  })

  const base = {
    make: 'VW',
    model: 'Golf',
    vehicleCategory: 'car',
    bodyColor: 'white',
    bodyType: 'small-car',
    conditionType: 'used',
    firstRegistrationDate: '2020-06-15',
    warrantyType: 'from-delivery',
    askingPriceRappen: 2_400_000,
  }
  const car = await createVehicle(tenantId, base)
  const p1 = await photos.addPhoto(tenantId, car.id, JPEG)
  const p2 = await photos.addPhoto(tenantId, car.id, PNG)
  const p3 = await photos.addPhoto(tenantId, car.id, JPEG)
  await photos.setCover(tenantId, car.id, p2.id) // Titelbild ist nicht das erste

  await t.test('erster Push lädt jedes Foto als multipart «file» hoch und setzt die Liste mit dem Titelbild zuerst', async () => {
    const result = await sync.pushVehicleToAutoScout24(tenantId, car.id, { client })
    assert.deepEqual(result.photos, { status: 'synced', total: 3, uploaded: 3, reused: 0 })

    assert.equal(client.uploads.length, 3)
    assert.ok(client.uploads.every((u) => u.listingId === 'L-1'))
    assert.deepEqual(
      client.uploads.map((u) => [u.fileName, u.type, u.size]),
      [
        [`${p2.id}.png`, 'image/png', PNG.length],
        [`${p1.id}.jpg`, 'image/jpeg', JPEG.length],
        [`${p3.id}.jpg`, 'image/jpeg', JPEG.length],
      ],
    )
    assert.deepEqual(client.imageLists, [['L-1', ['k-1', 'k-2', 'k-3']]])

    const stored = await photos.listPhotos(tenantId, car.id)
    assert.deepEqual(
      stored.map((p) => [p.id, p.autoscout24ImageKey]),
      [
        [p1.id, 'k-2'],
        [p2.id, 'k-1'],
        [p3.id, 'k-3'],
      ],
    )
    assert.equal((await getVehicle(tenantId, car.id)).autoscout24LastError, null)
  })

  await t.test('zweiter Push: kein erneuter Upload, die Liste wird trotzdem neu gesetzt', async () => {
    client.reset()
    const result = await sync.pushVehicleToAutoScout24(tenantId, car.id, { client })
    assert.deepEqual(result.photos, { status: 'synced', total: 3, uploaded: 0, reused: 3 })
    assert.equal(client.uploads.length, 0)
    assert.deepEqual(client.imageLists, [['L-1', ['k-1', 'k-2', 'k-3']]])
  })

  await t.test('umsortieren und löschen kommen ohne Upload an; ein neues Foto geht allein hinauf', async () => {
    client.reset()
    await photos.movePhoto(tenantId, car.id, p3.id, -1) // p3 vor p1
    await photos.deletePhoto(tenantId, car.id, p1.id)
    const p4 = await photos.addPhoto(tenantId, car.id, JPEG)

    const result = await sync.syncPhotosToAutoScout24(tenantId, car.id, { client })
    assert.deepEqual(result, { status: 'synced', total: 3, uploaded: 1, reused: 2 })
    assert.deepEqual(client.uploads.map((u) => u.fileName), [`${p4.id}.jpg`])
    assert.deepEqual(client.imageLists, [['L-1', ['k-1', 'k-3', 'k-4']]], 'Titelbild p2, dann p3, dann das neue; der Key des gelöschten p1 fehlt')
  })

  await t.test('scheitert ein Upload, bleibt der Push der Fahrzeugdaten bestehen und der Fehler steht am Fahrzeug', async () => {
    client.reset()
    const p5 = await photos.addPhoto(tenantId, car.id, PNG)
    client.failNextUpload('Bild zu gross')

    const result = await sync.pushVehicleToAutoScout24(tenantId, car.id, { client })
    assert.deepEqual(client.calls, [['updateListing', 'L-1']], 'Fahrzeugdaten sind oben')
    assert.equal(result.photos.status, 'failed')
    assert.match(result.photos.reason, /Bild zu gross/)
    assert.equal(client.imageLists.length, 0, 'keine halbe Liste setzen')
    assert.match((await getVehicle(tenantId, car.id)).autoscout24LastError, /^Fotos: Bild zu gross/)

    const listing = (await getListings(tenantId)).rows.find((r) => r.id === car.id)
    assert.deepEqual(listing.photos, { total: 4, synced: 3, pending: true })

    // «Fotos übertragen» holt nur das fehlende nach und löscht den Fehler.
    client.reset()
    const retry = await sync.syncPhotosToAutoScout24(tenantId, car.id, { client })
    assert.deepEqual(retry, { status: 'synced', total: 4, uploaded: 1, reused: 3 })
    assert.deepEqual(client.uploads.map((u) => u.fileName), [`${p5.id}.png`])
    assert.equal((await getVehicle(tenantId, car.id)).autoscout24LastError, null)
    assert.deepEqual((await getListings(tenantId)).rows.find((r) => r.id === car.id).photos, { total: 4, synced: 4, pending: false })
  })

  await t.test('«Fotos übertragen» hält auch seinen eigenen Fehler fest und wirft ihn', async () => {
    client.reset()
    const p6 = await photos.addPhoto(tenantId, car.id, JPEG)
    client.failNextUpload('Dienst nicht erreichbar')
    await assert.rejects(() => sync.syncPhotosToAutoScout24(tenantId, car.id, { client }), /Dienst nicht erreichbar/)
    assert.match((await getVehicle(tenantId, car.id)).autoscout24LastError, /Dienst nicht erreichbar/)
    await photos.deletePhoto(tenantId, car.id, p6.id)
  })

  await t.test('Inserat entfernen vergisst die Bildschlüssel; der nächste Push lädt alles neu', async () => {
    client.reset()
    await sync.removeAutoScout24Listing(tenantId, car.id, { client })
    const stored = await photos.listPhotos(tenantId, car.id)
    assert.ok(stored.length === 4 && stored.every((p) => p.autoscout24ImageKey === null))

    client.reset()
    const result = await sync.pushVehicleToAutoScout24(tenantId, car.id, { client })
    assert.equal(client.calls[0], 'createListing')
    assert.deepEqual(result.photos, { status: 'synced', total: 4, uploaded: 4, reused: 0 })
  })

  await t.test('ohne eigene Fotos wird die Bildliste bei AutoScout24 nicht angerührt', async () => {
    client.reset()
    const bare = await createVehicle(tenantId, base)
    const result = await sync.pushVehicleToAutoScout24(tenantId, bare.id, { client })
    assert.deepEqual(result.photos, { status: 'none', total: 0, uploaded: 0, reused: 0 })
    assert.equal(client.uploads.length, 0)
    assert.equal(client.imageLists.length, 0)
    const listing = (await getListings(tenantId)).rows.find((r) => r.id === bare.id)
    assert.deepEqual(listing.photos, { total: 0, synced: 0, pending: false })
  })
})
