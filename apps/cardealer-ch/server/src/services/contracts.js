/**
 * Ankaufs- und Kaufvertrag als PDF — die Texte stehen in packages/core-docs
 * (ausdrücklich ENTWURF, nicht anwaltlich geprüft, siehe LEGAL_REVIEW_STATUS
 * dort). Hier werden nur Fahrzeug, Partei und Betrieb eingesetzt.
 *
 * Zwei Wege:
 *  - **Vorschau** (renderKaufvertrag/renderAnkaufsvertrag): wird bei jedem
 *    Abruf neu erzeugt, hat keine Nummer und wird nicht aufbewahrt.
 *  - **Ausstellen** (issueContract): vergibt eine Nummer (KV-/AV-JJJJ-NNNNN),
 *    legt einen `documents`-Eintrag an und archiviert das PDF mit SHA-256 im
 *    Objektspeicher (archive.js) — ab dann ist es der Beleg, der nicht mehr
 *    verändert wird. Der Ankaufsvertrag begründet den fiktiven
 *    Vorsteuerabzug und ist 10 Jahre aufzubewahren (OR 958f, GeBüV).
 */
import PDFDocument from 'pdfkit'
import { withTenant } from '@tiff/core-db'
import { PAGE, drawKaufvertrag, drawAnkaufsvertrag } from '@tiff/core-docs'
import { formatMoney } from '@tiff/core-billing'
import { nextDocumentNumber } from './invoices.js'
import { archivePdf } from './archive.js'
import { loadLogoBuffer } from './tenant-logo.js'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  const ctx = await withTenant(tenantId, async (client) => {
    const vehicle = (await client.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId])).rows[0]
    if (!vehicle) return null
    const tenant = (await client.query('SELECT * FROM tenants WHERE id = $1', [tenantId])).rows[0]
    const effectivePartyId = partyId ?? vehicle[defaultPartyColumn]
    const party = effectivePartyId
      ? ((await client.query('SELECT * FROM parties WHERE id = $1', [effectivePartyId])).rows[0] ?? null)
      : null
    return { vehicle, tenant, party }
  })
  if (ctx) ctx.logo = await loadLogoBuffer(tenantId)
  return ctx
}

