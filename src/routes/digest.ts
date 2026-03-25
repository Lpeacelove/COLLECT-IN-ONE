import { Hono } from 'hono'
import { Env } from '../types'
import { runDigestPipeline } from '../services/pipeline'

const app = new Hono<{ Bindings: Env }>()

// 手动触发摘要推送链路（联调 / 测试用）
// 同步等待结果，方便直接查看是否成功
app.post('/', async (c) => {
  const result = await runDigestPipeline(c.env)
  return c.json(result, result.ok ? 200 : 500)
})

export default app
