/**
 * Betriebslogo auf PDFs, Verträge im Belegarchiv, Archiv-Sicht und
 * Integritätsprüfung — gegen echtes PostgreSQL und einen lokalen
 * Objektspeicher in einem Temp-Verzeichnis. Übersprungen ohne
 * DATABASE_URL/MIGRATE_DATABASE_URL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import pg from 'pg'

const hasDb = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL)
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiff-archive-'))
process.env.OBJECT_STORAGE_LOCAL_DIR = storeDir

const { closePool } = await import('@tiff/core-db')
const { createVehicle } = await import('../src/services/vehicles.js')
const { createParty } = await import('../src/services/parties.js')
const { createInvoice, getInvoice } = await import('../src/services/invoices.js')
const { renderInvoicePdfBuffer, withLogo } = await import('../src/services/invoice-pdf.js')
const { archivePdf, getArchivedPdf } = await import('../src/services/archive.js')
const logoSvc = await import('../src/services/tenant-logo.js')
const contracts = await import('../src/services/contracts.js')
const archive = await import('../src/services/archive-browser.js')

// kleinstes gültiges PNG (1×1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const JPEG_HEADER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)])

test('Aufbewahrungsfrist: Ende des Belegjahres + 10 Jahre', () => {
  assert.equal(archive.retainUntil('2026-03-05'), '2036-12-31')
  assert.equal(archive.retainUntil('2026-12-31'), '2036-12-31')
  assert.equal(archive.retainUntil('2027-01-01'), '2037-12-31')
})

test('Logo, Verträge, Archiv', { skip: !hasDb }, async (t) => {
  const adminPool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
  const mkTenant = async (name) =>
    (
      await adminPool.query(
        `INSERT INTO tenants (id, name, legal_name, slug, address_street, address_zip, address_city)
         VALUES (gen_random_uuid(), $1, $1 || ' AG', $2, 'Teststrasse 1', '3000', 'Bern') RETURNING id`,
        [name, `${name}-${Math.random().toString(36).slice(2, 8)}`],
      )
    ).rows[0].id
  const A = await mkTenant('arch-a')
  const B = await mkTenant('arch-b')

  t.after(async () => {
    for (const id of [A, B]) {
      await adminPool.query('DELETE FROM audit_log WHERE tenant_id = $1', [id])
      await adminPool.query('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE tenant_id = $1)', [id])
      await adminPool.query('DELETE FROM documents WHERE tenant_id = $1', [id])
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
  const car = await createVehicle(A, {
    make: 'VW', model: 'Golf', vin: 'WVWZZZ1KZAW000005', mileageKm: 90000,
    purchasePriceRappen: 1_000_000, askingPriceRappen: 1_300_000, purchaseFrom: 'private', purchasedAt: '2026-05-01',
  })

  await t.test('Logo: nur PNG/JPEG, höchstens 2 MB, ersetzen räumt auf, entfernen', async () => {
    assert.equal(await logoSvc.getLogo(A), null)
    await assert.rejects(logoSvc.setLogo(A, WEBP), /PNG oder JPEG/)
    await assert.rejects(logoSvc.setLogo(A, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), /PNG oder JPEG/)
    await assert.rejects(logoSvc.setLogo(A, Buffer.concat([PNG, Buffer.alloc(logoSvc.MAX_LOGO_BYTES)])), /2 MB/)

    await logoSvc.setLogo(A, PNG)
    const got = await logoSvc.getLogo(A)
    assert.equal(got.contentType, 'image/png')
    assert.ok(got.buffer.equals(PNG))
    assert.equal(await logoSvc.getLogo(B), null, 'Mandant B hat kein Logo')

    await logoSvc.setLogo(A, JPEG_HEADER) // anderer Typ -> anderer Schlüssel, der alte muss weg
    assert.deepEqual(fs.readdirSync(path.join(storeDir, A, 'branding')), ['logo.jpg'])
    await logoSvc.setLogo(A, PNG)
    assert.deepEqual(fs.readdirSync(path.join(storeDir, A, 'branding')), ['logo.png'])
  })

  await t.test('Rechnungs-PDF bettet das Logo ein und ist ohne Logo trotzdem möglich', async () => {
    const invoice = await createInvoice(A, { partyId: person.id, issueDate: '2026-06-01', lines: [{ description: 'Test', quantity: 1, unitPriceRappen: 100_000 }] })
    const full = await getInvoice(A, invoice.id)
    const withImage = await renderInvoicePdfBuffer(await withLogo(A, full))
    assert.ok(withImage.includes('/Subtype /Image'), 'Logo ist als Bild im PDF')

    await logoSvc.removeLogo(A)
    assert.equal(await logoSvc.getLogo(A), null)
    assert.equal(fs.existsSync(path.join(storeDir, A, 'branding', 'logo.png')), false)
    const withoutImage = await renderInvoicePdfBuffer(await withLogo(A, full))
    assert.equal(withoutImage.includes('/Subtype /Image'), false)
    assert.equal(withoutImage.subarray(0, 5).toString(), '%PDF-')
    await logoSvc.setLogo(A, PNG)
  })

  await t.test('Vertrag ausstellen: Prüfungen vor der Nummernvergabe', async () => {
    await assert.rejects(contracts.issueContract(A, null, car.id, 'sale', {}), /Käufer/)
    await assert.rejects(contracts.issueContract(A, null, car.id, 'purchase', {}), /Verkäufer/)
    await assert.rejects(contracts.issueContract(A, null, car.id, 'foo', {}), /Vertragsart/)
    const noPrice = await createVehicle(A, { make: 'Audi', model: 'A1' })
    await assert.rejects(contracts.issueContract(A, null, noPrice.id, 'sale', { partyId: person.id }), /Preis/)
    await assert.rejects(contracts.issueContract(A, null, noPrice.id, 'purchase', { partyId: person.id }), /Einkaufspreis/)
    assert.equal(await contracts.issueContract(A, null, '00000000-0000-0000-0000-000000000000', 'sale', { partyId: person.id }), null)
    assert.deepEqual(await contracts.listContracts(A, car.id), [], 'nichts davon hat einen Beleg erzeugt')
    const seq = await adminPool.query("SELECT 1 FROM number_sequences WHERE tenant_id = $1 AND document_type IN ('sale_contract','purchase_contract')", [A])
    assert.equal(seq.rows.length, 0, 'keine Nummer verbraucht')
  })

  let saleDoc
  await t.test('Vertrag ausstellen: Nummer, Archiv, Hash, Audit', async () => {
    saleDoc = await contracts.issueContract(A, null, car.id, 'sale', { partyId: person.id, warrantyMonths: 12 })
    const purchase = await contracts.issueContract(A, null, car.id, 'purchase', { partyId: person.id })
    const year = new Date().getFullYear()
    assert.equal(saleDoc.number, `KV-${year}-00001`)
    assert.equal(purchase.number, `AV-${year}-00001`)
    assert.equal(saleDoc.totalRappen, 1_300_000)
    assert.equal(purchase.totalRappen, 1_000_000)

    const second = await contracts.issueContract(A, null, car.id, 'sale', { partyId: person.id })
    assert.equal(second.number, `KV-${year}-00002`, 'ein zweiter Vertrag bekommt die nächste Nummer')

    const bytes = await getArchivedPdf(A, saleDoc.id)
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), saleDoc.hash)

    const audit = await adminPool.query("SELECT action FROM audit_log WHERE entity_id = $1", [saleDoc.id])
    assert.deepEqual(audit.rows.map((r) => r.action), ['pdf_archived'])
    assert.equal((await contracts.listContracts(A, car.id)).length, 3)
    assert.deepEqual(await contracts.listContracts(B, car.id), [])
  })

  await t.test('Archiv-Sicht: Belege, Frist, Mandantentrennung', async () => {
    const [invoice] = (await archive.listArchive(A)).filter((r) => r.type === 'invoice')
    assert.equal(invoice.archived, false, 'Rechnung wurde noch nie als PDF abgerufen')
    const sale = (await archive.listArchive(A)).find((r) => r.id === saleDoc.id)
    assert.equal(sale.archived, true)
    assert.equal(sale.partyName, 'Anna Muster')
    assert.equal(sale.vehicleLabel, 'VW Golf')
    assert.equal(sale.retainUntil, `${new Date().getFullYear() + 10}-12-31`)
    assert.deepEqual(await archive.listArchive(B), [])
    assert.equal(await archive.verifyArchived(B, saleDoc.id), null)
  })

  await t.test('Integritätsprüfung erkennt Manipulation und fehlende Datei', async () => {
    assert.deepEqual(await archive.verifyArchived(A, saleDoc.id), {
      ok: true, hash: saleDoc.hash, storedHash: saleDoc.hash,
    })
    const notArchived = (await archive.listArchive(A)).find((r) => r.type === 'invoice')
    assert.deepEqual(await archive.verifyArchived(A, notArchived.id), { ok: false, reason: 'NOT_ARCHIVED' })

    const file = path.join(storeDir, A, 'documents', `${saleDoc.id}.pdf`)
    const original = fs.readFileSync(file)
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n% nachträglich eingefügt')]))
    const tampered = await archive.verifyArchived(A, saleDoc.id)
    assert.equal(tampered.ok, false)
    assert.equal(tampered.reason, 'HASH_MISMATCH')
    assert.notEqual(tampered.hash, tampered.storedHash)

    fs.rmSync(file)
    assert.equal((await archive.verifyArchived(A, saleDoc.id)).reason, 'FILE_MISSING')
    fs.writeFileSync(file, original)
    assert.equal((await archive.verifyArchived(A, saleDoc.id)).ok, true)
  })

  await t.test('Rechnung wird beim ersten Abruf archiviert und erscheint dann als archiviert', async () => {
    const [invoiceRow] = (await archive.listArchive(A)).filter((r) => r.type === 'invoice')
    const full = await getInvoice(A, invoiceRow.id)
    const pdf = await renderInvoicePdfBuffer(await withLogo(A, full))
    await archivePdf(A, { documentId: invoiceRow.id, userId: null, pdfBuffer: pdf })
    const after = (await archive.listArchive(A)).find((r) => r.id === invoiceRow.id)
    assert.equal(after.archived, true)
    assert.equal((await archive.verifyArchived(A, invoiceRow.id)).ok, true)
  })
})
