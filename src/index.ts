import { Hono } from 'hono'
import { Env } from './types'
import { corsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import collectRoute from './routes/collect'
import itemsRoute from './routes/items'
import healthRoute from './routes/health'
import digestRoute from './routes/digest'
import { extractContent } from './services/extractor'
import { runDigestPipeline } from './services/pipeline'
import { getPendingRetryItems } from './db/queries'

const app = new Hono<{ Bindings: Env }>()

// 全局中间件
app.use('*', corsMiddleware)

// 无需鉴权的路由
app.route('/api/health', healthRoute)

// 需要鉴权的路由
app.use('/api/*', authMiddleware)
app.route('/api/collect', collectRoute)
app.route('/api/items', itemsRoute)
app.route('/api/digest', digestRoute)

// 404 兜底
app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404))

// 全局错误处理
app.onError((err, c) => {
  console.error(JSON.stringify({ event: 'unhandled_error', message: err.message, stack: err.stack }))
  return c.json({ ok: false, error: 'internal_server_error' }, 500)
})

// Cron 触发器（每日 00:00 UTC = 08:00 CST）
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const startTime = new Date().toISOString()
    console.log(JSON.stringify({ event: 'cron_start', time: startTime }))

    // Step 1：重试 pending / failed 的提取任务
    try {
      const retryItems = await getPendingRetryItems(env.DB)
      for (const item of retryItems) {
        ctx.waitUntil(extractContent(env, item.id, item.url))
      }
      console.log(JSON.stringify({ event: 'cron_retry_queued', count: retryItems.length }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(JSON.stringify({ event: 'cron_retry_error', error: msg }))
    }

    // Step 2：对已提取的 items 进行总结并推送飞书
    ctx.waitUntil(
      runDigestPipeline(env).then(result => {
        console.log(JSON.stringify({ event: 'cron_pipeline_done', ...result }))
      }),
    )
  },
}
