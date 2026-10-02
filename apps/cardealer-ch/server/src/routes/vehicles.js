import { canSeePurchasePrices } from '@tiff/core-auth'
import {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  getVehicleEconomics,
  sellVehicle,
} from '../services/vehicles.js'
import { listCosts, addCost, deleteCost } from '../services/vehicle-costs.js'
import { renderKaufvertrag, renderAnkaufsvertrag, issueContract, listContracts } from '../services/contracts.js'
import { clientMessage } from './http-errors.js'

// Felder, die nur sieht, wer Preise sehen darf (roles.js: canSeePurchasePrices), und die nur setzen darf, wer Geschäfte macht.
const PRICE_FIELDS = ['purchasePriceRappen', 'soldPriceRappen', 'purchaseVatRappen', 'notionalInputTaxRappen']
const BUSINESS_FIELDS = [...PRICE_FIELDS, 'askingPriceRappen', 'status', 'vatScheme', 'purchaseFrom', 'sellerPartyId', 'buyerPartyId', 'soldAt', 'purchasedAt']
const redact = (vehicle, role) =>
  canSeePurchasePrices(role) ? vehicle : Object.fromEntries(Object.entries(vehicle).filter(([key]) => !PRICE_FIELDS.includes(key)))
const withoutBusinessFields = (body, role) =>
  canSeePurchasePrices(role) ? body : Object.fromEntries(Object.entries(body).filter(([key]) => !BUSINESS_FIELDS.includes(key)))

export async function registerVehicleRoutes(app) {
  const billing = { preHandler: [app.requireAuth, app.requireBilling] }
  app.get('/api/vehicles', { preHandler: app.requireAuth }, async (request) => {
    const data = await listVehicles(request.tenantId, { status: request.query.status })
    return { ok: true, data: data.map((v) => redact(v, request.role)) }
  })

  app.get('/api/vehicles/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await getVehicle(request.tenantId, request.params.id)
    if (!vehicle) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: redact(vehicle, request.role) }
  })

  app.get('/api/vehicles/:id/economics', { preHandler: app.requireAuth }, async (request, reply) => {
    if (!canSeePurchasePrices(request.role)) return reply.code(403).send({ ok: false, error: 'Die Wirtschaftlichkeit ist für die Werkstatt nicht sichtbar.' })
    const economics = await getVehicleEconomics(request.tenantId, request.params.id)
    if (!economics) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: economics }
  })

  app.post('/api/vehicles', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await createVehicle(request.tenantId, withoutBusinessFields(request.body ?? {}, request.role))
    return reply.code(201).send({ ok: true, data: redact(vehicle, request.role) })
  })

  app.patch('/api/vehicles/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await updateVehicle(request.tenantId, request.params.id, withoutBusinessFields(request.body ?? {}, request.role))
    if (!vehicle) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true, data: redact(vehicle, request.role) }
  })

  app.post('/api/vehicles/:id/sell', billing, async (request, reply) => {
    try {
      const vehicle = await sellVehicle(request.tenantId, request.params.id, request.body ?? {})
      if (!vehicle) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
      return { ok: true, data: vehicle }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.get('/api/vehicles/:id/costs', { preHandler: app.requireAuth }, async (request) => ({
    ok: true,
    data: await listCosts(request.tenantId, request.params.id),
  }))

  app.post('/api/vehicles/:id/costs', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      const cost = await addCost(request.tenantId, request.params.id, request.body ?? {})
      if (!cost) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
      return reply.code(201).send({ ok: true, data: cost })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })

  app.delete('/api/vehicles/:id/costs/:costId', { preHandler: app.requireAuth }, async (request, reply) => {
    const removed = await deleteCost(request.tenantId, request.params.id, request.params.costId)
    if (!removed) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    return { ok: true }
  })

  const sendContract = (reply, buffer, filename) => {
    if (!buffer) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    reply.type('application/pdf')
    reply.header('Content-Disposition', `inline; filename="${filename}"`)
    return reply.send(buffer)
  }

  app.get('/api/vehicles/:id/kaufvertrag.pdf', billing, async (request, reply) => {
    const { buyerPartyId, warrantyMonths } = request.query
    const buffer = await renderKaufvertrag(request.tenantId, request.params.id, {
      buyerPartyId: buyerPartyId || undefined,
      warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
    })
    return sendContract(reply, buffer, 'Kaufvertrag.pdf')
  })

  app.get('/api/vehicles/:id/ankaufsvertrag.pdf', billing, async (request, reply) => {
    const buffer = await renderAnkaufsvertrag(request.tenantId, request.params.id, {
      sellerPartyId: request.query.sellerPartyId || undefined,
    })
    return sendContract(reply, buffer, 'Ankaufsvertrag.pdf')
  })

  app.get('/api/vehicles/:id/contracts', billing, async (request) => ({
    ok: true,
    data: await listContracts(request.tenantId, request.params.id),
  }))

  app.post('/api/vehicles/:id/contracts', billing, async (request, reply) => {
    try {
      const { kind, partyId, warrantyMonths } = request.body ?? {}
      const contract = await issueContract(request.tenantId, request.userId, request.params.id, kind, {
        partyId: partyId || undefined,
        warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
      })
      return contract ? reply.code(201).send({ ok: true, data: contract }) : reply.code(404).send({ ok: false, error: 'NOT_FOUND' })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: clientMessage(err) })
    }
  })
}
