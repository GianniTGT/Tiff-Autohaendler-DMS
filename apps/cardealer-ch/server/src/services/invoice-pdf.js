/**
 * Rechnungs-PDF: Layout aus @tiff/core-docs (aus lib/documents/layout.js
 * portiert), QR-Zahlteil aus @tiff/core-billing/src/qr-invoice.js.
 *
 * Ohne hinterlegte QR-IBAN entsteht die Rechnung trotzdem — nur ohne
 * Zahlteil, mit einem sichtbaren Hinweis statt eines Absturzes. Der Pilot
 * hat noch keine QR-IBAN bestellt (ANFORDERUNGEN.md §10); eine Rechnung
 * muss trotzdem gedruckt werden können, während das aussteht.
 */
import PDFDocument from 'pdfkit'
import { PAGE, letterhead, sectionBar, fieldRow, needSpace, footers, contentWidth, INK, MUTED, LINE } from '@tiff/core-docs'
import { formatMoney } from '@tiff/core-billing'
import { buildQrBill } from '@tiff/core-billing/src/qr-invoice.js'

/**
 * `swissqrbill` verlangt vollständige Adressfelder und stürzt sonst intern
 * ab (`Object.entries(null)` in dessen Cleaner) statt einen Fehler zu
 * werfen — Postgres liefert eine fehlende Spalte als `null`, nicht
 * `undefined`, und genau das hat das ausgelöst (gefunden beim ersten Test
 * mit einer Partei ohne hinterlegte Adresse). Deshalb hier vorher prüfen
 * und einen Hinweis drucken statt eines 500ers.
 */
function describeMissingQrBillData(tenant, party) {
  if (!tenant.qr_iban) {
    return 'Für diesen Mandanten ist noch keine QR-IBAN hinterlegt. Siehe ANFORDERUNGEN.md §10 — QR-IBAN bei der Bank bestellen.'
  }
  if (!tenant.address_street || !tenant.address_zip || !tenant.address_city) {
    return 'Die Adresse des Betriebs ist unvollständig hinterlegt (Einstellungen ergänzen).'
  }
  if (!party || !party.address_street || !party.address_zip || !party.address_city) {
    return 'Die Adresse der Kundschaft ist unvollständig hinterlegt.'
  }
  return null
}

function partyName(party) {
  if (!party) return ''
  return party.company_name || [party.first_name, party.last_name].filter(Boolean).join(' ')
}

function partyAddress(party) {
  if (!party) return ''
  return [party.address_street, [party.address_zip, party.address_city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
}

function drawLineItems(doc, lines) {
  const left = doc.page.margins.left
  const width = contentWidth(doc)
  const cols = { desc: width * 0.5, qty: width * 0.12, price: width * 0.19, total: width * 0.19 }

  needSpace(doc, 20)
  const headerY = doc.y
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7)
  doc.text('BESCHREIBUNG', left, headerY, { width: cols.desc })
  doc.text('MENGE', left + cols.desc, headerY, { width: cols.qty, align: 'right' })
  doc.text('PREIS', left + cols.desc + cols.qty, headerY, { width: cols.price, align: 'right' })
  doc.text('TOTAL', left + cols.desc + cols.qty + cols.price, headerY, { width: cols.total, align: 'right' })
  doc.x = left
  doc.y = headerY + 12
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(LINE).stroke()
  doc.y += 6

  for (const line of lines) {
    needSpace(doc, 18)
    const y = doc.y
    doc.fillColor(INK).font('Helvetica').fontSize(9)
    doc.text(line.description, left, y, { width: cols.desc })
    doc.text(String(line.quantity), left + cols.desc, y, { width: cols.qty, align: 'right' })
    doc.text(formatMoney(line.unit_price_rappen), left + cols.desc + cols.qty, y, { width: cols.price, align: 'right' })
    doc.text(formatMoney(line.line_total_rappen), left + cols.desc + cols.qty + cols.price, y, {
      width: cols.total,
      align: 'right',
    })
    doc.x = left
    doc.y = y + 16
  }
}

/**
 * @returns {PDFDocument} noch nicht `.end()`-et — der Aufrufer pipet und beendet.
 *
 * `info.CreationDate` wird bewusst auf `created_at` des Belegs fest gesetzt,
 * nicht dem pdfkit-Default (der aktuelle Zeitpunkt): ohne das würde jede
 * erneute Erzeugung derselben Rechnung ein anderes PDF ergeben, obwohl
 * inhaltlich nichts sich geändert hat — und der Hash aus archive.js
 * (Belegarchiv, ANFORDERUNGEN.md §9) wäre bei jedem Abruf ein anderer,
 * obwohl das Dokument "dasselbe" bleiben soll.
 */
export function renderInvoicePdf(invoice) {
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: PAGE.margins,
    bufferPages: true,
    info: { CreationDate: new Date(invoice.created_at) },
  })
  const tenant = invoice.tenant
  const dealer = {
    name: tenant.legal_name,
    address: [tenant.address_street, [tenant.address_zip, tenant.address_city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  }

  letterhead(doc, { dealer, title: 'RECHNUNG', docNo: invoice.number, date: invoice.issue_date })

  sectionBar(doc, 'Rechnungsadresse')
  fieldRow(doc, [
    { label: 'Kunde', value: partyName(invoice.party) },
    { label: 'Adresse', value: partyAddress(invoice.party) },
  ])
  if (tenant.uid) {
    fieldRow(doc, [{ label: 'UID', value: tenant.uid }])
  }

  sectionBar(doc, 'Positionen')
  drawLineItems(doc, invoice.lines)

  needSpace(doc, 70)
  doc.y += 10
  sectionBar(doc, 'Total')
  fieldRow(doc, [
    { label: 'Zwischensumme (exkl. MWST)', value: formatMoney(invoice.subtotal_rappen) },
    { label: 'MWST', value: formatMoney(invoice.vat_rappen) },
    { label: 'Total (inkl. MWST)', value: formatMoney(invoice.total_rappen) },
  ])

  footers(doc, { dealer, docNo: invoice.number })

  const missingQrBillReason = describeMissingQrBillData(tenant, invoice.party)

  if (!missingQrBillReason) {
    const qrBill = buildQrBill(
      {
        legalName: tenant.legal_name,
        addressStreet: tenant.address_street,
        addressZip: tenant.address_zip,
        addressCity: tenant.address_city,
        qrIban: tenant.qr_iban,
      },
      {
        name: partyName(invoice.party) || '—',
        addressStreet: invoice.party.address_street,
        addressZip: invoice.party.address_zip,
        addressCity: invoice.party.address_city,
      },
      { totalRappen: invoice.total_rappen, reference: invoice.qr_reference },
    )
    qrBill.attachTo(doc)
  } else {
    doc.addPage()
    doc
      .fillColor(MUTED)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text(
        `Kein QR-Zahlteil: ${missingQrBillReason} Die Rechnung ist gültig, muss aber vorerst anders bezahlt werden.`,
        doc.page.margins.left,
        doc.page.margins.top,
        { width: contentWidth(doc) },
      )
  }

  return doc
}

/** Wie renderInvoicePdf(), aber fertig eingesammelt — für Hash/Archiv, wo die volle Länge vorher feststehen muss. */
export function renderInvoicePdfBuffer(invoice) {
  return new Promise((resolve, reject) => {
    const doc = renderInvoicePdf(invoice)
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}
