#!/usr/bin/env node
/**
 * Demo-Betrieb für Vorführungen: ein Mandant mit glaubwürdigem Bestand, Kunden, Anfragen,
 * Werkstatt-Aufträgen, Terminen, der ganzen Belegkette und Fotos — damit Übersicht, Kalender und
 * Archiv nicht leer sind, wenn jemand die App zum ersten Mal sieht.
 *
 * Geht ausschliesslich über die Services (dieselben Wege wie die Oberfläche), nur das Anlegen des
 * Mandanten selbst läuft wie in seed-dev-tenant.mjs über MIGRATE_DATABASE_URL.
 *
 * Fotos sind generierte Platzhalter (Silhouette in der Fahrzeugfarbe), keine echten Bilder — im
 * Fahrzeug lassen sie sich jederzeit durch echte ersetzen.
 *
 * Aufruf (aus dem Projektordner):
 *   npm run seed:demo -- --slug=demo --password="Demo-Bern-2026"   (mindestens 10 Zeichen)
 *   optional: --name="Garage Muster AG" --email=chef@demo.ch
 *
 * Aus dem Server-Ordner ausführen (so macht es das npm-Skript): der lokale Objektspeicher liegt
 * unter <cwd>/data/objects, und dort sucht auch der laufende Server die Fotos und Belege.
 */
import pg from 'pg'
import zlib from 'node:zlib'
import { closePool } from '@tiff/core-db'
import { createUser } from '../src/services/auth.js'
import { updateTenantSettings } from '../src/services/tenant-settings.js'
import { createVehicle, sellVehicle } from '../src/services/vehicles.js'
import { addCost } from '../src/services/vehicle-costs.js'
import { addPhoto } from '../src/services/photos.js'
import { createParty } from '../src/services/parties.js'
import { createLead, updateLead } from '../src/services/leads.js'
import { createJob, updateJob } from '../src/services/recon.js'
import { createAppointment } from '../src/services/calendar.js'
import { createSalesDocument, convertSalesDocument } from '../src/services/sales-documents.js'
import { createInvoice, getInvoice } from '../src/services/invoices.js'
import { recordPayment } from '../src/services/payments.js'
import { createReminder, getReminder } from '../src/services/reminders.js'
import { createCreditNote } from '../src/services/credit-notes.js'
import { archiveIfComplete } from '../src/services/archive.js'
import { renderInvoicePdfBuffer, renderReminderPdfBuffer, withLogo } from '../src/services/invoice-pdf.js'

// ---------------------------------------------------------------------------------------------
// Argumente
// ---------------------------------------------------------------------------------------------
function arg(name, fallback) {
  const prefix = `--${name}=`
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}
const slug = arg('slug', 'demo')
const legalName = arg('name', 'Garage Aarefeld AG')
const email = arg('email', `chef@${slug}.ch`)
const password = arg('password')
if (!password) {
  console.error('Braucht --password. Beispiel:\n  npm run seed:demo -- --slug=demo --password="Demo2026!"')
  process.exit(1)
}
if (!process.env.MIGRATE_DATABASE_URL || !process.env.DATABASE_URL) {
  console.error('MIGRATE_DATABASE_URL und DATABASE_URL fehlen — .env im Projektordner anlegen (siehe LOKAL-TESTEN.md).')
  process.exit(1)
}

// ---------------------------------------------------------------------------------------------
// Datums-Helfer: alles relativ zu heute, damit Fristen und Standzeiten in der Übersicht sichtbar sind
// ---------------------------------------------------------------------------------------------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return iso(d)
}
const daysAgo = (n) => shift(-n)
const inDays = (n) => shift(n)
const VAT = 1.081 // Normalsatz 8.1 % — Angebotspreise sind brutto, Belegzeilen netto (wie in der Oberfläche)
const net = (gross) => Math.round(gross / VAT)
const chf = (francs) => francs * 100

