import Fastify from 'fastify'
import { withoutTenant } from '@tiff/core-db'
import { registerRoutes } from './routes/index.js'

// Hinter einem Reverse-Proxy (Hoster, Load Balancer) ist request.ip sonst für alle Besucher dieselbe
// Proxy-Adresse — und die Begrenzung des Anfragen-Eingangs träfe alle zusammen. TRUST_PROXY=true
// (oder eine Anzahl Proxys) nur setzen, wenn wirklich einer davor steht; sonst wäre X-Forwarded-For fälschbar.
const trustProxy = process.env.TRUST_PROXY === 'true' ? true : /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : false
const app = Fastify({ logger: true, trustProxy })

await registerRoutes(app)

const port = Number(process.env.PORT ?? 3010)
app.listen({ port, host: '0.0.0.0' }).then(async () => {
  // Der Löschschutz für archivierte Belege (Migration 14) gilt für die Datenbankrolle `tiff_app`.
  // Verbindet sich der Server unter anderem Namen, ist er wirkungslos — dann lieber laut warnen.
  const { rows } = await withoutTenant((client) => client.query('SELECT session_user AS name'))
  if (rows[0].name !== 'tiff_app') {
    app.log.warn(`Datenbankrolle "${rows[0].name}": der Löschschutz für archivierte Belege greift nur für "tiff_app" (Migration 14 anpassen).`)
  }
}).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
