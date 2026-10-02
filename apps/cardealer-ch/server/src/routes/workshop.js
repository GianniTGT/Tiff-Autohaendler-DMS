import { listJobs, createJob, updateJob, deleteJob, getBoard } from '../services/recon.js'
import { getEvents, createAppointment, updateAppointment, deleteAppointment } from '../services/calendar.js'
import { dayKey } from '../services/dashboard-calc.js'

const fail = (reply, err) => reply.code(400).send({ ok: false, error: err.message })
const notFound = (reply) => reply.code(404).send({ ok: false, error: 'NOT_FOUND' })

/** Werkstatt-Aufträge und Kalender — beide stehen allen Rollen offen und enthalten keine Preise ausser Auftragsschätzungen (Werkstatt-Sicht). */
export async function registerWorkshopRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.get('/api/recon/board', auth, async (request) => ({
    ok: true,
    data: await getBoard(request.tenantId, dayKey(new Date())),
  }))

  app.get('/api/vehicles/:id/jobs', auth, async (request) => ({
    ok: true,
    data: await listJobs(request.tenantId, request.params.id),
  }))

  app.post('/api/vehicles/:id/jobs', auth, async (request, reply) => {
    try {
      const job = await createJob(request.tenantId, { ...request.body, vehicleId: request.params.id })
      return job ? reply.code(201).send({ ok: true, data: job }) : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/api/jobs/:id', auth, async (request, reply) => {
    try {
      const job = await updateJob(request.tenantId, request.params.id, request.body ?? {})
      return job ? { ok: true, data: job } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/api/jobs/:id', auth, async (request, reply) => {
    try {
      return (await deleteJob(request.tenantId, request.params.id)) ? { ok: true } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/calendar', auth, async (request, reply) => {
    try {
      const { from, to } = request.query
      return { ok: true, data: await getEvents(request.tenantId, { from, to, today: dayKey(new Date()) }) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/appointments', auth, async (request, reply) => {
    try {
      return reply.code(201).send({ ok: true, data: await createAppointment(request.tenantId, request.body ?? {}) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/api/appointments/:id', auth, async (request, reply) => {
    try {
      const appointment = await updateAppointment(request.tenantId, request.params.id, request.body ?? {})
      return appointment ? { ok: true, data: appointment } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/api/appointments/:id', auth, async (request, reply) =>
    (await deleteAppointment(request.tenantId, request.params.id)) ? { ok: true } : notFound(reply),
  )
}
