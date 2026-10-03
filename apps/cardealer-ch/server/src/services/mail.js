/**
 * E-Mail-Versand — eine schmale Schnittstelle (`sendMail`), dahinter nodemailer.
 *
 * Mit `SMTP_URL` (z. B. smtps://user:pass@mail.infomaniak.com:465) geht die Mail wirklich hinaus,
 * Absender `MAIL_FROM`. Ohne `SMTP_URL` — lokale Entwicklung — wird die Mail vollständig ins Server-
 * Protokoll geschrieben, damit der Link zum Passwort-Zurücksetzen trotzdem auffindbar ist. Tests
 * tauschen den Transport mit `configureMailTransport()` aus, dasselbe Muster wie beim AutoScout24-Client.
 */
import nodemailer from 'nodemailer'

let transport = null

export function configureMailTransport(custom) {
  transport = custom ?? null
}

function defaultTransport() {
  if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL)
  return {
    kind: 'log',
    async sendMail(message) {
      console.log(`\n[mail] Kein SMTP_URL gesetzt — die E-Mail wird nur protokolliert.\nAn: ${message.to}\nBetreff: ${message.subject}\n\n${message.text}\n`)
      return { logged: true }
    },
  }
}

export const MAIL_FROM = () => process.env.MAIL_FROM ?? 'Tiff Autohändler Manager <no-reply@tiff-software-solutions.com>'

/** @param {{to: string, subject: string, text: string}} message */
export async function sendMail(message) {
  if (!transport) transport = defaultTransport()
  return transport.sendMail({ from: MAIL_FROM(), ...message })
}
