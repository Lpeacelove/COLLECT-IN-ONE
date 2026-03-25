import { Hono } from 'hono'
import { Env } from './types'
import { corsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import collectRoute from './routes/collect'
import itemsRoute from './routes/items'
import healthRoute from './routes/health'

const app = new Hono<{ Bindings: Env }>()

// 全局中间件
app.use('*', corsMiddleware)

// 无需鉴权的路由
app.route('/api/health', healthRoute)

// 需要鉴权的路由
app.use('/api/*', authMiddleware)
app.route('/api/collect', collectRoute)
app.route('/api/items', itemsRoute)

// 404 兜底
app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404))

// 全局错误处理
app.onError((err, c) => {
  console.error(JSON.stringify({ event: 'unhandled_error', message: err.message, stack: err.stack }))
  return c.json({ ok: false, error: 'internal_server_error' }, 500)
})

// Cron 触发器（后续 Phase 5 填充逻辑）
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    console.log(JSON.stringify({ event: 'cron_triggered', time: new Date().toISOString() }))
    // TODO: Phase 5 — 重试提取 + 批量总结 + 飞书推送
  },
}
