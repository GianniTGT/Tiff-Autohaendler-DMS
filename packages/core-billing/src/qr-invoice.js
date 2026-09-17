/**
 * Schweizer QR-Rechnung — dünner Wrapper um `swissqrbill`.
 *
 * Nicht selbst bauen: die SIX-Spezifikation hat viele Details (Grösse des
 * QR-Codes, Fehlerkorrektur, Zeilenstruktur der Nutzlast SPC/0200/.../EPD),
 * bei denen man den Fehler erst merkt, wenn eine Bank ablehnt
 * (SCHWEIZ-SAAS.md §4.4). `swissqrbill` nimmt einem das ab.
 *
 * Referenztyp hängt von der IBAN des Mandanten ab:
 *  - QR-IBAN (IID 30000-31999) -> QRR-Referenz, 27-stellig, Modulo-10-rekursiv
 *  - normale IBAN               -> SCOR (RF + ISO 11649) oder NON (keine Referenz)
 *
 * Empfehlung (SCHWEIZ-SAAS.md §4.4): QR-IBAN + QRR bestellen — nur damit lässt
 * sich eine Zahlung später über camt.054 automatisch zuordnen (Phase 2).
 */
import { SwissQRBill } from 'swissqrbill/pdf'

/**
 * @param {object} tenant  { legalName, addressStreet, addressZip, addressCity, qrIban }
 * @param {object} debtor  { name, addressStreet, addressZip, addressCity }
 * @param {object} invoice { totalRappen, currency, reference, message }
 * @returns {SwissQRBill} eine swissqrbill-Instanz — `.attachTo(pdfDoc)` fügt den
 *   Zahlteil an ein offenes PDFKit-Dokument an (siehe packages/core-docs für das
 *   übrige Rechnungs-Layout).
 */
export function buildQrBill(tenant, debtor, invoice) {
  if (!tenant.qrIban) {
    throw new Error(
      'Mandant hat keine QR-IBAN hinterlegt — ohne QR-IBAN kann keine QR-Rechnung mit QRR-Referenz erstellt werden.',
    )
  }

  return new SwissQRBill({
    currency: invoice.currency ?? 'CHF',
    amount: Number(invoice.totalRappen) / 100,
    creditor: {
      name: tenant.legalName,
      address: tenant.addressStreet,
      zip: tenant.addressZip,
      city: tenant.addressCity,
      account: tenant.qrIban,
      country: 'CH',
    },
    debtor: {
      name: debtor.name,
      address: debtor.addressStreet,
      zip: debtor.addressZip,
      city: debtor.addressCity,
      country: 'CH',
    },
    reference: invoice.reference,
    message: invoice.message,
  })
}

/**
 * Swico-Syntax in der unstrukturierten Mitteilung, optional aber wirkungsvoll
 * (SCHWEIZ-SAAS.md §4.4): damit kann die Buchhaltungssoftware des Empfängers
 * die Rechnung automatisch verbuchen.
 */
export function buildSwicoMessage({ invoiceNumber, issueDate, uid, vatRatePercent, terms }) {
  const dateCode = issueDate.replace(/-/g, '').slice(2) // JJMMTT
  return `//S1/10/${invoiceNumber}/11/${dateCode}/30/${uid}/32/${vatRatePercent}/40/${terms}`
}
