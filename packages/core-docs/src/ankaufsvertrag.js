/**
 * Ankaufsvertrag (Privatperson -> Händler) — vollständiger Klauseltext, ABER
 * KEIN ANWALTLICH GEPRÜFTER VERTRAG.
 *
 * Dieses Dokument ist der Beleg für den fiktiven Vorsteuerabzug (MWSTG Art. 28a,
 * SCHWEIZ-SAAS.md §4.3) und muss 10 Jahre archiviert werden (OR 958f). Wie bei
 * `kaufvertrag.js`: die Struktur und die Statutenverweise sind recherchiert,
 * aber jede Klausel mit `draftNote` markiert eine Stelle, die ein Schweizer
 * Anwalt vor dem ersten echten Ankauf noch festlegen/prüfen muss — siehe
 * LEGAL_REVIEW_STATUS dort und ANFORDERUNGEN.md §7/§10.
 */
import {
  contentWidth,
  letterhead,
  draftBanner,
  sectionBar,
  fieldRow,
  vinBoxes,
  clause,
  needSpace,
  footers,
  MUTED,
  INK,
} from './layout.js'
import { LEGAL_REVIEW_STATUS } from './kaufvertrag.js'

/**
 * @param {object} data.seller  Privatperson, die verkauft — { name, address, idDocumentType, idDocumentNumber }
 * @param {object} data.terms   { priceLabel, purchaseVatLabel, notionalInputTaxLabel }
 */
export function drawAnkaufsvertrag(doc, { dealer, seller, vehicle, terms, docNo, date }) {
  letterhead(doc, { dealer, title: 'ANKAUFSVERTRAG', docNo, date })
  draftBanner(doc, LEGAL_REVIEW_STATUS)

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
  fieldRow(doc, [{ label: 'Kaufpreis (ohne MWST-Ausweis, Privatverkauf)', value: terms.priceLabel }])
  fieldRow(doc, [{ label: 'Fiktiver Vorsteuerabzug (berechnet)', value: terms.notionalInputTaxLabel }])

  needSpace(doc, 100)
  sectionBar(doc, 'Vertragsbedingungen')

  clause(doc, {
    number: 1,
    title: 'Vertragsgegenstand',
    body:
      'Der Verkäufer verkauft dem Käufer, und der Käufer kauft vom Verkäufer, das oben ' +
      'bezeichnete Motorfahrzeug samt Fahrzeugausweis und sämtlichen Fahrzeugschlüsseln. Der ' +
      'Verkauf erfolgt als Privatverkauf ohne Mehrwertsteuerausweis.',
  })

  clause(doc, {
    number: 2,
    title: 'Kaufpreis und Zahlung',
    body:
      `Der Kaufpreis beträgt ${terms.priceLabel} und wird bei Übergabe des Fahrzeugs und der ` +
      'Fahrzeugpapiere fällig, sofern nicht schriftlich eine andere Zahlungsart vereinbart wurde.',
  })

  clause(doc, {
    number: 3,
    title: 'Erklärung des Verkäufers',
    body:
      'Der Verkäufer erklärt, alleiniger und uneingeschränkt verfügungsberechtigter Eigentümer ' +
      'des Fahrzeugs zu sein und dass das Fahrzeug frei von Rechten Dritter ist (insbesondere ' +
      'keine Eigentumsvorbehalte, Pfandrechte oder Sicherungsübereignungen). Der Verkäufer ' +
      'erklärt weiter, dass ihm bekannte Unfälle, erhebliche Vorschäden oder technische Mängel ' +
      'des Fahrzeugs dem Käufer vor Vertragsschluss vollständig und wahrheitsgetreu mitgeteilt ' +
      'wurden.',
    draftNote:
      'Umfang und Formulierung der Zusicherung (insbesondere zu Unfallfreiheit/-historie, soweit ' +
      'dem Verkäufer bekannt) sowie die Rechtsfolgen einer falschen Erklärung legt der Anwalt fest.',
  })

  clause(doc, {
    number: 4,
    title: 'Übergabe, Nutzen und Gefahr',
    body:
      'Mit der Übergabe des Fahrzeugs und der dazugehörigen Papiere an den Käufer gehen Nutzen ' +
      'und Gefahr auf diesen über (Art. 185 OR). Der Käufer bestätigt mit seiner Unterschrift, ' +
      'das Fahrzeug in dem bei der Übergabe vorgefundenen Zustand geprüft und übernommen zu haben.',
  })

  clause(doc, {
    number: 5,
    title: 'Mehrwertsteuerliche Behandlung',
    body:
      'Da der Verkäufer nicht mehrwertsteuerpflichtig ist, erfolgt der Ankauf ohne Ausweis der ' +
      'Mehrwertsteuer. Der Käufer macht, soweit die gesetzlichen Voraussetzungen erfüllt sind, ' +
      'beim Weiterverkauf des Fahrzeugs den fiktiven Vorsteuerabzug nach Art. 28a MWSTG geltend. ' +
      `Der hierfür massgebliche fiktive Vorsteuerabzug wird mit ${terms.notionalInputTaxLabel} ` +
      'ausgewiesen.',
  })

  clause(doc, {
    number: 6,
    title: 'Datenbearbeitung und Aufbewahrung',
    body:
      'Die im Zusammenhang mit diesem Vertrag erhobenen Personendaten werden ausschliesslich zur ' +
      'Vertragsabwicklung sowie zur Erfüllung gesetzlicher Aufbewahrungspflichten bearbeitet. Der ' +
      'Käufer bewahrt diesen Vertrag während zehn Jahren auf (Art. 958f OR i.V.m. GeBüV) — er ist ' +
      'zugleich Beleg für den fiktiven Vorsteuerabzug nach Art. 28a MWSTG — und behandelt ' +
      'Personendaten gemäss den Bestimmungen des Bundesgesetzes über den Datenschutz (DSG).',
  })

  clause(doc, {
    number: 7,
    title: 'Schlussbestimmungen',
    body:
      'Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform. Dieser Vertrag ' +
      'untersteht schweizerischem Recht. Sollte eine Bestimmung dieses Vertrags unwirksam sein ' +
      'oder werden, bleibt die Gültigkeit der übrigen Bestimmungen davon unberührt.',
    draftNote: 'Gerichtsstand ist vom Anwalt festzulegen.',
  })

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
