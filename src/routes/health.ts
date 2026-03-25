import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({ ok: true, timestamp: new Date().toISOString() })
})

export default app
