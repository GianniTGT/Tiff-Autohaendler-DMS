import { getDashboard } from '../services/dashboard.js'

export async function registerDashboardRoutes(app) {
  app.get('/api/dashboard', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await getDashboard(request.tenantId, request.role),
  }))
}
