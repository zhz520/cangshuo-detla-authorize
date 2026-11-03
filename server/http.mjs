import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { HttpError, fail } from './store.mjs'
import { DEFAULT_PRODUCT } from './management.mjs'
import { Mailer } from './mail.mjs'
import { Readable,Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const equal = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y) }
const html = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const requestBaseUrl = request => {
  if (process.env.AUTHORITY_PUBLIC_URL) return new URL(process.env.AUTHORITY_PUBLIC_URL).origin
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',', 1)[0].trim().toLowerCase()
  const protocol = forwardedProto === 'https' ? 'https' : 'http'
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',', 1)[0].trim()
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return ''
  return `${protocol}://${host}`
}
const releaseNotesPage = (productId, release) => `<main><p class="eyebrow">CANGSHUO · RELEASE NOTES</p><h1>软件正式版 ${html(release.version)}</h1><p class="meta">软件 ${html(productId)} · 发布于 ${html(release.published_at)}</p><section><h2>更新说明</h2><pre>${html(release.notes)}</pre></section><section><h2>更新内容</h2>${release.items.length ? `<ul>${release.items.map(item=>`<li><strong>${html(item.name)}</strong>${item.required?' <span class="tag">必要更新</span>':''}${item.description?`<p>${html(item.description)}</p>`:''}</li>`).join('')}</ul>` : '<p>此版本暂未登记可选更新内容。</p>'}</section><p class="foot">此页由授权运营中心提供。</p></main>`
export function createAuthorityServer(store, { secureCookie = false, staticDirectory, allowedOrigins = [] } = {}) {
  const mailer = new Mailer(store)
  const attempts = new Map()
  const trustedOrigins = new Set(allowedOrigins.map(value => { try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(); return url.origin } catch { fail('后台允许来源配置格式错误') } }))
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
          if (!['http:', 'https:'].includes(origin.protocol)) fail('请求来源不匹配', 403)
          if (trustedOrigins.size) {
            if (!trustedOrigins.has(origin.origin)) fail('请求来源不匹配', 403)
          } else {
            const forwarded = String(request.headers['x-forwarded-host'] || '').split(',', 1)[0].trim()
            const expectedHost = forwarded || request.headers.host
            if (!expectedHost || origin.host !== expectedHost) fail('请求来源不匹配', 403)
          }
        }
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) fail('请求必须为 JSON', 415)
        let size = 0, chunks = []
        for await (const chunk of request) { size += chunk.length; if (size > 65536) fail('请求内容过大', 413); chunks.push(chunk) }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { fail('JSON 格式不正确') }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求内容须为对象')
      }
      if (route === '/health' && method === 'GET') return json({ ok: true, service: 'cangshuo-detla-authorize' })
      let publicMatch = route.match(/^\/public\/release-notes\/([\w-]+)\/([^/]+)$/)
      if (publicMatch && method === 'GET') {
        const productId=publicMatch[1],version=decodeURIComponent(publicMatch[2]),release=store.releaseService.publicNotes(productId,version)
        response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正式版 ${html(release.version)} · 发布说明</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#20293a;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(860px,calc(100% - 32px));margin:42px auto;padding:clamp(24px,5vw,48px);background:#fff;border:1px solid #dfe4ec;border-radius:18px;box-shadow:0 16px 50px #26364b12}.eyebrow{color:#66758a;font-size:12px;letter-spacing:.14em}h1{margin:6px 0 8px;font-size:clamp(26px,5vw,38px)}h2{margin:28px 0 12px;font-size:19px}.meta{color:#69778c;margin:0 0 26px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:20px;background:#f7f8fb;border-left:4px solid #2f65eb;border-radius:8px;font:inherit}ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}li{padding:16px;border:1px solid #e1e6ef;border-radius:10px}li p{margin:5px 0 0;color:#66758a}.tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:#fff3d6;color:#8b5c00;font-size:12px}.foot{margin-top:32px;color:#8190a4;font-size:13px}@media(max-width:560px){main{margin:16px auto;border-radius:12px}}</style></head><body>${releaseNotesPage(productId,release)}</body></html>`)
      }
      if (route === '/api/client/report' && method === 'POST') {
        const claims=store.reportVersion(body.license, body.version)
        store.management.updateNotification(claims.instanceId,body.updateResult)
        const productId=JSON.parse(Buffer.from(claims.project.payload,'base64url')).productId
        return json({...claims,updates:store.management.clientUpdates(productId,body.version,requestBaseUrl(request) || undefined),modules:store.management.clientModules(productId)})
      }
      if(route==='/api/client/update-plan' && method==='POST')return json(store.releaseService.plan(body))
      if(route==='/api/client/artifact' && method==='POST') {
        const {result,size}=await store.releaseService.artifact(body);let bytes=0
        response.writeHead(200,{'Content-Type':'application/zip','Content-Length':String(size)})
        await pipeline(Readable.fromWeb(result.body),new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>size?new Error('Artifact too large'):null,chunk)}}),response)
        return
      }
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
        if (route === '/api/public-key' && method === 'GET') return json({ publicKey: store.publicKey, format: 'delta-license-v1', minimumClientVersion: '1.2.0' })
        if (route === '/api/customers' && method === 'POST') return json(store.createCustomer(body, session.username), 201)
        if (route === '/api/instances' && method === 'POST') return json(store.createInstance(body, session.username), 201)
        if (route === '/api/entitlements' && method === 'GET') return json(store.listEntitlements())
        if (route === '/api/entitlements' && method === 'POST') return json(store.createEntitlement(body, session.username), 201)
        if (route === '/api/orders/preview' && method === 'GET') return json(store.orderPreview(url.searchParams.get('instanceId'), url.searchParams.get('moduleId')))
        if (route === '/api/orders' && method === 'POST') return json(store.createOrder(body, session.username), 201)
        if (route === '/api/releases' && method === 'POST') return json(store.releaseService.create(body, session.username), 201)
        if (route === '/api/products' && method === 'POST') return json(store.management.saveProduct(null,body,session.username),201)
        if (route === '/api/modules' && method === 'POST') return json(store.management.saveModule(body,session.username),201)
        if (route === '/api/projects' && method === 'POST') return json(store.management.saveProject(null,body,session.username),201)
        if (route === '/api/mail/settings' && method === 'PUT') return json(store.management.saveMailSettings(body,session.username))
        let match
        if ((match = route.match(/^\/api\/entitlements\/([^/]+)\/([^/]+)$/)) && method === 'PUT') return json(store.updateEntitlement(decodeURIComponent(match[1]),decodeURIComponent(match[2]),body,session.username))
        if ((match = route.match(/^\/api\/entitlements\/([^/]+)\/([^/]+)$/)) && method === 'DELETE') return json(store.deleteEntitlement(decodeURIComponent(match[1]),decodeURIComponent(match[2]),session.username))
        if ((match = route.match(/^\/api\/payments\/([\w-]+)$/)) && method === 'PUT') return json(store.management.savePaymentProvider(match[1],body,session.username))
        if (route === '/api/payment-keys/upload' && method === 'POST') return json(store.management.uploadPaymentKey(body,session.username),201)
        if (route === '/api/mail/test' && method === 'POST') return json(mailer.test(body,session.username))
        if ((match=route.match(/^\/api\/products\/([\w-]+)$/)) && method==='PUT') return json(store.management.saveProduct(match[1],body,session.username))
        if ((match=route.match(/^\/api\/customers\/([\w-]+)$/)) && method==='PUT') return json(store.updateCustomer(match[1],body,session.username))
        if ((match=route.match(/^\/api\/customers\/([\w-]+)$/)) && method==='DELETE') return json(store.deleteCustomer(match[1],session.username))
        if ((match=route.match(/^\/api\/projects\/([a-f\d-]+)$/)) && method==='PUT') return json(store.management.saveProject(match[1],body,session.username))
        if ((match=route.match(/^\/api\/instances\/([a-f\d-]+)\/identity$/)) && method==='GET') return json(store.management.identity(match[1],session.username))
        if ((match=route.match(/^\/api\/products\/([\w-]+)\/sync$/)) && method==='POST') return json(await store.releaseService.sync(match[1],true))
        if ((match=route.match(/^\/api\/mail\/([a-f\d-]+)\/retry$/)) && method==='POST') return json(mailer.retry(match[1],session.username))
        if ((match=route.match(/^\/api\/products\/([\w-]+)\/releases\/([^/]+)\/items$/)) && method==='PUT') return json(store.releaseService.configureItems(match[1],decodeURIComponent(match[2]),body,session.username))
        if ((match = route.match(/^\/api\/instances\/([a-f\d-]+)$/)) && method === 'PUT') return json(store.updateInstance(match[1], body, session.username))
        if ((match = route.match(/^\/api\/modules\/([\w-]+)$/)) && method === 'PUT') return json(store.updateModule(match[1], body, session.username))
        if ((match = route.match(/^\/api\/modules\/([\w-]+)$/)) && method === 'DELETE') return json(store.deleteModule(match[1], session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/paid$/)) && method === 'POST') return json(store.markPaid(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/cancel$/)) && method === 'POST') return json(store.cancelOrder(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/maintenance$/)) && method === 'POST') return json(store.grantMaintenance(match[1], body, session.username))
        if ((match = route.match(/^\/api\/orders\/([a-f\d-]+)\/issue$/)) && method === 'POST') return json(store.issue(match[1], session.username))
        if ((match = route.match(/^\/api\/licenses\/([a-f\d-]+)$/)) && method === 'GET') return json(store.license(match[1]))
        if ((match = route.match(/^\/api\/releases\/([^/]+)\/publish$/)) && method === 'POST') return json(store.releaseService.publish(body.productId||DEFAULT_PRODUCT,decodeURIComponent(match[1]), session.username))
        fail('接口不存在', 404)
      }
      if (method !== 'GET' || !staticDirectory) fail('资源不存在', 404)
      const pathname = decodeURIComponent(route)
      if (pathname.split('/').some(segment => segment.startsWith('.'))) fail('资源不存在', 404)
      const root = path.resolve(staticDirectory), candidate = path.resolve(root, '.' + pathname)
      if (!candidate.startsWith(root + path.sep) && candidate !== root) fail('资源不存在', 404)
      let target = candidate
      try { if (!(await stat(target)).isFile()) target = path.join(root, 'index.html') } catch { if(path.extname(pathname))fail('资源不存在，请刷新页面重试',404);target = path.join(root, 'index.html') }
      const extension = path.extname(target), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
      if (!types[extension]) fail('资源不存在', 404)
      if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|svg|png|jpg)$/.test(pathname)) response.setHeader('Cache-Control','public, max-age=31536000, immutable')
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
