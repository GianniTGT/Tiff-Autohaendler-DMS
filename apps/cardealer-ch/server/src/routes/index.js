import authPlugin from '../plugins/auth.js'
import { registerHealthRoutes } from './health.js'
import { registerAuthRoutes } from './auth.js'
import { registerVehicleRoutes } from './vehicles.js'
import { registerPartyRoutes } from './parties.js'
import { registerInvoiceRoutes } from './invoices.js'
import { registerAutoScout24Routes } from './autoscout24.js'

/**
 * Jede Route, die Mandantendaten anfasst, muss durch withTenant() aus
 * @tiff/core-db gehen — nie direkt gegen den Pool. Der Boundary-Test
 * (test/tenant-boundary.test.mjs) prüft das über den Quelltext, analog zu
 * `test/payload-privacy.test.mjs` im US-Repo (SCHWEIZ-SAAS.md §3).
 */
export async function registerRoutes(app) {
  await app.register(authPlugin)
  await registerHealthRoutes(app)
  await registerAuthRoutes(app)
  await registerVehicleRoutes(app)
  await registerPartyRoutes(app)
  await registerInvoiceRoutes(app)
  await registerAutoScout24Routes(app)
}
