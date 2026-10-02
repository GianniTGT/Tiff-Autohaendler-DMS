import { acceptPublicLead, allowedOriginFor, IntakeError } from '../services/lead-intake.js'
import { clientMessage } from './http-errors.js'

/**
 * Öffentlicher Eingang für Anfragen der Betriebs-Website. Bewusst ohne
 * Sitzung (kein requireAuth) — stattdessen Schlüssel im Header `X-Api-Key`.
 * CORS nur für die beim Betrieb hinterlegte Website-Adresse.
 */
export async function registerPublicLeadRoutes(app) {
  const corsHeaders = async (request, reply) => {
    const origin = request.headers.origin
    if (!origin) return
    const allowed = await allowedOriginFor(request.params.slug)
    if (allowed && origin === allowed) {
      reply.header('Access-Control-Allow-Origin', allowed)
      reply.header('Vary', 'Origin')
    }
  }

  app.options('/api/public/leads/:slug', async (request, reply) => {
    await corsHeaders(request, reply)
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
    reply.header('Access-Control-Max-Age', '600')
    return reply.code(204).send()
  })

  app.post('/api/public/leads/:slug', async (request, reply) => {
    await corsHeaders(request, reply)
    try {
      await acceptPublicLead({
        slug: request.params.slug,
        key: request.headers['x-api-key'],
        payload: request.body,
        clientId: request.ip,
      })
      return reply.code(201).send({ ok: true })
    } catch (err) {
      if (err instanceof IntakeError) return reply.code(err.status).send({ ok: false, error: clientMessage(err) })
      throw err
    }
  })
}
