import Fastify from 'fastify'
import { registerRoutes } from './routes/index.js'

const app = Fastify({ logger: true })

await registerRoutes(app)

const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