// ---------------------------------------------------------------------------------------------
// Platzhalter-Fotos: PNG ohne Abhängigkeiten (Node ≥ 22.2 hat zlib.crc32)
// ---------------------------------------------------------------------------------------------
const RGB = {
  beige: [214, 196, 160],
  black: [28, 30, 34],
  blue: [36, 74, 140],
  bronze: [150, 110, 70],
  brown: [96, 64, 40],
  gold: [190, 160, 70],
  green: [40, 100, 60],
  grey: [120, 124, 130],
  orange: [220, 110, 30],
  red: [170, 30, 40],
  silver: [190, 194, 200],
  violet: [90, 50, 120],
  white: [236, 238, 240],
  yellow: [230, 200, 40],
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // Bittiefe
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Fahrzeug-Silhouette in der Wagenfarbe; `variant` 0–3 = Seite, Front, Heck, Detail. */
function carPlaceholder(colorKey, variant) {
  const W = 800
  const H = 600
  const px = Buffer.alloc(W * H * 3)
  const body = RGB[colorKey] ?? RGB.grey
  const shade = body.map((c) => Math.max(0, Math.round(c * 0.72)))
  const light = body.map((c) => Math.min(255, Math.round(c + (255 - c) * 0.35)))
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 3
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
  }
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c)
  }
  const disc = (cx, cy, r, c) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c)
  }

  // Hintergrund: Himmel-Verlauf oben, Boden unten
  for (let y = 0; y < H; y++) {
    const t = y / H
    const c = y < 400 ? [Math.round(222 - 30 * t), Math.round(230 - 20 * t), Math.round(238 - 10 * t)] : [92, 94, 98]
    for (let x = 0; x < W; x++) set(x, y, c)
  }
  rect(0, 398, W, 402, [70, 72, 76])

  if (variant === 0) {
    // Seitenansicht
    rect(90, 300, 710, 390, body)
    rect(90, 300, 710, 312, light)
    rect(200, 215, 600, 302, body)
    rect(215, 228, 395, 296, [160, 190, 215]) // Fenster vorne
    rect(410, 228, 585, 296, [160, 190, 215]) // Fenster hinten
    rect(400, 228, 406, 296, shade)
    rect(90, 360, 710, 390, shade)
    disc(220, 395, 56, [30, 30, 32])
    disc(220, 395, 28, [170, 170, 176])
    disc(580, 395, 56, [30, 30, 32])
    disc(580, 395, 28, [170, 170, 176])
    rect(700, 318, 712, 340, [240, 220, 120]) // Scheinwerfer
  } else if (variant === 1) {
    // Frontansicht
    rect(200, 180, 600, 400, body)
    rect(230, 150, 570, 182, body)
    rect(250, 165, 550, 240, [160, 190, 215]) // Windschutzscheibe
    rect(200, 330, 600, 400, shade)
    rect(240, 300, 330, 330, [240, 230, 180]) // Scheinwerfer
    rect(470, 300, 560, 330, [240, 230, 180])
    rect(340, 335, 460, 385, [40, 40, 44]) // Kühlergrill
    rect(160, 395, 240, 420, [30, 30, 32])
    rect(560, 395, 640, 420, [30, 30, 32])
  } else if (variant === 2) {
    // Heckansicht
    rect(200, 190, 600, 400, body)
    rect(240, 160, 560, 192, body)
    rect(260, 172, 540, 250, [150, 180, 205])
    rect(200, 330, 600, 400, shade)
    rect(215, 290, 320, 325, [200, 40, 50]) // Rücklichter
    rect(480, 290, 585, 325, [200, 40, 50])
    rect(330, 345, 470, 385, [230, 232, 236]) // Nummernschild
    rect(160, 395, 240, 420, [30, 30, 32])
    rect(560, 395, 640, 420, [30, 30, 32])
  } else {
    // Detail: Felge gross
    rect(0, 0, W, H, shade)
    disc(400, 300, 230, [30, 30, 32])
    disc(400, 300, 160, [175, 178, 184])
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      for (let r = 40; r < 150; r += 2) disc(Math.round(400 + Math.cos(a) * r), Math.round(300 + Math.sin(a) * r), 16, [120, 122, 128])
    }
    disc(400, 300, 38, [60, 62, 66])
  }
  return encodePng(W, H, px)
}

