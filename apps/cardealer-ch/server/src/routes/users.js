import { canManageUsers } from '@tiff/core-auth'
import { listUsers, addUser, updateUser } from '../services/users.js'

const forbidden = (reply) => reply.code(403).send({ ok: false, error: 'Nur der Inhaber darf Benutzer verwalten.' })

export async function registerUserRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.get('/api/users', auth, async (request, reply) => {
    if (!canManageUsers(request.role)) return forbidden(reply)
    return { ok: true, data: await listUsers(request.tenantId) }
  })

  app.post('/api/users', auth, async (request, reply) => {
    if (!canManageUsers(request.role)) return forbidden(reply)
    try {
      return reply.code(201).send({ ok: true, data: await addUser(request.tenantId, request.body ?? {}) })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  app.patch('/api/users/:id', auth, async (request, reply) => {
    if (!canManageUsers(request.role)) return forbidden(reply)
    try {
      const user = await updateUser(request.tenantId, request.userId, request.params.id, request.body ?? {})
      return user ? { ok: true, data: user } : reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })
}
