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

// Modulo-10-rekursiv — derselbe Prüfziffern-Algorithmus wie beim alten
// ESR-Einzahlungsschein, jetzt für die QRR-Referenz (SIX Implementation
// Guidelines). Tabellenbasiert, keine Bibliothek nötig.
const MOD10_TABLE = [
  [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
  [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
  [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
  [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
  [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
  [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
  [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
  [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
  [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
  [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
]
const REMAINDER_TO_CHECK_DIGIT = [0, 9, 8, 7, 6, 5, 4, 3, 2, 1]

export function mod10CheckDigit(digits) {
  let carry = 0
  for (const ch of String(digits)) {
    carry = MOD10_TABLE[carry][Number(ch)]
  }
  return REMAINDER_TO_CHECK_DIGIT[carry]
}

/**
 * Baut eine 27-stellige QRR-Referenz aus einer beliebigen Ziffernfolge (z.B.
 * Mandanten-Kundennummer + Belegnummer) — links mit Nullen aufgefüllt auf 26
 * Stellen, dann die Prüfziffer angehängt. Nur gültig, wenn der Mandant eine
 * QR-IBAN hat (SCHWEIZ-SAAS.md §4.4) — sonst gibt es keine QRR-Referenz,
 * sondern 'NON'.
 */
export function buildQrrReference(numericId) {
  const digitsOnly = String(numericId).replace(/\D/g, '')
  if (!digitsOnly) throw new Error('buildQrrReference() braucht mindestens eine Ziffer.')
  const body = digitsOnly.padStart(26, '0').slice(-26)
  return body + mod10CheckDigit(body)
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
