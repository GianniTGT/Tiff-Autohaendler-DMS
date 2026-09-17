import { registerHealthRoutes } from './health.js'

/**
 * Jede Route, die Mandantendaten anfasst, muss durch withTenant() aus
 * @tiff/core-db gehen — nie direkt gegen den Pool. Der Boundary-Test
 * (test/tenant-boundary.test.mjs) prüft das über den Quelltext, analog zu
 * `test/payload-privacy.test.mjs` im US-Repo (SCHWEIZ-SAAS.md §3).
 */
export async function registerRoutes(app) {
  await registerHealthRoutes(app)
}
