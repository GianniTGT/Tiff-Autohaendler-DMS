import fp from 'fastify-plugin'
import cookie from '@fastify/cookie'
import { canBill } from '@tiff/core-auth'
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
    request.userName = session.name
    request.role = session.role
  })

  // Nach requireAuth verwenden: preHandler: [app.requireAuth, app.requireBilling]
  fastify.decorate('requireBilling', async function requireBilling(request, reply) {
    if (!canBill(request.role)) {
      reply.code(403).send({ ok: false, error: 'Dafür fehlt die Berechtigung (Rechnungen, Verträge und Archiv sind nicht für die Werkstatt).' })
      return reply
    }
  })
})
