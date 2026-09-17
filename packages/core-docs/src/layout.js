/**
 * Das visuelle Grundgerüst, das sich jedes gedruckte Dokument teilt: Briefkopf,
 * Abschnittsbalken, linierte Felder, VIN-Boxen, Fusszeile.
 *
 * Portiert aus `lib/documents/layout.js` in Tiff-Cardealer-Manager (US) —
 * reines Layout ohne US-Rechtsinhalt, deshalb wörtlich übernehmbar
 * (ANFORDERUNGEN.md §2). Angepasst: A4 statt US-Letter, Datumsformat
 * TT.MM.JJJJ statt "Month D, YYYY", Farbe konfigurierbar statt fest auf einen
 * Marken-Navyton (verschiedene Mandanten, verschiedene Farben).
 *
 * ── DIE VIER pdfkit-FALLEN, BEZAHLT IM US-PROJEKT AM 16. AUGUST ────────────
 *
 * 1. `doc.text()` verschiebt `doc.y` UND merkt sich `doc.x`. Wer `doc.y`
 *    innerhalb einer Schleife liest, die eine Zeile aus Feldern layoutet,
 *    zeichnet eine Treppe — jedes Feld einen Schritt tiefer und weiter
 *    rechts als das letzte. Darum wird `y` einmal vor der Schleife erfasst
 *    (siehe `fieldRow`, `vinBoxes`).
 * 2. Ein positioniertes `doc.text(s, x, y)` lässt `doc.x` auf diesem `x`
 *    stehen, und jeder spätere Aufruf erbt es. `doc.x` nach positioniertem
 *    Text zurücksetzen.
 * 3. Schreiben in den unteren Rand fügt eine Seite hinzu — und die neue
 *    Seite braucht wieder eine Fusszeile, was eine weitere Seite hinzufügt.
 *    `footers()` hebt `margins.bottom` für den Aufruf auf 0 und berechnet
 *    `y` VOR dieser Nullung.
 * 4. pdfkit paginiert nur zwischen Aufrufen, nie innerhalb eines Aufrufs —
 *    ein spaltenweise gezeichneter Block kann mittendurch umbrechen.
 *    `needSpace()` vorher aufrufen für alles, was als Einheit gehört.
 */

import fs from 'node:fs'

export const INK = '#111827'
export const MUTED = '#6B7280'
export const LINE = '#9CA3AF'
export const BAR = '#E8EDF9'

export const PAGE = {
  size: 'A4',
  margins: { top: 46, bottom: 46, left: 46, right: 46 },
}

export const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right

/** `2026-08-07` -> `07.08.2026`, wie es auf dem Papier steht (de-CH). */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '')
  const [, y, mo, d] = m
  return `${d}.${mo}.${y}`
}

/** Falle 4: neue Seite, wenn `height` auf der aktuellen nicht mehr passt. */
export function needSpace(doc, height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
}

/** Ein gefüllter Balken mit Kapitälchen — trennt einen Abschnitt vom nächsten. */
export function sectionBar(doc, label, { color = NAVY_DEFAULT } = {}) {
  needSpace(doc, 40)
  const left = doc.page.margins.left
  const w = contentWidth(doc)
  doc.rect(left, doc.y, w, 16).fill(BAR)
  doc
    .fillColor(color)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(label.toUpperCase(), left + 8, doc.y + 4.5, { width: w - 16, characterSpacing: 0.6 })
  doc.x = left
  doc.y += 18
}

export const NAVY_DEFAULT = '#08328B'

/**
 * Ein liniertes Formularfeld: kleine graue Beschriftung über einem Wert auf
 * einer Linie. Gibt die genutzte Höhe zurück, damit eine Zeile so hoch sein
 * kann wie ihr höchstes Feld.
 */
export function formField(doc, { label, value, x, y, width }) {
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(6.5)
    .text(String(label).toUpperCase(), x, y, { width, characterSpacing: 0.4 })

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5)
  const text = String(value ?? '').trim() || ' '
  const height = doc.heightOfString(text, { width })
  doc.text(text, x, y + 9, { width })

  const lineY = y + 9 + height + 2.5
  doc.moveTo(x, lineY).lineTo(x + width, lineY).lineWidth(0.6).strokeColor(LINE).stroke()
  return lineY - y + 5
}