// ---------------------------------------------------------------------------------------------
// Los
// ---------------------------------------------------------------------------------------------
const admin = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL })
let createdTenantId = null
try {
  const exists = await admin.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])
  if (exists.rows.length > 0) {
    console.error(`Es gibt schon einen Betrieb mit dem Slug '${slug}'. Anderen --slug wählen.`)
    process.exit(1)
  }
  const tenantId = (
    await admin.query('INSERT INTO tenants (id, name, legal_name, slug) VALUES (gen_random_uuid(), $1, $1, $2) RETURNING id', [legalName, slug])
  ).rows[0].id
  createdTenantId = tenantId
  const step = (msg) => console.log(`  ✔ ${msg}`)
  console.log(`Demo-Betrieb '${legalName}' (Slug: ${slug})`)

  // --- Betriebsdaten: vollständig, damit QR-Rechnung und Archiv funktionieren
  await updateTenantSettings(tenantId, {
    name: legalName.replace(/ AG$/, ''),
    legalName,
    uid: 'CHE-123.456.789 MWST',
    vatLiable: true,
    vatMethod: 'effective',
    addressStreet: 'Aarefeldstrasse 12',
    addressZip: '3014',
    addressCity: 'Bern',
    qrIban: 'CH44 3199 9123 0008 8901 2', // gültige Test-QR-IBAN
  })
  step('Betriebsdaten (Adresse, UID, MWST effektiv, QR-IBAN)')

  // --- Benutzer: drei Rollen, dasselbe Passwort — für die Vorführung
  const ownerId = await createUser({ tenantId, email, name: 'Daniel Aebi', password, role: 'inhaber' })
  const salesEmail = `sandra.frei@${slug}.ch`
  const workshopEmail = `marco.bieri@${slug}.ch`
  await createUser({ tenantId, email: salesEmail, name: 'Sandra Frei', password, role: 'verkauf' })
  await createUser({ tenantId, email: workshopEmail, name: 'Marco Bieri', password, role: 'werkstatt' })
  step('Benutzer: Inhaber, Verkauf, Werkstatt')

  // --- Kunden
  const party = (fields) => createParty(tenantId, fields)
  const anna = await party({ kind: 'person', firstName: 'Anna', lastName: 'Meier', email: 'anna.meier@bluewin.ch', phone: '079 412 33 18', addressStreet: 'Lindenweg 4', addressZip: '3012', addressCity: 'Bern' })
  const luca = await party({ kind: 'person', firstName: 'Luca', lastName: 'Rossi', email: 'l.rossi@gmx.ch', phone: '078 655 20 71', addressStreet: 'Bahnhofstrasse 21', addressZip: '3600', addressCity: 'Thun' })
  const peter = await party({ kind: 'person', firstName: 'Peter', lastName: 'Keller', email: 'peter.keller@sunrise.ch', phone: '031 971 44 02', addressStreet: 'Schwarzenburgstrasse 88', addressZip: '3097', addressCity: 'Liebefeld' })
  const sarah = await party({ kind: 'person', firstName: 'Sarah', lastName: 'Brunner', email: 'sarah.brunner@gmail.com', phone: '076 301 55 90', addressStreet: 'Kirchbergstrasse 9', addressZip: '3400', addressCity: 'Burgdorf' })
  const taxi = await party({ kind: 'company', companyName: 'Taxi Zentrale Bern GmbH', uid: 'CHE-234.567.891', email: 'disposition@taxi-bern.ch', phone: '031 331 33 13', addressStreet: 'Güterstrasse 6', addressZip: '3008', addressCity: 'Bern' })
  const marco = await party({ kind: 'person', firstName: 'Marco', lastName: 'Hug', email: 'marco.hug@hotmail.com', phone: '079 880 12 45', addressStreet: 'Seevorstadt 17', addressZip: '2502', addressCity: 'Biel/Bienne' })
  await party({ kind: 'company', companyName: 'Autohandel Müller AG', uid: 'CHE-345.678.912', email: 'einkauf@autohandel-mueller.ch', phone: '062 822 71 00', addressStreet: 'Industriestrasse 44', addressZip: '4600', addressCity: 'Olten', notes: 'Lieferant — Occasionen ab Platz, Zahlung 10 Tage' })
  step('7 Kunden und Lieferanten')

  // --- Fahrzeuge
  const base = { vehicleCategory: 'car', conditionType: 'used', warrantyType: 'from-delivery' }
  const vehicles = {}
  const car = async (key, fields, photoCount = 3) => {
    const v = await createVehicle(tenantId, { ...base, ...fields })
    vehicles[key] = v
    for (let i = 0; i < photoCount; i++) await addPhoto(tenantId, v.id, carPlaceholder(fields.bodyColor, i))
    return v
  }

  await car('golf', {
    vin: 'WVWZZZCDZMW123456', serialNumber: '123.456.789', make: 'Volkswagen', model: 'Golf', trim: '1.5 eTSI Style DSG', modelYear: 2021,
    firstRegistrationDate: '2021-03-18', bodyType: 'small-car', fuelType: 'petrol', transmissionType: 'automatic', driveType: 'front',
    bodyColor: 'grey', bodyColorText: 'Dolphin Grey Metallic', interiorColor: 'black', doors: 5, seats: 5, powerKw: 110, displacementCcm: 1498, cylinders: 4,
    mileageKm: 48500, ownersCount: 1, lastInspectionDate: '2024-09-12', inspectionValidUntil: inDays(43), energyLabel: 'B', co2Emission: 125, consumptionCombined: 5.5,
    purchasePriceRappen: chf(18500), askingPriceRappen: chf(23900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(35),
    notes: 'Eintausch von Familie Steiner. Serviceheft lückenlos, zweiter Schlüssel vorhanden.',
  }, 4)
  await car('octavia', {
    vin: 'TMBJJ7NX1L0234567', serialNumber: '234.567.891', make: 'Skoda', model: 'Octavia Combi', trim: '2.0 TDI 4x4 Style DSG', modelYear: 2020,
    firstRegistrationDate: '2020-06-05', bodyType: 'estate', fuelType: 'diesel', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'blue', bodyColorText: 'Lava Blue', interiorColor: 'grey', doors: 5, seats: 5, powerKw: 147, displacementCcm: 1968, cylinders: 4,
    mileageKm: 89000, ownersCount: 2, lastInspectionDate: '2025-05-20', inspectionValidUntil: '2027-05-20', energyLabel: 'C', co2Emission: 139, consumptionCombined: 5.3,
    purchasePriceRappen: chf(21500), askingPriceRappen: chf(26900), vatScheme: 'standard', purchaseFrom: 'dealer', purchasedAt: daysAgo(60),
  })
  await car('bmw', {
    vin: 'WBA5J71030G345678', serialNumber: '345.678.912', make: 'BMW', model: '320d Touring', trim: 'xDrive Luxury Line Steptronic', modelYear: 2019,
    firstRegistrationDate: '2019-10-22', bodyType: 'estate', fuelType: 'diesel', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'black', bodyColorText: 'Saphirschwarz Metallic', interiorColor: 'beige', interiorColorText: 'Leder Dakota Beige', doors: 5, seats: 5, powerKw: 140, displacementCcm: 1995, cylinders: 4,
    mileageKm: 112000, ownersCount: 2, lastInspectionDate: '2024-10-18', inspectionValidUntil: inDays(17), energyLabel: 'D', co2Emission: 132, consumptionCombined: 5.0,
    purchasePriceRappen: chf(24000), askingPriceRappen: chf(29900), vatScheme: 'standard', purchaseFrom: 'auction', purchasedAt: daysAgo(95),
    notes: 'Standzeit beachten — Preis Ende Monat prüfen.',
  }, 4)
  await car('audi', {
    vin: 'WAUZZZF49MA456789', serialNumber: '456.789.123', make: 'Audi', model: 'A4 Avant', trim: '40 TDI quattro S line S tronic', modelYear: 2021,
    firstRegistrationDate: '2021-01-14', bodyType: 'estate', fuelType: 'diesel', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'white', bodyColorText: 'Gletscherweiss Metallic', interiorColor: 'black', doors: 5, seats: 5, powerKw: 140, displacementCcm: 1968, cylinders: 4,
    mileageKm: 67000, ownersCount: 1, lastInspectionDate: '2025-01-09', inspectionValidUntil: '2027-01-09', energyLabel: 'C', co2Emission: 141, consumptionCombined: 5.4,
    purchasePriceRappen: chf(29500), askingPriceRappen: chf(35900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(20),
  }, 4)
  await car('yaris', {
    vin: 'VNKKD3D300A567890', serialNumber: '567.891.234', make: 'Toyota', model: 'Yaris', trim: '1.5 Hybrid Trend e-CVT', modelYear: 2022,
    firstRegistrationDate: '2022-05-30', bodyType: 'small-car', fuelType: 'hybrid-petrol', transmissionType: 'automatic-stepless', driveType: 'front',
    bodyColor: 'red', bodyColorText: 'Emotional Red', interiorColor: 'black', doors: 5, seats: 5, powerKw: 85, displacementCcm: 1490, cylinders: 3,
    mileageKm: 31000, ownersCount: 1, energyLabel: 'A', co2Emission: 92, consumptionCombined: 4.0,
    purchasePriceRappen: chf(14500), askingPriceRappen: chf(18900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(12),
  })
  await car('tesla', {
    vin: '5YJ3E7EB1MF678901', serialNumber: '678.912.345', make: 'Tesla', model: 'Model 3', trim: 'Long Range AWD', modelYear: 2021,
    firstRegistrationDate: '2021-09-08', bodyType: 'saloon', fuelType: 'electric', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'white', bodyColorText: 'Pearl White Multi-Coat', interiorColor: 'black', doors: 4, seats: 5, powerKw: 324,
    mileageKm: 54000, ownersCount: 1, lastInspectionDate: '2024-12-01', inspectionValidUntil: inDays(59), energyLabel: 'A', co2Emission: 0,
    purchasePriceRappen: chf(26000), askingPriceRappen: chf(31900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(45),
    notes: 'Autopilot Basis, Anhängerkupplung, 19-Zoll Sport-Felgen.',
  })
  await car('glc', {
    vin: 'W1N2539051F789012', serialNumber: '789.123.456', make: 'Mercedes-Benz', model: 'GLC 220 d', trim: '4MATIC AMG Line 9G-Tronic', modelYear: 2020,
    firstRegistrationDate: '2020-11-26', bodyType: 'suv', fuelType: 'diesel', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'silver', bodyColorText: 'Iridiumsilber Metallic', interiorColor: 'black', interiorColorText: 'Leder Artico Schwarz', doors: 5, seats: 5, powerKw: 143, displacementCcm: 1950, cylinders: 4,
    mileageKm: 78000, ownersCount: 1, lastInspectionDate: '2025-03-14', inspectionValidUntil: '2027-03-14', energyLabel: 'D', co2Emission: 148, consumptionCombined: 5.6,
    purchasePriceRappen: chf(33000), askingPriceRappen: chf(39900), vatScheme: 'standard', purchaseFrom: 'dealer', purchasedAt: daysAgo(70),
  })
  await car('leon', {
    vin: 'VSSZZZ5FZKR890123', serialNumber: '891.234.567', make: 'Seat', model: 'Leon ST', trim: '1.5 TSI FR', modelYear: 2019,
    firstRegistrationDate: '2019-04-02', bodyType: 'estate', fuelType: 'petrol', transmissionType: 'manual', driveType: 'front',
    bodyColor: 'orange', bodyColorText: 'Desire Red', interiorColor: 'black', doors: 5, seats: 5, powerKw: 110, displacementCcm: 1498, cylinders: 4,
    mileageKm: 98000, ownersCount: 2, lastInspectionDate: '2024-10-05', inspectionValidUntil: inDays(2), energyLabel: 'D', co2Emission: 131, consumptionCombined: 5.8,
    purchasePriceRappen: chf(12500), askingPriceRappen: chf(16900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(150),
    notes: 'Lange Standzeit. Preis bereits einmal gesenkt (von 17 900).',
  }, 2)
  await car('xc60', {
    vin: 'YV1UZA8VCM1901234', serialNumber: '912.345.678', make: 'Volvo', model: 'XC60', trim: 'B5 AWD Inscription Geartronic', modelYear: 2021,
    firstRegistrationDate: '2021-08-19', bodyType: 'suv', fuelType: 'hybrid-petrol', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'grey', bodyColorText: 'Thunder Grey', interiorColor: 'brown', interiorColorText: 'Leder Maroon Brown', doors: 5, seats: 5, powerKw: 184, displacementCcm: 1969, cylinders: 4,
    mileageKm: 61000, ownersCount: 1, lastInspectionDate: '2025-08-11', inspectionValidUntil: '2027-08-11', energyLabel: 'E', co2Emission: 172, consumptionCombined: 7.6,
    purchasePriceRappen: chf(36000), askingPriceRappen: chf(42900), vatScheme: 'standard', purchaseFrom: 'dealer', purchasedAt: daysAgo(30),
  })
  // Verkaufte — für Gewinn und Auswertungen
  await car('tiguan', {
    vin: 'WVGZZZ5NZJW012345', serialNumber: '135.792.468', make: 'Volkswagen', model: 'Tiguan', trim: '2.0 TDI 4Motion Highline DSG', modelYear: 2018,
    firstRegistrationDate: '2018-07-11', bodyType: 'suv', fuelType: 'diesel', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'blue', bodyColorText: 'Atlantic Blue', interiorColor: 'black', doors: 5, seats: 5, powerKw: 140, displacementCcm: 1968, cylinders: 4,
    mileageKm: 124000, ownersCount: 2, lastInspectionDate: '2025-07-01', inspectionValidUntil: '2027-07-01', energyLabel: 'E', co2Emission: 156, consumptionCombined: 6.0,
    purchasePriceRappen: chf(19000), askingPriceRappen: chf(24900), vatScheme: 'standard', purchaseFrom: 'trade_in', purchasedAt: daysAgo(80),
  }, 1)
  await car('tucson', {
    vin: 'TMAJ3815AMJ123456', serialNumber: '246.813.579', make: 'Hyundai', model: 'Tucson', trim: '1.6 T-GDi Hybrid Vertex 4WD', modelYear: 2021,
    firstRegistrationDate: '2021-11-03', bodyType: 'suv', fuelType: 'hybrid-petrol', transmissionType: 'automatic', driveType: 'all',
    bodyColor: 'green', bodyColorText: 'Amazon Grey', interiorColor: 'grey', doors: 5, seats: 5, powerKw: 169, displacementCcm: 1598, cylinders: 4,
    mileageKm: 44000, ownersCount: 1, energyLabel: 'C', co2Emission: 134, consumptionCombined: 5.9,
    purchasePriceRappen: chf(23000), askingPriceRappen: chf(27900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(50),
  }, 1)
  await car('fiat', {
    vin: 'ZFA3120000J234567', serialNumber: '357.924.681', make: 'Fiat', model: '500', trim: '1.2 Lounge', modelYear: 2017,
    firstRegistrationDate: '2017-05-16', bodyType: 'small-car', fuelType: 'petrol', transmissionType: 'manual', driveType: 'front',
    bodyColor: 'beige', bodyColorText: 'Avantgarde Bordeaux', interiorColor: 'beige', doors: 3, seats: 4, powerKw: 51, displacementCcm: 1242, cylinders: 4,
    mileageKm: 86000, ownersCount: 3, lastInspectionDate: '2025-04-22', inspectionValidUntil: '2027-04-22', energyLabel: 'C', co2Emission: 115, consumptionCombined: 4.9,
    purchasePriceRappen: chf(6500), askingPriceRappen: chf(9900), vatScheme: 'notional_input_tax', purchaseFrom: 'private', purchasedAt: daysAgo(90),
  }, 1)
  step(`${Object.keys(vehicles).length} Fahrzeuge mit Platzhalter-Fotos`)

  // --- Kosten (Aufbereitung, Transport, Gebühren) — direkt erfasst
  const cost = (key, kind, description, francs, ago) => addCost(tenantId, vehicles[key].id, { kind, description, amountRappen: chf(francs), incurredAt: daysAgo(ago) })
  await cost('golf', 'fee', 'Fahrzeugausweis / Einlösung', 120, 30)
  await cost('octavia', 'transport', 'Überführung Olten–Bern', 250, 58)
  await cost('octavia', 'detail', 'Aufbereitung innen und aussen', 420, 50)
  await cost('bmw', 'transport', 'Transport ab Auktion Zürich', 380, 93)
  await cost('bmw', 'part', 'Ersatz Zweitschlüssel', 310, 80)
  await cost('audi', 'detail', 'Aufbereitung, Lackpolitur', 480, 15)
  await cost('tesla', 'part', 'Ladekabel Typ 2 ersetzt', 190, 40)
  await cost('glc', 'transport', 'Überführung Olten–Bern', 250, 68)
  await cost('glc', 'detail', 'Lederpflege, Aufbereitung', 390, 60)
  await cost('leon', 'detail', 'Aufbereitung', 350, 140)
  await cost('xc60', 'detail', 'Aufbereitung, Keramikversiegelung', 650, 25)
  await cost('tiguan', 'labor', 'Service und Bremsen hinten', 890, 70)
  await cost('tiguan', 'detail', 'Aufbereitung', 400, 65)
  await cost('tucson', 'detail', 'Aufbereitung', 380, 45)
  await cost('fiat', 'labor', 'Zahnriemen und Service', 760, 85)
  step('Kosten an den Fahrzeugen')

  // --- Werkstatt: erledigte Aufträge schreiben die Kostenzeile, offene zeigen sich im Board und Kalender
  const job = (key, kind, description, estimate, dueIn) => createJob(tenantId, { vehicleId: vehicles[key].id, kind, description, estimateRappen: estimate != null ? chf(estimate) : null, dueDate: dueIn != null ? inDays(dueIn) : null })
  const golfDetail = await job('golf', 'detail', 'Aufbereitung für Verkauf', 380, -5)
  await updateJob(tenantId, golfDetail.id, { status: 'doing' })
  await updateJob(tenantId, golfDetail.id, { status: 'done', actualRappen: chf(360), doneAt: daysAgo(3) })
  const bmwDetail = await job('bmw', 'detail', 'Innenreinigung und Politur', 450, -10)
  await updateJob(tenantId, bmwDetail.id, { status: 'doing' })
  await updateJob(tenantId, bmwDetail.id, { status: 'done', actualRappen: chf(450), doneAt: daysAgo(8) })
  const bmwBrakes = await job('bmw', 'part', 'Bremsbeläge und -scheiben vorne', 650, 3)
  await updateJob(tenantId, bmwBrakes.id, { status: 'doing' })
  await job('leon', 'labor', 'Grosser Service inkl. Zahnriemen, MFK vorführen', 1200, 1)
  await job('audi', 'part', 'Sommerreifen 18 Zoll (Kunde wünscht neue)', 980, 2)
  await job('tesla', 'fee', 'MFK vorführen', 80, 50)
  const yarisPdi = await job('yaris', 'detail', 'Eingangskontrolle und Aufbereitung', 300, 4)
  await updateJob(tenantId, yarisPdi.id, { status: 'doing' })
  step('Werkstatt-Aufträge (2 erledigt, 3 in Arbeit/offen)')

  // --- Anfragen
  const lead = (fields) => createLead(tenantId, fields)
  await lead({ type: 'inquiry', name: 'Jonas Weber', email: 'jonas.weber@bluewin.ch', phone: '079 234 56 78', vehicleId: vehicles.golf.id, source: 'website', message: 'Ist der Golf noch verfügbar? Wäre am Samstag für eine Besichtigung in Bern.' })
  const nadia = await lead({ type: 'test_drive', name: 'Nadia Ferreira', email: 'n.ferreira@gmail.com', phone: '076 555 01 02', vehicleId: vehicles.tesla.id, source: 'autoscout24', message: 'Probefahrt Model 3 gewünscht, am liebsten nach 17 Uhr.' })
  await updateLead(tenantId, nadia.id, { status: 'contacted', notes: 'Rückruf erfolgt, Probefahrt morgen 14:00 vereinbart.' })
  await lead({ type: 'trade_in', name: 'Beat Zürcher', phone: '031 302 77 41', vehicleId: vehicles.octavia.id, source: 'manual', message: 'Hätte einen Octavia Combi 2016, 145 000 km zum Eintausch. Was wäre der Octavia 2020 mit Eintausch?' })
  const lea = await lead({ type: 'financing', name: 'Lea Steiner', email: 'lea.steiner@outlook.com', phone: '078 901 23 45', vehicleId: vehicles.yaris.id, source: 'website', message: 'Gibt es Leasing für den Yaris? Monatsrate wäre wichtig.' })
  await updateLead(tenantId, lea.id, { status: 'test_drive', notes: 'Leasing-Offerte der Bank angefragt (Cembra).' })
  const thomas = await lead({ type: 'inquiry', name: 'Thomas Graf', email: 'thomas.graf@gmx.ch', vehicleId: vehicles.audi.id, source: 'autoscout24', message: 'Letzter Preis für den A4?' })
  await updateLead(tenantId, thomas.id, { status: 'lost', notes: 'Hat anderswo gekauft.' })
  step('5 Anfragen (Website, AutoScout24, von Hand)')

  // --- Termine
  const appt = (fields) => createAppointment(tenantId, fields)
  await appt({ title: 'Besichtigung Audi A4 — Sarah Brunner', kind: 'viewing', onDate: inDays(1), atTime: '10:00', vehicleId: vehicles.audi.id, partyId: sarah.id })
  await appt({ title: 'Probefahrt Tesla Model 3 — Nadia Ferreira', kind: 'test_drive', onDate: inDays(1), atTime: '14:00', vehicleId: vehicles.tesla.id, note: 'Fahrausweis-Kopie mitnehmen lassen.' })
  await appt({ title: 'Übergabe Volvo XC60 — Taxi Zentrale Bern', kind: 'delivery', onDate: inDays(3), atTime: '09:30', vehicleId: vehicles.xc60.id, partyId: taxi.id })
  await appt({ title: 'Besprechung Treuhänder (MWST Q3)', kind: 'other', onDate: inDays(6), atTime: '16:00' })
  await appt({ title: 'Reifenlieferung Pneu Egger', kind: 'other', onDate: inDays(2), atTime: '08:00', vehicleId: vehicles.audi.id })
  step('5 Termine')

  // --- Belegkette
  const vehicleLine = (key, extra = []) => [
    { description: `${vehicles[key].make} ${vehicles[key].model} ${vehicles[key].trim}, Stammnummer ${vehicles[key].serialNumber}`, quantity: 1, unitPriceRappen: net(vehicles[key].askingPriceRappen) },
    ...extra,
  ]
  // Offerte für den Golf an Anna Meier (offen, 30 Tage gültig)
  await createSalesDocument(tenantId, ownerId, 'offer', {
    partyId: anna.id,
    vehicleId: vehicles.golf.id,
    lines: vehicleLine('golf', [{ description: 'Winterräder komplett 16 Zoll, montiert', quantity: 1, unitPriceRappen: net(chf(1200)) }]),
    note: 'Inkl. MFK, Service und 12 Monate Garantie ab Übergabe.',
  })
  // Auftrag → Lieferschein für den Volvo an die Taxi Zentrale (reserviert das Fahrzeug)
  const xc60Order = await createSalesDocument(tenantId, ownerId, 'order', {
    partyId: taxi.id,
    vehicleId: vehicles.xc60.id,
    lines: vehicleLine('xc60', [{ description: 'Taxameter-Vorbereitung und Dachzeichenhalter', quantity: 1, unitPriceRappen: net(chf(850)) }]),
    note: 'Übergabe nach Zahlungseingang.',
  })
  await convertSalesDocument(tenantId, ownerId, xc60Order.id, 'delivery_note')
  step('Offerte (Golf) und Auftrag → Lieferschein (Volvo, reserviert)')

  // Rechnungen — wie die Route: ausstellen, dann archivieren, wenn vollständig
  const invoice = async (fields) => {
    const created = await createInvoice(tenantId, fields)
    const archive = await archiveIfComplete(tenantId, ownerId, await withLogo(tenantId, await getInvoice(tenantId, created.id)), renderInvoicePdfBuffer)
    if (!archive.archived) console.warn(`    ! Rechnung ${created.number} nicht archiviert: ${archive.reason}`)
    return created
  }
  // Tiguan an Luca Rossi: bezahlt, mit kleiner Teilgutschrift
  const tiguanInvoice = await invoice({ partyId: luca.id, vehicleId: vehicles.tiguan.id, lines: vehicleLine('tiguan'), issueDate: daysAgo(40), dueDate: daysAgo(10) })
  await recordPayment(tenantId, { documentId: tiguanInvoice.id, amountRappen: Number(tiguanInvoice.total_rappen), paidAt: daysAgo(32) })
  await createCreditNote(tenantId, ownerId, tiguanInvoice.id, { reason: 'Nachträglicher Preisnachlass: Kratzer Heckstossstange bei Übergabe festgestellt', mode: 'partial', amountRappen: chf(500) })
  // Fiat 500 an Marco Hug: überfällig, teilbezahlt, 1. Mahnung
  const fiatInvoice = await invoice({ partyId: marco.id, vehicleId: vehicles.fiat.id, lines: vehicleLine('fiat'), issueDate: daysAgo(55), dueDate: daysAgo(25) })
  await recordPayment(tenantId, { documentId: fiatInvoice.id, amountRappen: chf(5000), paidAt: daysAgo(40) })
  const reminder = await createReminder(tenantId, { invoiceId: fiatInvoice.id, asOfDate: daysAgo(10) })
  await archiveIfComplete(tenantId, ownerId, await withLogo(tenantId, await getReminder(tenantId, reminder.id)), renderReminderPdfBuffer)
  // Zubehör-Rechnung ohne Fahrzeug an Peter Keller: offen, noch nicht fällig
  await invoice({
    partyId: peter.id,
    lines: [
      { description: 'Satz Winterreifen 205/55 R16 Continental, montiert und gewuchtet', quantity: 4, unitPriceRappen: net(chf(185)) },
      { description: 'Arbeit Radwechsel', quantity: 1, unitPriceRappen: net(chf(60)) },
    ],
    issueDate: daysAgo(5),
  })
  // Tucson von Hand als verkauft abgeschlossen (Barzahlung, Vertrag auf Papier)
  await sellVehicle(tenantId, vehicles.tucson.id, { soldPriceRappen: chf(27500), soldAt: daysAgo(12), buyerPartyId: sarah.id })
  step('3 Rechnungen (bezahlt mit Teilgutschrift, überfällig mit Mahnung, offen), 1 Verkauf von Hand')

  console.log(`
Fertig. Anmelden unter http://localhost:5173
  Betrieb (Slug):  ${slug}
  Inhaber:         ${email}
  Verkauf:         ${salesEmail}
  Werkstatt:       ${workshopEmail}
  Passwort:        (wie beim Aufruf angegeben, für alle drei)

Fotos sind generierte Platzhalter — im Fahrzeug durch echte ersetzen, wenn gewünscht.`)
} catch (err) {
  console.error('Abgebrochen:', err.message)
  if (createdTenantId) {
    // Halb angelegten Betrieb entfernen (Kaskade löscht alles daran), damit derselbe Slug gleich wieder geht.
    await admin.query('DELETE FROM tenants WHERE id = $1', [createdTenantId]).catch(() => {})
    console.error('Der halb angelegte Betrieb wurde wieder entfernt.')
  }
  process.exitCode = 1
} finally {
  await admin.end()
  await closePool()
}
