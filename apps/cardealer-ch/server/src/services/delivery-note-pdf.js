/**
 * Lieferschein / Übergabebeleg: das Fahrzeug mit seinen Kenndaten, der
 * Lieferumfang OHNE Preise (ein Lieferschein ist keine Rechnung) und zwei
 * Unterschriftenfelder für die Übergabe. Fahrzeugdaten werden beim
 * Ausstellen eingefroren — das archivierte PDF zeigt den Stand der Übergabe.
 */
import PDFDocument from 'pdfkit'
import { PAGE, letterhead, sectionBar, fieldRow, vinBoxes, needSpace, footers, contentWidth, shortDate, INK, MUTED, LINE } from '@tiff/core-docs'

const partyName = (p) => (p ? p.company_name || [p.first_name, p.last_name].filter(Boolean).join(' ') : '')
const partyAddress = (p) => (p ? [p.address_street, [p.address_zip, p.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '')
const dayText = (v) => (v ? shortDate(String(v).slice(0, 10)) : '')

function signatureLine(doc, label, x, width) {
  const y = doc.y + 40
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.6).strokeColor(LINE).stroke()
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(label, x, y + 4, { width })
}

export function renderDeliveryNotePdf(dn) {
  const doc = new PDFDocument({ size: PAGE.size, margins: PAGE.margins, bufferPages: true, info: { CreationDate: new Date(dn.created_at) } })
  const tenant = dn.tenant
  const dealer = {
    name: tenant.legal_name,
    address: [tenant.address_street, [tenant.address_zip, tenant.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    logo: dn.logoBuffer ?? undefined,
  }
  const v = dn.vehicle

  letterhead(doc, { dealer, title: 'LIEFERSCHEIN', docNo: dn.number, date: dn.issue_date })

  sectionBar(doc, 'Empfänger')
  fieldRow(doc, [
    { label: 'Kunde', value: partyName(dn.party) },
    { label: 'Adresse', value: partyAddress(dn.party) },
  ])
  if (dn.predecessor) fieldRow(doc, [{ label: 'Zu Auftrag', value: `${dn.predecessor.number} vom ${dayText(dn.predecessor.issue_date)}` }])

  if (v) {
    sectionBar(doc, 'Fahrzeug')
    vinBoxes(doc, v.vin)
    fieldRow(doc, [
      { label: 'Marke / Modell', value: [v.make, v.model, v.trim].filter(Boolean).join(' ') },
      { label: 'Stammnummer', value: v.serial_number ?? '' },
      { label: 'Typenscheinnummer', value: v.certification_number ?? '' },
    ])
    fieldRow(doc, [
      { label: 'Erstzulassung', value: dayText(v.first_registration_date) },
      { label: 'Kilometerstand', value: v.mileage_km != null ? `${Number(v.mileage_km).toLocaleString('de-CH')} km` : '' },
      { label: 'MFK gültig bis', value: dayText(v.inspection_valid_until) },
    ])
  }

  needSpace(doc, 60)
  sectionBar(doc, 'Lieferumfang')
  const left = doc.page.margins.left
  const width = contentWidth(doc)
  for (const line of dn.lines) {
    needSpace(doc, 18)
    const y = doc.y
    doc.fillColor(INK).font('Helvetica').fontSize(9)
    doc.text(line.description, left, y, { width: width * 0.85 })
    doc.text(`${Number(line.quantity)}×`, left + width * 0.85, y, { width: width * 0.15, align: 'right' })
    doc.x = left
    doc.y = Math.max(doc.y, y + 14) + 2
  }

  if (dn.note) {
    needSpace(doc, 50)
    sectionBar(doc, 'Bemerkungen')
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(dn.note, left, doc.y, { width })
  }

  needSpace(doc, 120)
  doc.y += 12
  sectionBar(doc, 'Übergabe')
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text('Empfang des Fahrzeugs und des aufgeführten Lieferumfangs bestätigt.', left, doc.y, { width })
  doc.y += 6
  const half = (width - 30) / 2
  const sigY = doc.y
  signatureLine(doc, 'Ort, Datum, Unterschrift Verkäufer', left, half)
  doc.y = sigY
  signatureLine(doc, 'Ort, Datum, Unterschrift Käufer', left + half + 30, half)

  footers(doc, { dealer, docNo: dn.number })
  return doc
}
