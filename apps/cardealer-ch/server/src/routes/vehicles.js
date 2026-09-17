import {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  getVehicleEconomics,
} from '../services/vehicles.js'

export async function registerVehicleRoutes(app) {
  app.get('/api/vehicles', { preHandler: app.requireAuth }, async (request) => {
    const data = await listVehicles(request.tenantId, { status: request.query.status })
    return { ok: true, data }
  })

  app.get('/api/vehicles/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await getVehicle(request.tenantId, request.params.id)
    if (!vehicle) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: vehicle }
  })

  app.get('/api/vehicles/:id/economics', { preHandler: app.requireAuth }, async (request, reply) => {
    const economics = await getVehicleEconomics(request.tenantId, request.params.id)
    if (!economics) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: economics }
  })

  app.post('/api/vehicles', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await createVehicle(request.tenantId, request.body ?? {})
    return reply.code(201).send({ ok: true, data: vehicle })
  })

  app.patch('/api/vehicles/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await updateVehicle(request.tenantId, request.params.id, request.body ?? {})
    if (!vehicle) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: vehicle }
  })
}
