import {
  pushVehicleToAutoScout24,
  activateAutoScout24Listing,
  deactivateAutoScout24Listing,
  removeAutoScout24Listing,
} from '../services/autoscout24-sync.js'

export async function registerAutoScout24Routes(app) {
  app.post('/api/vehicles/:id/autoscout24/push', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const result = await pushVehicleToAutoScout24(request.tenantId, request.params.id, {
        makeKey: request.body?.makeKey,
        modelKey: request.body?.modelKey,
      })
      return { ok: true, data: result }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.post('/api/vehicles/:id/autoscout24/activate', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      await activateAutoScout24Listing(request.tenantId, request.params.id)
      return { ok: true }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.post('/api/vehicles/:id/autoscout24/deactivate', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      await deactivateAutoScout24Listing(request.tenantId, request.params.id)
      return { ok: true }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.delete('/api/vehicles/:id/autoscout24', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      await removeAutoScout24Listing(request.tenantId, request.params.id)
      return { ok: true }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })
}
