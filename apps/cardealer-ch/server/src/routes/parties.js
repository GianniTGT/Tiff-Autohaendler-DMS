import { listParties, getParty, createParty, updateParty } from '../services/parties.js'

export async function registerPartyRoutes(app) {
  app.get('/api/parties', { preHandler: app.requireAuth }, async (request) => {
    const data = await listParties(request.tenantId, { search: request.query.search })
    return { ok: true, data }
  })

  app.get('/api/parties/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const party = await getParty(request.tenantId, request.params.id)
    if (!party) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: party }
  })

  app.post('/api/parties', { preHandler: app.requireAuth }, async (request, reply) => {
    const party = await createParty(request.tenantId, request.body ?? {})
    return reply.code(201).send({ ok: true, data: party })
  })

  app.patch('/api/parties/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const party = await updateParty(request.tenantId, request.params.id, request.body ?? {})
    if (!party) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: party }
  })
}
