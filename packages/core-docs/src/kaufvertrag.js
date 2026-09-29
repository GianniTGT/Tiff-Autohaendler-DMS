/**
 * Kaufvertrag (Händler -> Kunde) — vollständiger Klauseltext, ABER KEIN
 * ANWALTLICH GEPRÜFTER VERTRAG.
 *
 * Anders als beim US-Repo (`lib/documents/billOfSale.js`, das direkt 16 CFR
 * 455 zitiert) gibt es hier kein Vorbild: die Schweiz braucht ein eigenes
 * Dokument nach AGVS/UPSA-Muster. Genau wie das US-Projekt für seinen Bill of
 * Sale festhielt ("a lawyer, not Claude", CLAUDE.md §17 dort), gilt hier
 * dieselbe Disziplin: der Text unten ist ein **fundierter Entwurf** (Struktur
 * und Statutenverweise sind recherchiert), kein rechtsgültiger Vertrag. Jede
 * Klausel mit einem `draftNote` markiert eine Stelle, die ein Schweizer
 * Anwalt vor dem ersten echten Vertrag noch festlegen/prüfen muss
 * (ANFORDERUNGEN.md §7/§10) — der Rest ist tragfähiges Boilerplate auf Basis
 * der unten zitierten OR-Bestimmungen, aber auch das ohne anwaltliche
 * Freigabe nicht für einen echten Verkauf verwenden.
 *
 * Was bereits feststeht (aus SCHWEIZ-SAAS.md §4.6, nachzuprüfen):
 *  - Gewährleistung OR Art. 197 ff., Regelfrist 2 Jahre, bei Occasion
 *    verkürzbar, aber im Verkauf an Konsumenten ist 1 Jahr die Untergrenze
 *    und ein vollständiger Ausschluss unwirksam (OR 210 Abs. 4)
 *  - "ab MFK" ist eine Vertragszusage, keine Beschreibung
 *  - Aufbewahrung 10 Jahre (OR 958f, GeBüV)
 *  - Ein Eigentumsvorbehalt wirkt gegenüber Dritten erst mit Eintrag im
 *    Eigentumsvorbehaltsregister am Wohnort des Käufers (Art. 715 ZGB) — im
 *    Vertragstext allein entfaltet die Klausel diese Wirkung nicht
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

export const LEGAL_REVIEW_STATUS = 'ENTWURF — NICHT VON EINEM ANWALT GEPRÜFT'

/**
 * @param {PDFKit.PDFDocument} doc  bereits geöffnetes pdfkit-Dokument
 * @param {object} data
 * @param {object} data.dealer   { name, address, phone, logoPath, color }
 * @param {object} data.buyer    { name, address, idDocumentType, idDocumentNumber }
 * @param {object} data.vehicle  CH-Fahrzeugfelder, siehe core-db-Migration
 * @param {object} data.terms    { priceLabel, warrantyMonths, soldWithInspection }
 * @param {string} data.docNo
 * @param {string} data.date     ISO-Datum
 */
