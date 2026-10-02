/**
 * Ankaufs- und Kaufvertrag als PDF — die Texte stehen in
 * packages/core-docs (ausdrücklich ENTWURF, nicht anwaltlich geprüft, siehe
 * LEGAL_REVIEW_STATUS dort). Hier werden nur Fahrzeug, Partei und Betrieb
 * eingesetzt.
 *
 * Wird bei jedem Abruf neu erzeugt, nicht archiviert: das Belegarchiv
 * (archive.js) hängt an `documents`-Zeilen, und für Verträge gibt es noch
 * keine — siehe ANFORDERUNGEN.md §7 (Ankaufsvertrag: 10 Jahre aufbewahren).
 */
import PDFDocument from 'pdfkit'
import { withTenant } from '@tiff/core-db'
import { PAGE, drawKaufvertrag, drawAnkaufsvertrag } from '@tiff/core-docs'
import { formatMoney } from '@tiff/core-billing'

const today = () => new Date().toISOString().slice(0, 10)

function partyName(p) {
  if (!p) return ''
  return p.company_name || [p.first_name, p.last_name].filter(Boolean).join(' ')
}

function partyAddress(p) {
  if (!p) return ''
  return [p.address_street, [p.address_zip, p.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

function toContractParty(p) {
  return {
    name: partyName(p),
    address: partyAddress(p),
    idDocumentType: p?.id_document_type ?? '',
    idDocumentNumber: p?.id_document_number ?? '',
  }
}

function toContractVehicle(v) {
  return {
    vin: v.vin,
    make: v.make,
    model: v.model,
    serialNumber: v.serial_number,
    firstRegistrationDate: v.first_registration_date,
    mileageKm: v.mileage_km,
    inspectionValidUntil: v.inspection_valid_until,
  }
}

async function loadContext(tenantId, vehicleId, defaultPartyColumn, partyId) {
  return withTenant(tenantId, async (client) => {
    const vehicle = (await client.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId])).rows[0]
    if (!vehicle) return null
    const tenant = (await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])).rows[0]
    const effectivePartyId = partyId ?? vehicle[defaultPartyColumn]
    const party = effectivePartyId
      ? ((await client.query('SELECT * FROM parties WHERE id = $1', [effectivePartyId])).rows[0] ?? null)
      : null
    return { vehicle, tenant, party }
  })
}

function dealerOf(tenant) {
  return {
    name: tenant.legal_name,
    address: [tenant.address_street, [tenant.address_zip, tenant.address_city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  }
}

function toBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE.size, margins: PAGE.margins, bufferPages: true })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    draw(doc)
    doc.end()
  })
}

/**
 * @param {object} options { buyerPartyId, warrantyMonths, priceRappen }
 *   Käufer und Preis kommen standardmässig aus dem Fahrzeug (buyer_party_id,
 *   sold_price_rappen bzw. Angebotspreis).
 * @returns {Promise<Buffer|null>} null, wenn das Fahrzeug nicht existiert
 */
export async function renderKaufvertrag(tenantId, vehicleId, { buyerPartyId, warrantyMonths, priceRappen } = {}) {
  const ctx = await loadContext(tenantId, vehicleId, 'buyer_party_id', buyerPartyId)
  if (!ctx) return null
  const price = priceRappen ?? ctx.vehicle.sold_price_rappen ?? ctx.vehicle.asking_price_rappen
  return toBuffer((doc) =>
    drawKaufvertrag(doc, {
      dealer: dealerOf(ctx.tenant),
      buyer: toContractParty(ctx.party),
      vehicle: toContractVehicle(ctx.vehicle),
      terms: {
        priceLabel: price == null ? '' : formatMoney(Number(price)),
        warrantyMonths: warrantyMonths ?? null,
        soldWithInspection: ctx.vehicle.sold_with_inspection,
      },
      docNo: null,
      date: ctx.vehicle.sold_at ?? today(),
    }),
  )
}

export async function renderAnkaufsvertrag(tenantId, vehicleId, { sellerPartyId } = {}) {
  const ctx = await loadContext(tenantId, vehicleId, 'seller_party_id', sellerPartyId)
  if (!ctx) return null
  const v = ctx.vehicle
  return toBuffer((doc) =>
    drawAnkaufsvertrag(doc, {
      dealer: dealerOf(ctx.tenant),
      seller: toContractParty(ctx.party),
      vehicle: toContractVehicle(v),
      terms: {
        priceLabel: v.purchase_price_rappen == null ? '' : formatMoney(Number(v.purchase_price_rappen)),
        purchaseVatLabel: formatMoney(Number(v.purchase_vat_rappen)),
        notionalInputTaxLabel: formatMoney(Number(v.notional_input_tax_rappen)),
      },
      docNo: null,
      date: v.purchased_at ?? today(),
    }),
  )
}
