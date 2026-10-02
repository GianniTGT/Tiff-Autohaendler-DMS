import { canSeeCompanyTotals } from '@tiff/core-auth'
import { getSalesReport, getStockReport } from '../services/reports.js'
import { clientMessage } from './http-errors.js'

/** Beide Berichte zeigen Einkaufspreise und Gewinne: nur Inhaber und Buchhaltung (roles.js: canSeeCompanyTotals). */
export async function registerReportRoutes(app) {
  const auth = { preHandler: app.requireAuth }
  const forbidden = (reply) => reply.code(403).send({ ok: false, error: 'Diese Auswertung ist nur für Inhaber und Buchhaltung sichtbar.' })

  app.get('/api/reports/sales', auth, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) return forbidden(reply)
    try {
      return { ok: true, data: await getSalesReport(request.tenantId, { from: request.query.from, to: request.query.to }) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/reports/stock', auth, async (request, reply) => {
    if (!canSeeCompanyTotals(request.role)) return forbidden(reply)
    return { ok: true, data: await getStockReport(request.tenantId) }
  })
}
