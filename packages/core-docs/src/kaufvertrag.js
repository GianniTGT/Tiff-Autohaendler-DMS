/**
 * Kaufvertrag (Händler -> Kunde) — Gerüst, KEIN geprüfter Vertragstext.
 *
 * Anders als beim US-Repo (`lib/documents/billOfSale.js`, das direkt 16 CFR
 * 455 zitiert) gibt es hier kein Vorbild: die Schweiz braucht ein eigenes
 * Dokument nach AGVS/UPSA-Muster. Genau wie das US-Projekt für seinen Bill of
 * Sale festhielt ("a lawyer, not Claude", CLAUDE.md §17 dort), gilt hier
 * dieselbe Disziplin: die Klauseln unten sind **Platzhalter für die Struktur**,
 * kein rechtsgültiger Text. Vor dem ersten echten Vertrag muss ein Schweizer
 * Anwalt den Wortlaut prüfen (ANFORDERUNGEN.md §7/§10).
 *
 * Was bereits feststeht (aus SCHWEIZ-SAAS.md §4.6, nachzuprüfen):
 *  - Gewährleistung OR Art. 197 ff., Regelfrist 2 Jahre, bei Occasion
 *    verkürzbar, aber im Verkauf an Konsumenten ist 1 Jahr die Untergrenze
 *    und ein vollständiger Ausschluss unwirksam (OR 210 Abs. 4)
 *  - "ab MFK" ist eine Vertragszusage, keine Beschreibung
 *  - Aufbewahrung 10 Jahre (OR 958f, GeBüV)
 */
import {
  PAGE,
  contentWidth,
  letterhead,
  sectionBar,
  fieldRow,
  vinBoxes,
  needSpace,
  footers,
  MUTED,
  INK,
} from './layout.js'

export const LEGAL_REVIEW_STATUS = 'ENTWURF — NICHT VON EINEM ANWALT GEPRÜFT'

/**
 * @param {PDFKit.PDFDocument} doc  bereits geöffnetes pdfkit-Dokument
 * @param {object} data
 * @param {object} data.dealer   { name, address, phone, logoPath, color }
 * @param {object} data.buyer    { name, address, idDocumentType, idDocumentNumber }
 * @param {object} data.vehicle  CH-Fahrzeugfelder, siehe core-db-Migration
 * @param {object} data.terms    { priceRappen, warrantyMonths, soldWithInspection }
 * @param {string} data.docNo
 * @param {string} data.date     ISO-Datum
 */
export function drawKaufvertrag(doc, { dealer, buyer, vehicle, terms, docNo, date }) {
  letterhead(doc, { dealer, title: 'KAUFVERTRAG', docNo, date })

  sectionBar(doc, 'Vertragsparteien')
  fieldRow(doc, [
    { label: 'Verkäufer', value: dealer.name },
    { label: 'Käufer', value: buyer.name },
  ])
  fieldRow(doc, [
    { label: 'Adresse Käufer', value: buyer.address },
    { label: 'Ausweis Käufer', value: `${buyer.idDocumentType ?? ''} ${buyer.idDocumentNumber ?? ''}`.trim() },
  ])

  sectionBar(doc, 'Fahrzeug')
  vinBoxes(doc, vehicle.vin)
  fieldRow(doc, [
    { label: 'Marke / Modell', value: [vehicle.make, vehicle.model].filter(Boolean).join(' ') },
    { label: 'Stammnummer', value: vehicle.serialNumber },
    { label: 'Erstzulassung', value: vehicle.firstRegistrationDate },
  ])
  fieldRow(doc, [
    { label: 'Kilometerstand', value: vehicle.mileageKm != null ? `${vehicle.mileageKm} km` : '' },
    { label: 'MFK gültig bis', value: vehicle.inspectionValidUntil },
    { label: 'Verkauf ab MFK', value: terms.soldWithInspection ? 'Ja' : 'Nein' },
  ])

  sectionBar(doc, 'Kaufpreis')
  fieldRow(doc, [{ label: 'Kaufpreis (inkl. MWST sofern anwendbar)', value: terms.priceLabel }])

  needSpace(doc, 160)
  sectionBar(doc, 'Gewährleistung')
  doc
    .fillColor(MUTED)
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text(
      `[${LEGAL_REVIEW_STATUS}] Platzhalter — Gewährleistungsklausel nach OR Art. 197 ff. bzw. ` +
        'OR 210 Abs. 4 (Konsumentenschutz-Untergrenze 1 Jahr, kein vollständiger Ausschluss) ' +
        'von einem Schweizer Anwalt einsetzen lassen, bevor dieser Vertrag verwendet wird.',
      doc.x,
      doc.y,
      { width: contentWidth(doc) },
    )
  doc.y += 8
  fieldRow(doc, [{ label: 'Gewährleistungsfrist (Monate)', value: String(terms.warrantyMonths ?? '') }])

  needSpace(doc, 90)
  sectionBar(doc, 'Unterschriften')
  const y = doc.y + 40
  const w = (contentWidth(doc) - 24) / 2
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + w, y).strokeColor(MUTED).stroke()
  doc
    .moveTo(doc.page.margins.left + w + 24, y)
    .lineTo(doc.page.margins.left + w + 24 + w, y)
    .strokeColor(MUTED)
    .stroke()
  doc
    .fillColor(INK)
    .font('Helvetica')
    .fontSize(8)
    .text('Verkäufer, Ort/Datum', doc.page.margins.left, y + 4, { width: w })
    .text('Käufer, Ort/Datum', doc.page.margins.left + w + 24, y + 4, { width: w })

  footers(doc, { dealer, docNo })
}

export const PDF_OPTIONS = { size: PAGE.size, margins: PAGE.margins, bufferPages: true }
