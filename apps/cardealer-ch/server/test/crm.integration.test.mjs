/**
 * Anfragen, Benutzer, Fotos, Inserate — gegen echtes PostgreSQL.
 * Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import pg from 'pg'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-photos-'))
process.env.OBJECT_STORAGE_LOCAL_DIR = storeDir // vor dem Import, der Speicher liest es beim Laden

const { closePool } = await import('@tiff/core-db')
const { createVehicle } = await import('../src/services/vehicles.js')
const leads = await import('../src/services/leads.js')
const users = await import('../src/services/users.js')
const photos = await import('../src/services/photos.js')
const { getListings, missingListingFields } = await import('../src/services/listings.js')
const { updateTenantSettings, getTenantSettings } = await import('../src/services/tenant-settings.js')
const { createUser, login, validateSessionCookie, encodeSessionCookie } = await import('../src/services/auth.js')
const { listParties } = await import('../src/services/parties.js')
const { listVehicles } = await import('../src/services/vehicles.js')
const { decryptSecret } = await import('../src/services/secrets.js')

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 3)])

test('Bilderkennung an den Bytes, nicht am Header', () => {
  assert.equal(photos.detectImageType(JPEG).type, 'image/jpeg')
  assert.equal(photos.detectImageType(PNG).type, 'image/png')
  assert.equal(photos.detectImageType(WEBP).type, 'image/webp')
  assert.equal(photos.detectImageType(Buffer.from('<html><script>alert(1)</script></html>')), null)
  assert.equal(photos.detectImageType(Buffer.from('GIF89a000000000000')), null)
  assert.equal(photos.detectImageType(Buffer.alloc(3)), null)
  assert.equal(photos.detectImageType('JPEG'), null)
})

test('Inserate: fehlende Pflichtfelder', () => {
  assert.deepEqual(missingListingFields({ make: 'VW', model: 'Golf' }).sort(), [
    'askingPriceRappen', 'bodyColor', 'bodyType', 'conditionType', 'firstRegistrationDate', 'vehicleCategory', 'warrantyType',
  ])
  const complete = {
    make: 'VW', model: 'Golf', vehicleCategory: 'car', bodyColor: 'grey', bodyType: 'saloon', conditionType: 'used',
    firstRegistrationDate: '2020-01-01', askingPriceRappen: 1, warrantyType: 'none',
  }
  assert.deepEqual(missingListingFields(complete), [])
  assert.deepEqual(missingListingFields({ ...complete, make: '' }), ['make'])
})

test('Anfragen, Benutzer, Fotos, Inserate', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mkTenant = async (name) =>
    (await adminPool.query('INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id', [name, `${name}-${Math.random().toString(36).slice(2, 8)}`])).rows[0].id
  const A = await mkTenant('crm-a')
  const B = await mkTenant('crm-b')

  t.after(async () => {
    for (const id of [A, B]) {
      for (const table of ['leads', 'vehicle_photos', 'vehicles', 'parties', 'sessions', 'users']) {
        await adminPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id])
      }
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  const car = await createVehicle(A, { make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000004', askingPriceRappen: 1_300_000 })

  await t.test('Anfragen: prüfen, anlegen, ändern', async () => {
    await assert.rejects(leads.createLead(A, { name: '', email: 'a@b.ch' }), /Namen/)
    await assert.rejects(leads.createLead(A, { name: 'Max', email: 'kaputt' }), /E-Mail/)
    await assert.rejects(leads.createLead(A, { name: 'Max' }), /erreichbar/)
    await assert.rejects(leads.createLead(A, { name: 'Max', phone: '079', type: 'foo' }), /Anfrageart/)

    const lead = await leads.createLead(A, { name: 'Max Keller', email: 'max@example.ch', phone: '079 555 12 34', type: 'test_drive', vehicleId: car.id, message: 'Probefahrt?' })
    assert.equal(lead.status, 'new')
    assert.equal(lead.vehicleLabel, 'VW Golf')
    assert.equal(await leads.countNewLeads(A), 1)

    const contacted = await leads.updateLead(A, lead.id, { status: 'contacted', notes: 'Rückruf vereinbart' })
    assert.equal(contacted.status, 'contacted')
    assert.equal(contacted.notes, 'Rückruf vereinbart')
    assert.equal(contacted.name, 'Max Keller', 'nicht genannte Felder bleiben')
    assert.equal(await leads.countNewLeads(A), 0)
    await assert.rejects(leads.updateLead(A, lead.id, { status: 'foo' }), /Status/)
  })

  await t.test('Anfrage zu Kunde machen: einmal, ohne Duplikat', async () => {
    const lead = await leads.createLead(A, { name: 'Erika Beispiel Muster', email: 'erika@example.ch' })
    const first = await leads.convertLeadToParty(A, lead.id)
    assert.equal(first.created, true)
    const parties = await listParties(A)
    const party = parties.find((p) => p.id === first.partyId)
    assert.equal(party.firstName, 'Erika')
    assert.equal(party.lastName, 'Beispiel Muster')

    const again = await leads.convertLeadToParty(A, lead.id)
    assert.equal(again.created, false)
    assert.equal(again.partyId, first.partyId)

    const second = await leads.createLead(A, { name: 'E. Beispiel', email: 'ERIKA@example.ch' })
    const linked = await leads.convertLeadToParty(A, second.id)
    assert.equal(linked.created, false, 'gleiche E-Mail (Gross/Klein egal) verknüpft den bestehenden Kunden')
    assert.equal(linked.partyId, first.partyId)
  })

  await t.test('Mandant B sieht und ändert keine Anfragen', async () => {
    const [any] = await leads.listLeads(A)
    assert.deepEqual(await leads.listLeads(B), [])
    assert.equal(await leads.updateLead(B, any.id, { status: 'lost' }), null)
    assert.equal(await leads.deleteLead(B, any.id), false)
    assert.equal(await leads.convertLeadToParty(B, any.id), null)
  })

  await t.test('Benutzer: anlegen, Sicherungen, Sitzungen enden sofort', async () => {
    const ownerId = await createUser({ tenantId: A, email: 'chef@crm-a.ch', name: 'Chef', password: 'ChefPasswort123', role: 'inhaber' })
    await assert.rejects(users.addUser(A, { name: '', email: 'x@y.ch', password: 'langespasswort', role: 'verkauf' }), /Name/)
    await assert.rejects(users.addUser(A, { name: 'X', email: 'kaputt', password: 'langespasswort', role: 'verkauf' }), /E-Mail/)
    await assert.rejects(users.addUser(A, { name: 'X', email: 'x@y.ch', password: 'kurz', role: 'verkauf' }), /10 Zeichen/)
    await assert.rejects(users.addUser(A, { name: 'X', email: 'x@y.ch', password: 'langespasswort', role: 'boss' }), /Rolle/)

    const seller = await users.addUser(A, { name: 'Verena Verkauf', email: 'verena@crm-a.ch', password: 'VerenaPasswort1', role: 'verkauf' })
    await assert.rejects(users.addUser(A, { name: 'Zweite', email: 'VERENA@crm-a.ch', password: 'ZweitesPasswort1', role: 'verkauf' }), /bereits/)

    assert.equal((await users.listUsers(A)).length, 2)
    assert.deepEqual(await users.listUsers(B), [])
    assert.equal(await users.updateUser(B, ownerId, seller.id, { active: false }), null)

    // Sitzung von Verena, dann sperren -> sofort ungültig
    const session = await login({ tenantSlug: (await adminPool.query('SELECT slug FROM tenants WHERE id = $1', [A])).rows[0].slug, email: 'verena@crm-a.ch', password: 'VerenaPasswort1' })
    const cookie = encodeSessionCookie(A, session.sessionId)
    assert.ok(await validateSessionCookie(cookie))
    await users.updateUser(A, ownerId, seller.id, { active: false })
    assert.equal(await validateSessionCookie(cookie), null, 'gesperrt = sofort draussen')

    // Neues Passwort beendet ebenfalls alle Sitzungen
    await users.updateUser(A, ownerId, seller.id, { active: true })
    const s2 = await login({ tenantSlug: (await adminPool.query('SELECT slug FROM tenants WHERE id = $1', [A])).rows[0].slug, email: 'verena@crm-a.ch', password: 'VerenaPasswort1' })
    await users.updateUser(A, ownerId, seller.id, { password: 'NeuesPasswort123' })
    assert.equal(await validateSessionCookie(encodeSessionCookie(A, s2.sessionId)), null)

    // Selbstsperre und letzter Inhaber
    await assert.rejects(users.updateUser(A, ownerId, ownerId, { active: false }), /selbst/)
    await assert.rejects(users.updateUser(A, seller.id, ownerId, { role: 'verkauf' }), /mindestens ein aktiver Inhaber/)
    await assert.rejects(users.updateUser(A, seller.id, ownerId, { active: false }), /mindestens ein aktiver Inhaber/)

    // Mit einem zweiten Inhaber geht es
    await users.updateUser(A, ownerId, seller.id, { role: 'inhaber' })
    assert.equal((await users.updateUser(A, seller.id, ownerId, { role: 'buchhaltung' })).role, 'buchhaltung')
  })

  await t.test('Fotos: ablegen, Titelbild, Reihenfolge, löschen, Mandantentrennung', async () => {
    await assert.rejects(photos.addPhoto(A, car.id, Buffer.from('kein Bild, aber lang genug')), /kein Foto/)
    await assert.rejects(photos.addPhoto(A, car.id, Buffer.concat([JPEG, Buffer.alloc(photos.MAX_PHOTO_BYTES)])), /10 MB/)
    assert.equal(await photos.addPhoto(A, '00000000-0000-0000-0000-000000000000', JPEG), null)

    const p1 = await photos.addPhoto(A, car.id, JPEG)
    const p2 = await photos.addPhoto(A, car.id, PNG)
    const p3 = await photos.addPhoto(A, car.id, WEBP)
    assert.equal(p1.isCover, true, 'das erste Foto wird Titelbild')
    assert.equal(p2.isCover, false)
    assert.deepEqual((await photos.listPhotos(A, car.id)).map((p) => p.position), [0, 1, 2])

    const bytes = await photos.getPhotoBytes(A, car.id, p2.id)
    assert.equal(bytes.contentType, 'image/png')
    assert.ok(bytes.buffer.equals(PNG))

    assert.equal((await listVehicles(A)).find((v) => v.id === car.id).coverPhotoId, p1.id)

    assert.equal(await photos.setCover(A, car.id, p3.id), true)
    const covers = (await photos.listPhotos(A, car.id)).filter((p) => p.isCover)
    assert.deepEqual(covers.map((p) => p.id), [p3.id], 'genau ein Titelbild')

    await photos.movePhoto(A, car.id, p3.id, -1)
    assert.deepEqual((await photos.listPhotos(A, car.id)).map((p) => p.id), [p1.id, p3.id, p2.id])
    await photos.movePhoto(A, car.id, p1.id, -1) // schon ganz vorne: bleibt
    assert.equal((await photos.listPhotos(A, car.id))[0].id, p1.id)
    await assert.rejects(photos.movePhoto(A, car.id, p1.id, 5), /direction/)

    // Mandant B: nichts
    assert.deepEqual(await photos.listPhotos(B, car.id), [])
    assert.equal(await photos.getPhotoBytes(B, car.id, p1.id), null)
    assert.equal(await photos.deletePhoto(B, car.id, p1.id), false)
    assert.equal(await photos.setCover(B, car.id, p1.id), false)
    assert.equal(await photos.addPhoto(B, car.id, JPEG), null)

    // Titelbild löschen -> das erste verbliebene rückt nach, Datei ist weg
    assert.equal(await photos.deletePhoto(A, car.id, p3.id), true)
    const rest = await photos.listPhotos(A, car.id)
    assert.equal(rest.length, 2)
    assert.equal(rest.filter((p) => p.isCover).length, 1)
    assert.equal(rest[0].isCover, true)
    assert.equal(await photos.getPhotoBytes(A, car.id, p3.id), null)
    assert.equal(fs.readdirSync(path.join(storeDir, A, 'vehicles', car.id)).length, 2)
  })

  await t.test('Inserate-Übersicht und AutoScout24-Geheimnis', async () => {
    let listings = await getListings(A)
    assert.equal(listings.configured, false)
    const row = listings.rows.find((r) => r.id === car.id)
    assert.equal(row.ready, false)
    assert.ok(row.missing.includes('warrantyType'))
    assert.equal('purchasePriceRappen' in row, false, 'kein Einkaufspreis in der Inserate-Sicht')

    await updateTenantSettings(A, { autoscout24ClientId: 'cid', autoscout24SellerId: '42', autoscout24ClientSecret: 'topsecret' })
    listings = await getListings(A)
    assert.equal(listings.configured, true)

    const settings = await getTenantSettings(A)
    assert.equal(settings.autoscout24HasSecret, true)
    assert.equal(JSON.stringify(settings).includes('topsecret'), false, 'das Geheimnis wird nie zurückgegeben')
    assert.equal(settings.autoscout24ClientId, 'cid')

    await updateTenantSettings(A, { autoscout24ClientSecret: '' })
    assert.equal((await getTenantSettings(A)).autoscout24HasSecret, true, 'leer lassen behält das Geheimnis')
    const stored = (await adminPool.query('SELECT autoscout24_client_secret FROM tenants WHERE id = $1', [A])).rows[0]
    assert.equal(stored.autoscout24_client_secret.startsWith('enc:v1:'), true, 'in der Datenbank steht nie Klartext')
    assert.equal(stored.autoscout24_client_secret.includes('topsecret'), false)
    assert.equal(decryptSecret(stored.autoscout24_client_secret), 'topsecret')
  })
})