export function drawKaufvertrag(doc, { dealer, buyer, vehicle, terms, docNo, date }) {
  letterhead(doc, { dealer, title: 'KAUFVERTRAG', docNo, date })
  draftBanner(doc, LEGAL_REVIEW_STATUS)

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
  fieldRow(doc, [{ label: 'Kaufpreis (inkl. MWST sofern anwendbar)', value: terms.priceLabel }])

  needSpace(doc, 100)
  sectionBar(doc, 'Vertragsbedingungen')

  clause(doc, {
    number: 1,
    title: 'Vertragsgegenstand',
    body:
      'Der Verkäufer verkauft dem Käufer, und der Käufer kauft vom Verkäufer, das oben ' +
      'bezeichnete Motorfahrzeug samt Fahrzeugausweis, sämtlichen Fahrzeugschlüsseln sowie ' +
      'dem serienmässigen Zubehör. Weiteres Zubehör ist nur Vertragsbestandteil, soweit es in ' +
      'diesem Dokument oder einer schriftlichen Beilage ausdrücklich aufgeführt ist.',
  })

  clause(doc, {
    number: 2,
    title: 'Kaufpreis und Zahlung',
    body:
      `Der Kaufpreis beträgt ${terms.priceLabel}. Er ist bei Übergabe des Fahrzeugs vollständig ` +
      'zur Zahlung fällig, sofern nicht schriftlich eine andere Zahlungsart (z. B. Teilzahlung, ' +
      'Finanzierung durch Dritte) vereinbart wurde. Bis zur vollständigen Bezahlung des ' +
      'Kaufpreises bleibt das Fahrzeug im Eigentum des Verkäufers.',
    draftNote:
      'Ein Eigentumsvorbehalt entfaltet Wirkung gegenüber Dritten (z. B. im Betreibungsverfahren ' +
      'gegen den Käufer) erst mit Eintrag im Eigentumsvorbehaltsregister am Wohnsitz des Käufers ' +
      '(Art. 715 ZGB). Ob und wie dieser Vertrag darauf hinweisen bzw. den Eintrag vorsehen soll, ' +
      'legt der Anwalt fest.',
  })

  clause(doc, {
    number: 3,
    title: 'Übergabe, Nutzen und Gefahr',
    body:
      'Mit der Übergabe des Fahrzeugs und der dazugehörigen Papiere an den Käufer gehen Nutzen ' +
      'und Gefahr auf diesen über (Art. 185 OR). Der Käufer bestätigt mit seiner Unterschrift, ' +
      'das Fahrzeug in dem bei der Übergabe vorgefundenen Zustand geprüft und übernommen zu haben.',
  })

  clause(doc, {
    number: 4,
    title: 'Zustand des Fahrzeugs, Kilometerstand',
    body:
      'Das Fahrzeug wird in dem bei Vertragsschluss besichtigten, dem Käufer bekannten Zustand ' +
      `verkauft. Der ausgewiesene Kilometerstand (${vehicle.mileageKm != null ? `${vehicle.mileageKm} km` : 'siehe oben'}) ` +
      'entspricht nach bestem Wissen des Verkäufers den ihm vorliegenden Unterlagen (Serviceheft, ' +
      'letzter MFK-Bericht, Vorbesitzer-Angaben). ' +
      (terms.soldWithInspection
        ? 'Der Verkauf erfolgt ausdrücklich "ab MFK" — dies ist eine vertragliche Zusicherung, dass ' +
          'die amtliche Motorfahrzeugkontrolle im Zeitpunkt der Übergabe gültig ist, nicht bloss eine ' +
          'unverbindliche Beschreibung.'
        : 'Der Verkauf erfolgt nicht "ab MFK"; eine gültige amtliche Motorfahrzeugkontrolle im ' +
          'Zeitpunkt der Übergabe wird nicht zugesichert.'),
    draftNote:
      'Die genaue Formulierung der Kilometerstand-Angabe (Wissenserklärung vs. Zusicherung) hat ' +
      'unmittelbare Auswirkung auf die Gewährleistung nach Art. 197 OR und ist vom Anwalt zu prüfen.',
  })

  clause(doc, {
    number: 5,
    title: 'Gewährleistung',
    body:
      `Der Verkäufer gewährleistet dem Käufer die vereinbarten Eigenschaften des Fahrzeugs für ` +
      `${terms.warrantyMonths ?? '[ ]'} Monate ab Übergabe (Art. 197 ff. OR). Ausgeschlossen sind ` +
      'Schäden aus normaler Abnutzung, unsachgemässer Behandlung, Unfall nach Übergabe sowie ' +
      'Verschleissteile.',
    draftNote:
      'Verkauft der Händler an eine Konsumentin/einen Konsumenten (Privatperson, nicht zu ' +
      'gewerblichen Zwecken), ist eine Gewährleistungsfrist unter 12 Monaten unwirksam und ein ' +
      'vollständiger Gewährleistungsausschluss unzulässig (Art. 210 Abs. 4 OR). Die genaue Formulierung ' +
      '— insbesondere Liste der Ausschlüsse und Abgrenzung zur Herstellergarantie — muss der Anwalt ' +
      'festlegen.',
  })

  clause(doc, {
    number: 6,
    title: 'Datenbearbeitung und Aufbewahrung',
    body:
      'Die im Zusammenhang mit diesem Vertrag erhobenen Personendaten werden ausschliesslich zur ' +
      'Vertragsabwicklung sowie zur Erfüllung gesetzlicher Aufbewahrungspflichten bearbeitet. Der ' +
      'Verkäufer bewahrt diesen Vertrag während zehn Jahren auf (Art. 958f OR i.V.m. GeBüV) und ' +
      'behandelt Personendaten gemäss den Bestimmungen des Bundesgesetzes über den Datenschutz (DSG).',
  })

  clause(doc, {
    number: 7,
    title: 'Schlussbestimmungen',
    body:
      'Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform. Dieser Vertrag ' +
      'untersteht schweizerischem Recht. Sollte eine Bestimmung dieses Vertrags unwirksam sein ' +
      'oder werden, bleibt die Gültigkeit der übrigen Bestimmungen davon unberührt; die Parteien ' +
      'verpflichten sich, die unwirksame Bestimmung durch eine ihrem wirtschaftlichen Zweck ' +
      'möglichst nahekommende gültige Bestimmung zu ersetzen.',
    draftNote: 'Gerichtsstand und ggf. eine Schiedsklausel sind vom Anwalt festzulegen.',
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
    .text('Verkäufer, Ort/Datum', doc.page.margins.left, y + 4, { width: w })
    .text('Käufer, Ort/Datum', doc.page.margins.left + w + 24, y + 4, { width: w })

  footers(doc, { dealer, docNo })
}
