import { listPhotos, addPhoto, getPhotoBytes, setCover, movePhoto, deletePhoto, MAX_PHOTO_BYTES } from '../services/photos.js'

const fail = (reply, err) => reply.code(400).send({ ok: false, error: err.message })
const notFound = (reply) => reply.code(404).send({ ok: false, error: 'NOT_FOUND' })

/**
 * Fotos kommen als rohe Bytes im Request-Body (kein multipart): ein Foto pro
 * Anfrage, Typ wird in photos.js an den Bytes geprüft, nicht am Header.
 */
export async function registerPhotoRoutes(app) {
  const auth = { preHandler: app.requireAuth }

  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES + 1024 }, (request, body, done) =>
    done(null, body),
  )

  app.get('/api/vehicles/:id/photos', auth, async (request) => ({
    ok: true,
    data: await listPhotos(request.tenantId, request.params.id),
  }))

  app.post('/api/vehicles/:id/photos', auth, async (request, reply) => {
    try {
      const photo = await addPhoto(request.tenantId, request.params.id, request.body)
      return photo ? reply.code(201).send({ ok: true, data: photo }) : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/api/vehicles/:id/photos/:photoId', auth, async (request, reply) => {
    const photo = await getPhotoBytes(request.tenantId, request.params.id, request.params.photoId)
    if (!photo) return notFound(reply)
    reply.type(photo.contentType)
    reply.header('Cache-Control', 'private, max-age=3600')
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(photo.buffer)
  })

  app.post('/api/vehicles/:id/photos/:photoId/cover', auth, async (request, reply) =>
    (await setCover(request.tenantId, request.params.id, request.params.photoId)) ? { ok: true } : notFound(reply),
  )

  app.post('/api/vehicles/:id/photos/:photoId/move', auth, async (request, reply) => {
    try {
      return (await movePhoto(request.tenantId, request.params.id, request.params.photoId, request.body?.direction)) ? { ok: true } : notFound(reply)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/api/vehicles/:id/photos/:photoId', auth, async (request, reply) =>
    (await deletePhoto(request.tenantId, request.params.id, request.params.photoId)) ? { ok: true } : notFound(reply),
  )
}
