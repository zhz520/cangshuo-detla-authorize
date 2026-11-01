import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { HttpError, fail } from './store.mjs'

const equal = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y) }
export function createAuthorityServer(store, { secureCookie = false, staticDirectory } = {}) {
  const attempts = new Map()
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('X-Frame-Options', 'DENY'); response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('Cache-Control', 'no-store')
    const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)) }
    try {
      const url = new URL(request.url, 'http://localhost'), route = url.pathname, method = request.method
      let body = {}
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        if (request.headers.origin) {
          let origin; try { origin = new URL(request.headers.origin) } catch { fail('请求来源不正确', 403) }
          if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) fail('请求来源不匹配', 403)
        }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) fail('请求必须为 JSON', 415)
        let size = 0, chunks = []
        for await (const chunk of request) { size += chunk.length; if (size > 65536) fail('请求内容过大', 413); chunks.push(chunk) }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { fail('JSON 格式不正确') }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求内容须为对象')
      }
      if (route === '/health' && method === 'GET') return json({ ok: true, service: 'cangshuo-detla-authorize' })
      const token = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('authority_session='))?.slice(18)
      if (route === '/api/login' && method === 'POST') {
        const bucket = String(request.socket.remoteAddress), time = Date.now()
        let attempt = attempts.get(bucket)
        if (attempt && attempt.until > time && attempt.count >= 5) fail('尝试过多，请 15 分钟后重试', 429)
        if (!attempt || attempt.until <= time) attempt = { count: 0, until: time + 900000 }
        try {
          if (typeof body.password !== 'string' || body.password.length > 256) fail('账号或密码不正确', 401)
          const session = store.login(body.username, body.password); attempts.delete(bucket)
          response.setHeader('Set-Cookie', `authority_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? '; Secure' : ''}`)
          return json({ username: session.username, csrf: session.csrf })
        } catch (error) { attempt.count++; if (attempts.size >= 1000) attempts.delete(attempts.keys().next().value); attempts.set(bucket, attempt); throw error }
      }
      const session = store.session(token)
      if (route === '/api/session' && method === 'GET') return json(session ? { authenticated: true, username: session.username, csrf: session.csrf } : { authenticated: false })
      if (route === '/public/releases' && method === 'GET') return json({ releases: store.publishedReleases(), automaticInstall: false })
      if (route.startsWith('/api/')) {
        if (!session) fail('请先登录运营后台', 401)
        if (!['GET', 'HEAD'].includes(method) && !equal(request.headers['x-csrf-token'], session.csrf)) fail('请求校验失败，请刷新页面', 403)
        if (route === '/api/logout' && method === 'POST') { store.logout(token); response.setHeader('Set-Cookie', 'authority_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json({ ok: true }) }
        if (route === '/api/data' && method === 'GET') return json(store.lists())
        if (route === '/api/public-key' && method === 'GET') return json({ publicKey: store.publicKey, format: 'delta-license-v1', minimumClientVersion: '1.1.0-preview.2' })
        if (route === '/api/customers' && method === 'POST') return json(store.createCustomer(body, session.username), 201)
        if (route === '/api/instances' && method === 'POST') return json(store.createInstance(body, session.username), 201)
        if (route === '/api/orders' && method === 'POST') return json(store.createOrder(body, session.username), 201)
        if (route === '/api/releases' && method === 'POST') return json(store.createRelease(body, session.username), 201)
        let match
        if ((match = route.match(/^\/api\/instances\/([a-f\d-]+)$/)) && method === 'PUT') return json(store.updateInstance(match[1], body, session.username))
        if ((match = route.match(/^\/api\/modules\/([\w-]+)$/)) && method === 'PUT') return json(store.updateModule(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/paid$/)) && method === 'POST') return json(store.markPaid(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/maintenance$/)) && method === 'POST') return json(store.grantMaintenance(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/issue$/)) && method === 'POST') return json(store.issue(match[1], session.username))
        if ((match = route.match(/^\/api\/licenses\/([a-f\d-]+)$/)) && method === 'GET') return json(store.license(match[1]))
        if ((match = route.match(/^\/api\/releases\/([^/]+)\/publish$/)) && method === 'POST') return json(store.publishRelease(decodeURIComponent(match[1]), session.username))
        fail('接口不存在', 404)
      }
      if (method !== 'GET' || !staticDirectory) fail('资源不存在', 404)
      const pathname = decodeURIComponent(route)
      if (pathname.split('/').some(segment => segment.startsWith('.'))) fail('资源不存在', 404)
      const root = path.resolve(staticDirectory), candidate = path.resolve(root, '.' + pathname)
      if (!candidate.startsWith(root + path.sep) && candidate !== root) fail('资源不存在', 404)
      let target = candidate
      try { if (!(await stat(target)).isFile()) target = path.join(root, 'index.html') } catch { target = path.join(root, 'index.html') }
      const extension = path.extname(target), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
      if (!types[extension]) fail('资源不存在', 404)
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
      const content = await readFile(target); response.writeHead(200, { 'Content-Type': types[extension] }); response.end(content)
    } catch (error) {
      if (response.headersSent) return response.end()
      if (error instanceof HttpError) return json({ message: error.message }, error.status)
      if (String(error.code || '').includes('CONSTRAINT') || /UNIQUE constraint/.test(error.message)) return json({ message: '编号已存在或关联信息不正确' }, 409)
      console.error('authority_request_failed', error.name)
      json({ message: '操作失败，请核对输入或联系维护人员' }, 500)
    }
  })
}
