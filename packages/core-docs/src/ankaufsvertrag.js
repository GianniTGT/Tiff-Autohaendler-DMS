/**
 * Ankaufsvertrag (Privatperson -> Händler) — Gerüst, KEIN geprüfter Vertragstext.
 *
 * Dieses Dokument ist der Beleg für den fiktiven Vorsteuerabzug (MWSTG Art. 28a,
 * SCHWEIZ-SAAS.md §4.3) und muss 10 Jahre archiviert werden (OR 958f). Wie bei
 * `kaufvertrag.js`: Struktur steht, Rechtstext fehlt — siehe LEGAL_REVIEW_STATUS
 * dort und ANFORDERUNGEN.md §7/§10.
 */
import { PAGE, contentWidth, letterhead, sectionBar, fieldRow, vinBoxes, needSpace, footers, MUTED, INK } from './layout.js'
import { LEGAL_REVIEW_STATUS } from './kaufvertrag.js'

/**
 * @param {object} data.seller  Privatperson, die verkauft — { name, address, idDocumentType, idDocumentNumber }
 * @param {object} data.terms   { priceLabel, purchaseVatLabel, notionalInputTaxLabel }
 */
export function drawAnkaufsvertrag(doc, { dealer, seller, vehicle, terms, docNo, date }) {
  letterhead(doc, { dealer, title: 'ANKAUFSVERTRAG', docNo, date })

  sectionBar(doc, 'Vertragsparteien')
  fieldRow(doc, [
    { label: 'Käufer', value: dealer.name },
    { label: 'Verkäufer (Privatperson)', value: seller.name },
  ])
  fieldRow(doc, [
    { label: 'Adresse Verkäufer', value: seller.address },
    { label: 'Ausweis Verkäufer', value: `${seller.idDocumentType ?? ''} ${seller.idDocumentNumber ?? ''}`.trim() },
  ])

  sectionBar(doc, 'Fahrzeug')
  vinBoxes(doc, vehicle.vin)
  fieldRow(doc, [
    { label: 'Marke / Modell', value: [vehicle.make, vehicle.model].filter(Boolean).join(' ') },
    { label: 'Stammnummer', value: vehicle.serialNumber },
    { label: 'Kilometerstand', value: vehicle.mileageKm != null ? `${vehicle.mileageKm} km` : '' },
  ])

  sectionBar(doc, 'Kaufpreis und MWST')
  fieldRow(doc, [{ label: 'Kaufpreis (ohne MWST-Ausweis, Privatverkauf)', value: terms.priceLabel }])
  fieldRow(doc, [
    { label: 'Fiktiver Vorsteuerabzug (berechnet)', value: terms.notionalInputTaxLabel },
  ])

  needSpace(doc, 120)
  sectionBar(doc, 'Erklärung des Verkäufers')
  doc
    .fillColor(MUTED)
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text(
      `[${LEGAL_REVIEW_STATUS}] Platzhalter — Erklärung (Eigentum, keine Belastung Dritter, ` +
        'Unfallfreiheit/-historie soweit bekannt) von einem Schweizer Anwalt formulieren lassen.',
      doc.x,
      doc.y,
      { width: contentWidth(doc) },
    )

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
    .text('Käufer, Ort/Datum', doc.page.margins.left, y + 4, { width: w })
    .text('Verkäufer, Ort/Datum', doc.page.margins.left + w + 24, y + 4, { width: w })

  footers(doc, { dealer, docNo })
}

export const PDF_OPTIONS = { size: PAGE.size, margins: PAGE.margins, bufferPages: true }