/** Eine Zeile linierter Felder, gleichmässig verteilt. */
export function fieldRow(doc, fields) {
  const left = doc.page.margins.left
  const gap = 16
  const width = (contentWidth(doc) - gap * (fields.length - 1)) / fields.length
  const y = doc.y // Falle 1: einmal erfasst
  let used = 0

  fields.forEach((f, i) => {
    used = Math.max(used, formField(doc, { ...f, x: left + i * (width + gap), y, width }))
  })

  doc.x = left
  doc.y = y + used
}

/** Die VIN, ein Zeichen pro Box. */
export function vinBoxes(doc, vin, label = 'FAHRGESTELLNUMMER (VIN)') {
  const chars = String(vin ?? '').toUpperCase().split('')
  if (!chars.length) return

  const left = doc.page.margins.left
  doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text(label, left, doc.y, { characterSpacing: 0.4 })
  doc.y += 9

  const box = 18
  const gap = 3
  const y = doc.y
  chars.forEach((ch, i) => {
    const x = left + i * (box + gap)
    doc.rect(x, y, box, box).lineWidth(0.6).strokeColor(LINE).stroke()
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(ch, x, y + 4.5, { width: box, align: 'center' })
  })

  doc.x = left
  doc.y = y + box + 10
}

export const HEADER_GUTTER = 18

/** Die grösste Schriftgrösse, bei der `title` einzeilig in `width` passt. */
export function fitTitleSize(doc, title, width, { max = 19, min = 13 } = {}) {
  const saved = doc._fontSize
  let size = max
  doc.font('Helvetica-Bold')
  while (size > min) {
    doc.fontSize(size)
    if (doc.widthOfString(String(title ?? '')) <= width) break
    size -= 0.5
  }
  doc.fontSize(saved)
  return size
}

/**
 * Der Briefkopf: der Betrieb links, der Dokumenttitel rechts. `dealer.color`
 * ersetzt die feste US-Navyfarbe — jeder Mandant kann seine eigene Farbe
 * hinterlegen, statt dass sie im Layout-Modul fest steht.
 */
export function letterhead(doc, { dealer, title, docNo, date, onLogoError }) {
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const top = doc.y
  let textLeft = left
  const color = dealer.color || NAVY_DEFAULT

  if (dealer.logoPath && fs.existsSync(dealer.logoPath)) {
    try {
      doc.image(dealer.logoPath, left, top, { fit: [58, 44] })
      textLeft += 70
    } catch (err) {
      onLogoError?.(err)
    }
  }

  const usable = right - textLeft - HEADER_GUTTER
  const dealerWidth = Math.floor(usable * 0.4)
  const titleLeft = textLeft + dealerWidth + HEADER_GUTTER
  const titleWidth = right - titleLeft

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(12.5)
    .text(String(dealer.name ?? '').toUpperCase(), textLeft, top, { width: dealerWidth })
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
  if (dealer.address) doc.text(dealer.address, textLeft, doc.y + 1, { width: dealerWidth })
  const phones = [dealer.phone, dealer.phoneAlt].filter(Boolean).join('   ·   ')
  if (phones) doc.text(phones, textLeft, doc.y + 1, { width: dealerWidth })
  const dealerBottom = doc.y

  doc
    .fillColor(color)
    .font('Helvetica-Bold')
    .fontSize(fitTitleSize(doc, title, titleWidth))
    .text(title, titleLeft, top, { width: titleWidth, align: 'right' })
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(`${docNo ? `Dokument-Nr. ${docNo}   ·   ` : ''}${shortDate(date)}`, titleLeft, doc.y + 3, {
      width: titleWidth,
      align: 'right',
    })

  doc.x = left // Falle 2
  doc.y = Math.max(dealerBottom, doc.y, top + 44) + 7
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1.6).strokeColor(color).stroke()
  doc.y += 12
}

/** Zuletzt geschrieben, weil "von N" erst nach dem letzten Abschnitt feststeht. Falle 3. */
export function footers(doc, { dealer, docNo, product = 'Tiff Autohändler DMS' }) {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottom = doc.page.margins.bottom
    const y = doc.page.height - bottom + 12
    doc.page.margins.bottom = 0
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7)
      .text(
        [dealer.name, docNo, product && `Erstellt mit ${product}`, `Seite ${i - range.start + 1} von ${range.count}`]
          .filter(Boolean)
          .join('   ·   '),
        doc.page.margins.left,
        y,
        { width: contentWidth(doc), align: 'center', lineBreak: false },
      )
    doc.page.margins.bottom = bottom
  }
  doc.flushPages()
}
