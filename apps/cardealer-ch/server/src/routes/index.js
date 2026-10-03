import authPlugin from '../plugins/auth.js'
import { registerHealthRoutes } from './health.js'
import { registerAuthRoutes } from './auth.js'
import { registerVehicleRoutes } from './vehicles.js'
import { registerPartyRoutes } from './parties.js'
import { registerInvoiceRoutes } from './invoices.js'
import { registerAutoScout24Routes } from './autoscout24.js'
import { registerDashboardRoutes } from './dashboard.js'
import { registerTenantRoutes } from './tenant.js'
import { registerWorkshopRoutes } from './workshop.js'
import { registerLeadRoutes } from './leads.js'
import { registerUserRoutes } from './users.js'
import { registerPhotoRoutes } from './photos.js'
import { registerArchiveRoutes } from './archive.js'
import { registerReportRoutes } from './reports.js'
import { registerPublicLeadRoutes } from './public-leads.js'
import { registerSalesDocumentRoutes } from './sales-documents.js'

/**
 * Jede Route, die Mandantendaten anfasst, muss durch withTenant() aus
 * @tiff/core-db gehen — nie direkt gegen den Pool. Der Boundary-Test
 * (test/tenant-boundary.test.mjs) prüft das über den Quelltext, analog zu
 * `test/payload-privacy.test.mjs` im US-Repo (SCHWEIZ-SAAS.md §3).
 */
export async function registerRoutes(app) {
  // Ungültige IDs/Datumswerte lösen in Postgres Fehler der Klassen 22/23 aus. Das ist eine fehlerhafte
  // Eingabe (400), kein Serverfehler — und der SQL-Text gehört nicht in die Antwort.
  app.setErrorHandler((err, request, reply) => {
    if (typeof err.code === 'string' && /^(22|23)/.test(err.code)) {
      return reply.code(400).send({ ok: false, error: 'Ungültige Eingabe.' })
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ ok: false, error: err.message })
    request.log.error(err)
    return reply.code(500).send({ ok: false, error: 'Interner Fehler.' })
  })
  await app.register(authPlugin)
  await registerHealthRoutes(app)
  await registerAuthRoutes(app)
  await registerVehicleRoutes(app)
  await registerPartyRoutes(app)
  await registerInvoiceRoutes(app)
  await registerAutoScout24Routes(app)
  await registerDashboardRoutes(app)
  await registerTenantRoutes(app)
  await registerWorkshopRoutes(app)
  await registerLeadRoutes(app)
  await registerUserRoutes(app)
  await registerPhotoRoutes(app)
  await registerArchiveRoutes(app)
  await registerReportRoutes(app)
  await registerPublicLeadRoutes(app)
  await registerSalesDocumentRoutes(app)
}