function dealerOf(tenant, logo) {
  return {
    name: tenant.legal_name,
    address: [tenant.address_street, [tenant.address_zip, tenant.address_city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    logo: logo ?? undefined,
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

function saleTerms(ctx, { priceRappen, warrantyMonths }) {
  const price = priceRappen ?? ctx.vehicle.sold_price_rappen ?? ctx.vehicle.asking_price_rappen
  return {
    price,
    terms: {
      priceLabel: price == null ? '' : formatMoney(Number(price)),
      warrantyMonths: warrantyMonths ?? null,
      soldWithInspection: ctx.vehicle.sold_with_inspection,
    },
  }
}

function drawSale(ctx, options, { docNo = null, date } = {}) {
  return toBuffer((doc) =>
    drawKaufvertrag(doc, {
      dealer: dealerOf(ctx.tenant, ctx.logo),
      buyer: toContractParty(ctx.party),
      vehicle: toContractVehicle(ctx.vehicle),
      terms: saleTerms(ctx, options).terms,
      docNo,
      date: date ?? ctx.vehicle.sold_at ?? today(),
    }),
  )
}

function drawPurchase(ctx, { docNo = null, date } = {}) {
  const v = ctx.vehicle
  return toBuffer((doc) =>
    drawAnkaufsvertrag(doc, {
      dealer: dealerOf(ctx.tenant, ctx.logo),
      seller: toContractParty(ctx.party),
      vehicle: toContractVehicle(v),
      terms: {
        priceLabel: v.purchase_price_rappen == null ? '' : formatMoney(Number(v.purchase_price_rappen)),
        purchaseVatLabel: formatMoney(Number(v.purchase_vat_rappen)),
        notionalInputTaxLabel: formatMoney(Number(v.notional_input_tax_rappen)),
      },
      docNo,
      date: date ?? v.purchased_at ?? today(),
    }),
  )
}

/** Vorschau ohne Nummer. @returns {Promise<Buffer|null>} null, wenn das Fahrzeug nicht existiert */
export async function renderKaufvertrag(tenantId, vehicleId, { buyerPartyId, warrantyMonths, priceRappen } = {}) {
  const ctx = await loadContext(tenantId, vehicleId, 'buyer_party_id', buyerPartyId)
  return ctx ? drawSale(ctx, { warrantyMonths, priceRappen }) : null
}

export async function renderAnkaufsvertrag(tenantId, vehicleId, { sellerPartyId } = {}) {
  const ctx = await loadContext(tenantId, vehicleId, 'seller_party_id', sellerPartyId)
  return ctx ? drawPurchase(ctx) : null
}

export const CONTRACT_TYPES = Object.freeze({ sale: 'sale_contract', purchase: 'purchase_contract' })

/**
 * Stellt einen Vertrag aus: Nummer vergeben, PDF erzeugen, archivieren.
 *
 * Ein Vertrag ohne Vertragspartei oder ohne Preis ist kein Beleg, sondern ein
 * leeres Formular — der wird hier abgelehnt, bevor eine Nummer verbraucht
 * ist. Scheitert erst das Archivieren, wird der Eintrag wieder entfernt;
 * dabei bleibt eine Nummer ungenutzt (Lücke), was bei Verträgen (anders als
 * bei Rechnungen) kein Problem ist.
 *
 * @param {'sale'|'purchase'} kind
 * @returns {Promise<object|null>} der documents-Eintrag, oder null, wenn das Fahrzeug fehlt
 */
export async function issueContract(tenantId, userId, vehicleId, kind, { partyId, warrantyMonths, priceRappen } = {}) {
  const type = CONTRACT_TYPES[kind]
  if (!type) throw new Error('Unbekannte Vertragsart.')

  const ctx = await loadContext(tenantId, vehicleId, kind === 'sale' ? 'buyer_party_id' : 'seller_party_id', partyId)
  if (!ctx) return null
  const partyLabel = kind === 'sale' ? 'Käufer' : 'Verkäufer'
  if (!ctx.party || !partyName(ctx.party).trim()) throw new Error(`Bitte zuerst einen ${partyLabel} wählen.`)
  if (!ctx.tenant.legal_name) throw new Error('Die Firma des Betriebs fehlt (Einstellungen).')

  const price = kind === 'sale' ? saleTerms(ctx, { priceRappen }).price : ctx.vehicle.purchase_price_rappen
  if (price == null || Number(price) <= 0) {
    throw new Error(kind === 'sale' ? 'Das Fahrzeug hat noch keinen Preis.' : 'Das Fahrzeug hat noch keinen Einkaufspreis.')
  }

  const issueDate = today()
  const document = await withTenant(tenantId, async (client) => {
    const { number } = await nextDocumentNumber(client, tenantId, type, Number(issueDate.slice(0, 4)))
    const row = (
      await client.query(
        `INSERT INTO documents (id, tenant_id, party_id, type, number, status, issue_date, vehicle_id, total_rappen)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'issued', $5, $6, $7) RETURNING *`,
        [tenantId, ctx.party.id, type, number, issueDate, vehicleId, price],
      )
    ).rows[0]
    return row
  })

  try {
    const pdf =
      kind === 'sale'
        ? await drawSale(ctx, { warrantyMonths, priceRappen }, { docNo: document.number, date: issueDate })
        : await drawPurchase(ctx, { docNo: document.number, date: issueDate })
    await archivePdf(tenantId, { documentId: document.id, userId, pdfBuffer: pdf })
  } catch (err) {
    await withTenant(tenantId, (client) => client.query('DELETE FROM documents WHERE id = $1', [document.id]))
    throw err
  }
  return (await listContracts(tenantId, vehicleId)).find((c) => c.id === document.id)
}

export async function listContracts(tenantId, vehicleId) {
  return withTenant(tenantId, async (client) => {
    const rows = (
      await client.query(
        `SELECT d.id, d.type, d.number, d.issue_date, d.total_rappen, d.pdf_hash,
                COALESCE(p.company_name, NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')) AS party_name
           FROM documents d LEFT JOIN parties p ON p.id = d.party_id
          WHERE d.vehicle_id = $1 AND d.type IN ('sale_contract', 'purchase_contract')
          ORDER BY d.created_at DESC`,
        [vehicleId],
      )
    ).rows
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      number: r.number,
      issueDate: r.issue_date,
      totalRappen: Number(r.total_rappen),
      partyName: r.party_name,
      hash: r.pdf_hash,
    }))
  })
}
