/**
 * ZIP-Export des Belegarchivs und Löschschutz für archivierte Belege auf
 * Datenbankebene. Übersprungen ohne DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { crc32 } from 'node:zlib'
import pg from 'pg'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-export-'))
process.env.OBJECT_STORAGE_LOCAL_DIR = storeDir

const { closePool, withTenant } = await import('@tiff/core-db')
const { createZip } = await import('../src/services/zip.js')
const { createVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const { issueContract } = await import('../src/services/contracts.js')
const { buildArchiveExport } = await import('../src/services/archive-browser.js')
const { createInvoice } = await import('../src/services/invoices.js')

/** Liest unser ZIP über das zentrale Verzeichnis zurück — unabhängig vom Schreiber. */
function readZip(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50)
    const crc = zip.readUInt32LE(p + 16)
    const size = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const localOffset = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50)
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const data = zip.subarray(dataStart, dataStart + size)
    assert.equal(crc32(data) >>> 0, crc, `CRC von ${name}`)
    out.set(name, data)
    p += 46 + nameLen
  }
  return out
}

test('ZIP-Schreiber: Namen mit Umlauten, Ordner, leere Datei, Prüfsummen', () => {
  const zip = createZip([
    { name: 'Rechnungen/RE-1.pdf', data: Buffer.from('%PDF-1.4 inhalt') },
    { name: 'Übersicht ä.txt', data: Buffer.from('Grüezi') },
    { name: 'leer.txt', data: Buffer.alloc(0) },
  ])
  const files = readZip(zip)
  assert.deepEqual([...files.keys()], ['Rechnungen/RE-1.pdf', 'Übersicht ä.txt', 'leer.txt'])
  assert.equal(files.get('Übersicht ä.txt').toString(), 'Grüezi')
  assert.equal(files.get('leer.txt').length, 0)
  assert.equal(readZip(createZip([])).size, 0)
})

test('Export und Löschschutz', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mkTenant = async (name) =>
    (await adminPool.query(
      `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city)
       VALUES (gen_random_uuid(), $1, $1 || ' AG', $2, 'Teststrasse 1', '3000', 'Bern') RETURNING id`,
      [name, `${name}-${Math.random().toString(36).slice(2, 8)}`],
    )).rows[0].id
  const A = await mkTenant('exp-a')
  const B = await mkTenant('exp-b')

  t.after(async () => {
    for (const id of [A, B]) {
      await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [id])
      await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [id]) // Besitzer-Rolle: darf (Wartung)
      await adminPool.query('DELETE FROM number_sequences WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM vehicles WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM parties WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM tenants WHERE id = $1', [id])
    }
    await adminPool.end()
    await closePool()
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  const person = await createParty(A, { kind: 'person', firstName: 'Anna', lastName: 'Muster', addressStreet: 'Weg 2', addressZip: '8000', addressCity: 'Zürich' })
  const car = await createVehicle(A, { make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000006', purchasePriceRappen: 1_000_000, askingPriceRappen: 1_300_000 })
  const sale = await issueContract(A, null, car.id, 'sale', { partyId: person.id, warrantyMonths: 12 })
  const purchase = await issueContract(A, null, car.id, 'purchase', { partyId: person.id })
  const loose = await createInvoice(A, { partyId: person.id, lines: [{ description: 'ohne PDF', quantity: 1, unitPriceRappen: 1000 }] })

  await t.test('Export enthält die archivierten PDFs, Index und Liesmich', async () => {
    const { zip, count, problems } = await buildArchiveExport(A, new Date('2026-10-03T12:00:00Z'))
    const files = readZip(zip)
    assert.equal(count, 2)
    assert.equal(problems, 1, 'die nicht archivierte Rechnung ist eine Auffälligkeit')
    assert.ok(files.get(`Kaufvertraege/${sale.number}.pdf`).subarray(0, 5).toString() === '%PDF-')
    assert.ok(files.get(`Ankaufsvertraege/${purchase.number}.pdf`))
    const index = files.get('index.csv').toString('utf8')
    assert.ok(index.startsWith('﻿Nummer;Art;'))
    assert.ok(index.includes(`"${sale.number}";"sale_contract"`))
    assert.ok(index.includes(sale.hash))
    assert.ok(index.includes(`"${loose.number}"`) && index.includes('NICHT_ARCHIVIERT'))
    assert.ok(files.get('LIESMICH.txt').toString().includes('mit Auffälligkeit: 1'))
    const empty = await buildArchiveExport(B)
    assert.equal(empty.count, 0, 'Mandant B hat kein Archiv')
    assert.deepEqual([...readZip(empty.zip).keys()], ['index.csv', 'LIESMICH.txt'])
  })

  await t.test('Export markiert veränderte und fehlende Dateien, statt sie als gut auszugeben', async () => {
    const file = path.join(storeDir, A, 'documents', `${sale.id}.pdf`)
    const original = fs.readFileSync(file)
    fs.appendFileSync(file, '\n% verändert')
    let r = await buildArchiveExport(A)
    assert.equal(r.problems, 2)
    assert.ok(readZip(r.zip).get('index.csv').toString('utf8').includes('HASH_ABWEICHEND'))

    fs.rmSync(file)
    r = await buildArchiveExport(A)
    assert.ok(readZip(r.zip).get('index.csv').toString('utf8').includes('DATEI_FEHLT'))
    assert.equal(r.count, 1, 'fehlende Datei kann nicht mitgeliefert werden')
    fs.writeFileSync(file, original)
    assert.equal((await buildArchiveExport(A)).problems, 1)
  })

  await t.test('Anwendungsrolle kann archivierte Belege weder löschen noch umhängen', async () => {
    await assert.rejects(withTenant(A, (c) => c.query('DELETE FROM documents WHERE id = $1', [sale.id])), /nicht gelöscht werden/)
    await assert.rejects(withTenant(A, (c) => c.query("UPDATE documents SET pdf_hash = 'abc' WHERE id = $1", [sale.id])), /nicht geändert werden/)
    await assert.rejects(withTenant(A, (c) => c.query("UPDATE documents SET pdf_storage_key = 'x' WHERE id = $1", [sale.id])), /nicht geändert werden/)
    await assert.rejects(withTenant(A, (c) => c.query('DELETE FROM tenants WHERE id = $1', [A])), /permission denied|keine Berechtigung|Zugriff verweigert/i, 'Mandanten löscht nur die Wartung')
    // Andere Felder bleiben änderbar (z.B. Status), und nicht archivierte Belege sind löschbar
    await withTenant(A, (c) => c.query("UPDATE documents SET status = 'paid' WHERE id = $1", [sale.id]))
    await withTenant(A, (c) => c.query('DELETE FROM documents WHERE id = $1', [loose.id])).catch(async (err) => {
      // hat Positionen -> FK; erst Positionen weg, dann der Beleg
      assert.match(err.message, /foreign key|Fremdschlüssel/i)
      await withTenant(A, (c) => c.query('DELETE FROM document_lines WHERE document_id = $1', [loose.id]))
      await withTenant(A, (c) => c.query('DELETE FROM documents WHERE id = $1', [loose.id]))
    })
    const left = (await adminPool.query('SELECT id FROM documents WHERE id = $1', [loose.id])).rows
    assert.equal(left.length, 0)
    assert.equal((await adminPool.query('SELECT pdf_hash FROM documents WHERE id = $1', [sale.id])).rows[0].pdf_hash, sale.hash)
  })
})
