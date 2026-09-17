import fp from 'fastify-plugin'
import cookie from '@fastify/cookie'
import { validateSessionCookie } from '../services/auth.js'

export const SESSION_COOKIE_NAME = 'tiff_session'

/**
 * Registriert Cookie-Unterstützung und stellt `requireAuth` als preHandler
 * bereit. Jede geschützte Route ruft `{ preHandler: fastify.requireAuth }`
 * auf — die Rolle wird bei JEDER Anfrage neu aus der DB gelesen (siehe
 * services/auth.js), nie aus dem Cookie selbst vertraut.
 */
export default fp(async function authPlugin(fastify) {
  await fastify.register(cookie)

  fastify.decorateRequest('tenantId', null)
  fastify.decorateRequest('userId', null)
  fastify.decorateRequest('role', null)

  fastify.decorate('requireAuth', async function requireAuth(request, reply) {
    const cookieValue = request.cookies[SESSION_COOKIE_NAME]
    const session = await validateSessionCookie(cookieValue)
    if (!session) {
      reply.code(401).send({ ok: false, error: 'SESSION_EXPIRED' })
      return reply
    }
    request.tenantId = session.tenantId
    request.userId = session.userId
    request.role = session.role
  })
})
