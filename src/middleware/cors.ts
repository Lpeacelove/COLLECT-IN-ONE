import { Context, Next } from 'hono'

export async function corsMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  await next()

  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
}
