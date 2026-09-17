import { login, logout, LoginError, encodeSessionCookie } from '../services/auth.js'
import { SESSION_COOKIE_NAME } from '../plugins/auth.js'

const isProduction = process.env.NODE_ENV === 'production'

export async function registerAuthRoutes(app) {
  app.post('/api/auth/login', async (request, reply) => {
    const { tenantSlug, email, password } = request.body ?? {}
    if (!tenantSlug || !email || !password) {
      return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS' })
    }

    try {
      const session = await login({ tenantSlug, email, password })
      reply.setCookie(SESSION_COOKIE_NAME, encodeSessionCookie(session.tenantId, session.sessionId), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        expires: session.expiresAt,
      })
      return { ok: true, data: { userId: session.userId, role: session.role } }
    } catch (err) {
      if (err instanceof LoginError) {
        return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' })
      }
      throw err
    }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await logout(request.cookies[SESSION_COOKIE_NAME])
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: { userId: request.userId, role: request.role },
  }))
}
