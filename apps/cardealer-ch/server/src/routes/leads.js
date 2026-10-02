import { listLeads, createLead, updateLead, deleteLead, convertLeadToParty } from '../services/leads.js'
import { clientMessage } from './http-errors.js'

const fail = (reply, err) => reply.code(400).send({ ok: false, error: clientMessage(err) })
const notFound = (reply) => reply.code(404).send({ ok: false, error: 'NOT_FOUND' })

export async function registerLeadRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.get('/api/leads', auth, async (request) => ({
    ok: true,
    data: await listLeads(request.tenantId, { status: request.query.status }),
  }))

  app.post('/api/leads', auth, async (request, reply) => {
    try {
      return reply.code(201).send({ ok: true, data: await createLead(request.tenantId, request.body ?? {}) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/api/leads/:id', auth, async (request, reply) => {
    try {
      const lead = await updateLead(request.tenantId, request.params.id, request.body ?? {})
      return lead ? { ok: true, data: lead } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/api/leads/:id', auth, async (request, reply) =>
    (await deleteLead(request.tenantId, request.params.id)) ? { ok: true } : notFound(reply),
  )

  app.post('/api/leads/:id/convert', auth, async (request, reply) => {
    try {
      const result = await convertLeadToParty(request.tenantId, request.params.id)
      return result ? { ok: true, data: result } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })
}
