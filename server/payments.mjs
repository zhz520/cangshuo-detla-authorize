import { createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, X509Certificate } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import { compareVersions, fail, identifier, text } from './store.mjs'

const API_BASE = 'https://api.mch.weixin.qq.com'
const CHECKOUT_FORMAT = 'cangshuo-checkout-v1'
const ALLOWED_METHODS = new Set(['OFFICIAL','NATIVE','H5'])
const OFFICIAL_CALLBACK_PATH = '/api/pay/wx/oauth-callback'
const hash = value => createHash('sha256').update(value).digest('hex')
const html = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const iso = ms => ms == null ? null : new Date(ms).toISOString()

export class PaymentService {
  constructor(store, { fetcher = fetch, qr = QRCode } = {}) {
    this.store = store; this.fetcher = fetcher; this.qr = qr
    this.platformCertificates = new Map(); this.certificateExpiresAt = 0; this.certificateLoading = null
  }

  async createCheckout(body, baseUrl) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('购买请求格式不正确')
    const moduleId = identifier(body.moduleId, '功能编号')
    const version = text(body.version, '客户端版本', 80)
    compareVersions(version, version)
    const { instance } = this.store.verifyClientLicense(body.license)
    const provider = this.store.db.prepare(`SELECT p.payment_provider,p.payment_methods,pay.enabled,pay.methods
      FROM instances i JOIN projects p ON p.id=i.project_id LEFT JOIN payment_providers pay ON pay.id=p.payment_provider WHERE i.id=?`).get(instance.id)
    if (!provider?.payment_provider || provider.enabled !== 1) fail('授权中心尚未启用可用于购买功能的支付通道', 503)
    const methods = JSON.parse(provider.payment_methods || '[]').filter(method => JSON.parse(provider.methods || '[]').includes(method) && ALLOWED_METHODS.has(method))
    if (!methods.length) fail('当前项目没有启用可在授权中心收款页使用的支付方式', 503)
    const wechat = this.wechatConfig(true)
    this.ensureMethodsConfigured(wechat, methods)

    let open = this.store.openOrder(instance.id, moduleId)
    let order
    if (open) {
      order = this.store.db.prepare('SELECT * FROM orders WHERE id=?').get(open.id)
      if (order.status === 'CANCELLED') { open = null; order = null }
    }
    if (!order) {
      const created = this.store.createOrder({ instanceId: instance.id, moduleId }, 'client')
      order = this.store.db.prepare('SELECT * FROM orders WHERE id=?').get(created.id)
    } else if (order.status === 'PAID' && !order.granted_at) {
      this.fulfill(order.id)
    }
    if (order.amount_cents < 1) fail('该功能当前无需在线支付，请由运营人员处理授权', 409)
    const token = this.store.createCheckoutToken(order.id)
    const checkoutUrl = new URL(`/pay/${token.token}`, baseUrl).href
    const checkout = this.store.management.signed(CHECKOUT_FORMAT, {
      customerId: instance.customer_id, instanceId: instance.id, moduleId, orderId: order.id,
      amountCents: order.amount_cents, version, checkoutUrl, expiresAt: token.expiresAt, issuedAt: new Date().toISOString()
    })
    return { checkout, methods, orderId: order.id }
  }

  summary(token) {
    const row = this.store.checkoutSession(hash(this.validateToken(token)))
    if (!row) fail('支付链接不存在或已失效', 404)
    if (row.expires_at <= Date.now()) fail('支付链接已过期，请返回客户端重新发起购买', 410)
    if (row.order_status === 'PAID' && !row.granted_at) this.fulfill(row.order_id)
    let paymentReady=false
    try { this.wechatConfig(true); paymentReady=true } catch {}
    const selected = JSON.parse(row.payment_methods || '[]')
    const enabled = row.provider_enabled === 1 ? JSON.parse(row.provider_methods || '[]') : []
    const methods = selected.filter(method => enabled.includes(method) && ALLOWED_METHODS.has(method))
    return {
      orderId: row.order_id, moduleName: row.module_name, moduleDescription: row.module_description,
      customerName: row.customer_name, instanceName: row.instance_name, amountCents: row.amount_cents,
      termDays: row.term_days, validFrom: row.valid_from, validUntil: row.valid_until,
      status: row.granted_at ? 'GRANTED' : row.order_status, paidAt: row.paid_at, grantedAt: row.granted_at,
      expiresAt: iso(row.expires_at), methods, paymentReady: methods.length > 0 && paymentReady
    }
  }

  async page(token, request, baseUrl) {
    let summary
    try { summary = this.summary(token) } catch (error) { return this.renderMessage(error.message || '支付链接无效') }
    if (summary.status === 'GRANTED') return this.renderPaid(summary)
    if (summary.status === 'CANCELLED') return this.renderMessage('订单已取消，请返回客户端重新下单')
    if (!summary.paymentReady) return this.renderMessage('授权中心尚未完成微信支付配置，请联系维护人员')
    const wechatBrowser = /MicroMessenger/i.test(request.headers['user-agent'] || '')
    const canOfficial = summary.methods.includes('OFFICIAL')
    const canNative = summary.methods.includes('NATIVE')
    const canH5 = summary.methods.includes('H5')
    const openInWechatUrl = `${baseUrl}/pay/${encodeURIComponent(token)}`
    const scanSvg = canOfficial && !wechatBrowser ? await this.qr.toString(openInWechatUrl, { type: 'svg', margin: 1, width: 230, color: { dark: '#111827', light: '#ffffff' } }) : ''
    const payButton = canOfficial && wechatBrowser ? `<a class="primary" href="/api/pay/wx/oauth?token=${encodeURIComponent(token)}">微信支付</a>` : ''
    const h5Button = canH5 && !wechatBrowser ? `<button class="primary" id="h5-pay">继续前往微信支付</button>` : ''
    const nativeButton = canNative ? `<button class="secondary" id="native-pay">显示微信扫码支付</button>` : ''
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>功能授权收款 · 沧烁授权中心</title><style>${this.css()}</style></head><body><main><p class="eyebrow">CANGSHUO · LICENSED FEATURE</p><h1>功能授权收款</h1><section class="order"><div><span>功能</span><strong>${html(summary.moduleName)}</strong></div><div><span>客户</span><strong>${html(summary.customerName)} · ${html(summary.instanceName)}</strong></div><div><span>支付金额</span><strong class="price">¥${(summary.amountCents/100).toFixed(2)}</strong></div><div><span>授权周期</span><strong>${summary.termDays} 天</strong></div><div><span>授权至</span><strong>${html(this.time(summary.validUntil))}</strong></div></section><section class="pay-box"><h2>选择支付方式</h2>${scanSvg ? `<div class="scan">${scanSvg}<p>使用微信扫码，在微信中打开后继续支付</p></div>` : ''}${payButton}${h5Button}${nativeButton}<p id="message" class="message">付款完成后，授权会自动开通；可返回客户端刷新功能商城。</p><div id="native-qr" class="scan hidden"></div></section><p class="foot">支付由沧烁授权中心统一收取，款项进入授权中心微信商户。</p></main><script>const token=${JSON.stringify(token)};const statusUrl='/api/checkout/'+encodeURIComponent(token);const poll=async()=>{try{const r=await fetch(statusUrl,{cache:'no-store'});const j=await r.json();if(j.status==='GRANTED'){location.href='/pay/'+encodeURIComponent(token)+'?paid=1';return}if(j.status==='CANCELLED'){document.getElementById('message').textContent='订单已取消，请返回客户端重新下单'}}catch{}};setInterval(poll,3000);const h5=document.getElementById('h5-pay');if(h5)h5.onclick=async()=>{h5.disabled=true;try{const r=await fetch(statusUrl+'/prepay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:'H5'})});const j=await r.json();if(!r.ok)throw new Error(j.message);location.href=j.h5Url}catch(e){document.getElementById('message').textContent=e.message;h5.disabled=false}};const native=document.getElementById('native-pay');if(native)native.onclick=async()=>{native.disabled=true;try{const r=await fetch(statusUrl+'/native',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.message);document.getElementById('native-qr').innerHTML=j.svg;document.getElementById('native-qr').classList.remove('hidden')}catch(e){document.getElementById('message').textContent=e.message;native.disabled=false}};</script></body></html>`
  }

  async nativeQr(token) {
    const codeUrl = await this.prepayNative(token)
    return this.qr.toString(codeUrl, { type: 'svg', margin: 1, width: 230, color: { dark: '#111827', light: '#ffffff' } })
  }

  oauthUrl(token) {
    const config = this.wechatConfig(true)
    if (!config.methods.includes('OFFICIAL')) fail('公众号支付未启用', 503)
    const redirect = new URL(OFFICIAL_CALLBACK_PATH, config.origin)
    redirect.searchParams.set('token', token)
    const query = new URLSearchParams({ appid: config.officialAppId, redirect_uri: redirect.href, response_type: 'code', scope: 'snsapi_base', state: token })
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${query}#wechat_redirect`
  }

  async oauthCallback(token, code) {
    if (!code || code.length > 256) fail('微信授权失败', 400)
    const config = this.wechatConfig(true)
    const query = new URLSearchParams({ appid: config.officialAppId, secret: config.officialAppSecret, code, grant_type: 'authorization_code' })
    const response = await this.fetcher(`https://api.weixin.qq.com/sns/oauth2/access_token?${query}`)
    if (!response.ok) fail('微信网页授权失败', 502)
    const result = await response.json()
    if (result.errcode || !result.openid) fail(`微信网页授权失败：${result.errmsg || result.errcode || '未返回 OpenID'}`, 502)
    const prepay = await this.prepayOfficial(token, result.openid)
    return this.renderJsapi(prepay, token, config.origin)
  }

  async prepay(token, method, { openid = null, clientIp = '' } = {}) {
    if (method === 'OFFICIAL') throw Object.assign(new Error('请通过微信网页授权后支付'), { oauthRequired: true })
    if (method === 'NATIVE') return { method, codeUrl: await this.prepayNative(token) }
    if (method === 'H5') return { method, h5Url: await this.prepayH5(token, clientIp) }
    fail('不支持的支付方式', 400)
  }

  async prepayOfficial(token, openid) {
    const context = this.paymentContext(token, 'OFFICIAL')
    if (context.payment?.status === 'PAID') return this.jsapiParamsFromExisting(context)
    const config = this.wechatConfig(true)
    const payment = this.store.onlinePayment(context.row.order_id, 'OFFICIAL', context.row.amount_cents, openid)
    if (payment.method !== 'OFFICIAL') fail('该订单已选择其他支付方式，请返回后重新下单', 409)
    if (payment.prepay_id) return this.jsapiParams(config.officialAppId, payment.prepay_id, config.privateKey)
    const data = await this.wechatRequest('POST', '/v3/pay/transactions/jsapi', {
      appid: config.officialAppId, mchid: config.merchantId, description: this.description(context.row),
      out_trade_no: payment.out_trade_no, notify_url: config.notifyUrl,
      amount: { total: context.row.amount_cents, currency: 'CNY' }, payer: { openid }
    })
    if (!data.prepay_id) fail('微信支付未返回预支付编号', 502)
    this.store.saveOnlinePrepay(context.row.order_id, data.prepay_id, 'OFFICIAL', openid)
    return this.jsapiParams(config.officialAppId, data.prepay_id, config.privateKey)
  }

  async prepayNative(token) {
    const context = this.paymentContext(token, 'NATIVE')
    if (context.payment?.status === 'PAID') return null
    const config = this.wechatConfig(true)
    const payment = this.store.onlinePayment(context.row.order_id, 'NATIVE', context.row.amount_cents)
    if (payment.method !== 'NATIVE') fail('该订单已选择其他支付方式，请返回后重新下单', 409)
    if (payment.prepay_id) return payment.prepay_id
    const data = await this.wechatRequest('POST', '/v3/pay/transactions/native', {
      appid: config.appId || config.officialAppId, mchid: config.merchantId, description: this.description(context.row),
      out_trade_no: payment.out_trade_no, notify_url: config.notifyUrl,
      amount: { total: context.row.amount_cents, currency: 'CNY' }
    })
    if (!data.code_url) fail('微信支付未返回二维码地址', 502)
    this.store.saveOnlinePrepay(context.row.order_id, data.code_url, 'NATIVE')
    return data.code_url
  }

  async prepayH5(token, clientIp) {
    const context = this.paymentContext(token, 'H5')
    if (context.payment?.status === 'PAID') return null
    const config = this.wechatConfig(true)
    const payment = this.store.onlinePayment(context.row.order_id, 'H5', context.row.amount_cents)
    if (payment.method !== 'H5') fail('该订单已选择其他支付方式，请返回后重新下单', 409)
    if (payment.prepay_id) return payment.prepay_id
    const ip = String(clientIp || '').replace(/^::ffff:/, '')
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) fail('无法识别微信支付客户端地址', 400)
    const data = await this.wechatRequest('POST', '/v3/pay/transactions/h5', {
      appid: config.appId || config.officialAppId, mchid: config.merchantId, description: this.description(context.row),
      out_trade_no: payment.out_trade_no, notify_url: config.notifyUrl,
      amount: { total: context.row.amount_cents, currency: 'CNY' },
      scene_info: { payer_client_ip: ip, h5_info: { type: config.h5Type || 'WAP', app_name: config.h5AppName || '沧烁授权中心' } }
    })
    if (!data.h5_url) fail('微信支付未返回 H5 支付地址', 502)
    this.store.saveOnlinePrepay(context.row.order_id, data.h5_url, 'H5')
    return data.h5_url
  }

  async notification(headers, rawBody) {
    const config = this.wechatConfig(true,true)
    await this.verifyWechatSignature(headers, rawBody, config)
    let body
    try { body = JSON.parse(rawBody) } catch { fail('微信通知格式错误', 400) }
    if (body.event_type && body.event_type !== 'TRANSACTION.SUCCESS') return { ignored: true, state: body.event_type }
    const resource = body.resource
    if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext || !resource.nonce) fail('微信通知资源无效', 400)
    const plain = this.decryptResource(resource, config.apiV3Key)
    let transaction
    try { transaction = JSON.parse(plain) } catch { fail('微信支付通知内容无效', 400) }
    if (transaction.trade_state !== 'SUCCESS') return { ignored: true, state: transaction.trade_state }
    const payment = this.store.db.prepare('SELECT p.*,o.amount_cents AS order_amount,m.name FROM online_payments p JOIN orders o ON o.id=p.order_id JOIN modules m ON m.id=o.module_id WHERE p.out_trade_no=?').get(transaction.out_trade_no)
    if (!payment) fail('微信支付通知对应的订单不存在', 404)
    if (payment.status === 'PAID' && payment.transaction_id === transaction.transaction_id) {
      this.fulfill(payment.order_id)
      return { paid: true, orderId: payment.order_id, idempotent: true }
    }
    if (transaction.mchid !== config.merchantId || !([config.officialAppId, config.appId].filter(Boolean).includes(transaction.appid))) fail('微信支付通知商户或 AppID 不匹配', 409)
    if (transaction.amount?.total !== payment.amount_cents || (transaction.amount?.currency && transaction.amount.currency !== 'CNY')) fail('微信支付通知金额不匹配', 409)
    if (!transaction.transaction_id || transaction.transaction_id.length > 128) fail('微信支付交易号无效', 409)
    const confirmed = this.store.confirmOnlinePayment(transaction.out_trade_no, transaction.transaction_id)
    this.fulfill(confirmed.id)
    return { paid: true, orderId: confirmed.id }
  }

  fulfill(orderId) {
    const row = this.store.db.prepare('SELECT status,granted_at FROM orders WHERE id=?').get(orderId)
    if (!row) fail('订单不存在', 404)
    if (row.granted_at) return true
    if (row.status !== 'PAID') return false
    this.store.issue(orderId, 'wechat_pay')
    return true
  }

  paymentContext(token, method) {
    const summary = this.summary(token)
    if (!summary.methods.includes(method)) fail('当前订单未启用该支付方式', 400)
    if (!['UNPAID','PAID'].includes(summary.status)) fail('当前订单状态不能支付', 409)
    const row = this.store.checkoutSession(hash(this.validateToken(token)))
    const payment = this.store.db.prepare('SELECT * FROM online_payments WHERE order_id=?').get(row.order_id)
    return { summary,row,payment }
  }

  async wechatRequest(method, requestPath, body) {
    const config = this.wechatConfig(true)
    const signed = await this.signedWechatFetch(config, method, requestPath, body)
    if (requestPath === '/v3/certificates') {
      await this.refreshCertificates(config)
      return signed.text ? JSON.parse(signed.text) : {}
    }
    await this.verifyWechatSignature(signed.headers, signed.text, config)
    let result = {}
    if (signed.text) try { result = JSON.parse(signed.text) } catch { fail('微信支付返回内容格式错误', 502) }
    if (!signed.response.ok) fail(`微信支付请求失败：${result.message || result.code || signed.response.status}`, 502)
    return result
  }

  async signedWechatFetch(config, method, requestPath, body) {
    const timestamp = Math.floor(Date.now()/1000).toString(), nonce = randomBytes(16).toString('hex'), bodyText = body == null ? '' : JSON.stringify(body)
    const message = `${method}\n${requestPath}\n${timestamp}\n${nonce}\n${bodyText}\n`
    const signature = sign('RSA-SHA256', Buffer.from(message), config.privateKey).toString('base64')
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerialNo}"`
    const response = await this.fetcher(API_BASE + requestPath, { method, headers: { authorization, accept: 'application/json', 'accept-language': 'zh-CN', 'content-type': 'application/json', 'user-agent': 'cangshuo-authority/1.0' }, body: bodyText || undefined })
    const responseText = await response.text()
    return { response, text: responseText, headers: Object.fromEntries(response.headers.entries()) }
  }

  async verifyWechatSignature(headers, body, config) {
    const signature = headers['wechatpay-signature'], timestamp = headers['wechatpay-timestamp'], nonce = headers['wechatpay-nonce'], serial = headers['wechatpay-serial']
    if (!signature || !timestamp || !nonce || !serial || !/^\d{1,12}$/.test(timestamp)) fail('微信支付签名头缺失', 401)
    if (Math.abs(Math.floor(Date.now()/1000) - Number(timestamp)) > 300) fail('微信支付签名时间已过期', 401)
    let publicKey = serial === config.publicKeyId ? config.publicKey : this.platformCertificates.get(serial.toUpperCase())
    if (!publicKey) { await this.refreshCertificates(config); publicKey = this.platformCertificates.get(serial.toUpperCase()) }
    if (!publicKey) fail('微信支付签名证书未知', 401)
    const valid = verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), publicKey, Buffer.from(signature, 'base64'))
    if (!valid) fail('微信支付签名验证失败', 401)
  }

  async refreshCertificates(config) {
    if (this.certificateLoading) return this.certificateLoading
    if (this.platformCertificates.size && Date.now() < this.certificateExpiresAt) return
    this.certificateLoading = (async () => {
      const signed = await this.signedWechatFetch(config, 'GET', '/v3/certificates', null)
      let body
      try { body = JSON.parse(signed.text) } catch { fail('微信支付平台证书响应格式错误', 502) }
      if (!signed.response.ok) fail(`微信支付平台证书获取失败：${body.message || body.code || signed.response.status}`, 502)
      if (!Array.isArray(body.data) || body.data.length > 20) fail('微信支付平台证书列表无效', 502)
      const certificates = new Map(), now=Date.now()
      for (const item of body.data) {
        try {
          const pem = this.decryptResource(item.encrypt_certificate, config.apiV3Key)
          const certificate = new X509Certificate(pem)
          if (Date.parse(certificate.validFrom) > now + 300000 || Date.parse(certificate.validTo) <= now) continue
          certificates.set(certificate.serialNumber.toUpperCase(), certificate.publicKey)
        } catch {}
      }
      const serial = String(signed.headers['wechatpay-serial'] || '').toUpperCase(), key = certificates.get(serial)
      if (!key) fail('微信支付平台证书序列号不匹配', 502)
      const timestamp=signed.headers['wechatpay-timestamp'],nonce=signed.headers['wechatpay-nonce'],signature=signed.headers['wechatpay-signature']
      if (!timestamp || !nonce || !signature || !verify('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${signed.text}\n`),key,Buffer.from(signature,'base64')))fail('微信支付平台证书响应签名无效',502)
      this.platformCertificates = certificates
      this.certificateExpiresAt = now + 11 * 60 * 60 * 1000
    })().finally(() => { this.certificateLoading = null })
    return this.certificateLoading
  }

  decryptResource(resource, apiV3Key) {
    try {
      const ciphertext = Buffer.from(resource.ciphertext, 'base64')
      if (ciphertext.length < 17) throw new Error('short ciphertext')
      const authTag = ciphertext.subarray(ciphertext.length - 16), data = ciphertext.subarray(0, ciphertext.length - 16)
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'))
      decipher.setAuthTag(authTag)
      if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    } catch { fail('微信支付通知解密失败', 400) }
  }

  jsapiParams(appId, prepayId, privateKey) {
    const timeStamp = Math.floor(Date.now()/1000).toString(), nonceStr = randomBytes(16).toString('hex'), packageValue = `prepay_id=${prepayId}`
    const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`
    const paySign = sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64')
    return { appId, timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign }
  }

  jsapiParamsFromExisting(context) {
    if (!context.payment?.prepay_id) fail('支付单已付款，请刷新查看授权', 409)
    const config = this.wechatConfig(true)
    return this.jsapiParams(config.officialAppId, context.payment.prepay_id, config.privateKey)
  }

  wechatConfig(requireInvoice, allowDisabled = false) {
    const row = this.store.db.prepare("SELECT enabled,methods,config FROM payment_providers WHERE id='wechat_pay'").get()
    if (!row) { if (requireInvoice) fail('微信支付通道尚未配置', 503); return { configured: false, methods: [] } }
    let data
    try { data = JSON.parse(row.config || '{}') } catch { if (requireInvoice) fail('微信支付配置格式错误', 503); return { configured: false, methods: [] } }
    const methods = JSON.parse(row.methods || '[]')
    if (!requireInvoice) return { configured: row.enabled === 1, methods }
    if (row.enabled !== 1 && !allowDisabled) fail('微信支付通道已停用', 503)
    const required=['merchantId','apiV3Key','merchantSerialNo','privateKeyPath','publicKeyId','publicKeyPath','notifyUrl']
    if(methods.includes('OFFICIAL'))required.push('officialAppId','officialAppSecret','officialReturnOrigin')
    if(methods.some(method=>['NATIVE','H5'].includes(method)))required.push('appId')
    for (const key of required) if (!data[key]) fail('微信支付配置不完整', 503)
    if (!allowDisabled && !methods.some(method => ALLOWED_METHODS.has(method))) fail('微信支付未启用收款页可用方式', 503)
    const privateKey = createPrivateKey(this.readSecretFile(data.privateKeyPath, 'private'))
    const publicKey = createPublicKey(this.readSecretFile(data.publicKeyPath, 'public'))
    const origin = methods.includes('OFFICIAL') ? new URL(data.officialReturnOrigin) : null
    if (origin && (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash)) fail('微信支付站点 Origin 配置不正确', 503)
    const notify = new URL(data.notifyUrl)
    if (notify.protocol !== 'https:') fail('微信支付回调地址必须为 HTTPS', 503)
    if (notify.pathname !== '/api/pay/wx/notify') fail('微信支付回调地址路径不正确', 503)
    const publicOrigin = process.env.AUTHORITY_PUBLIC_URL ? new URL(process.env.AUTHORITY_PUBLIC_URL).origin : ''
    if (publicOrigin && notify.origin !== publicOrigin) fail('微信支付回调地址必须使用授权中心域名', 503)
    if (publicOrigin && origin && origin.origin !== publicOrigin) fail('公众号支付站点 Origin 必须使用授权中心域名', 503)
    return { configured: true, methods, appId: data.appId || '', officialAppId: data.officialAppId, officialAppSecret: data.officialAppSecret,
      origin: origin?.origin || '', merchantId: data.merchantId, apiV3Key: data.apiV3Key, merchantSerialNo: data.merchantSerialNo,
      publicKeyId: data.publicKeyId, notifyUrl: data.notifyUrl, privateKey, publicKey, h5Type: data.h5Type || 'WAP', h5AppName: data.h5AppName || '沧烁授权中心' }
  }

  readSecretFile(value, kind) {
    if (!this.store.dataDirectory) fail('支付密钥目录不可用', 503)
    const root = path.resolve(this.store.dataDirectory, 'payment-keys', 'wechat'), target = path.resolve(value), relative = path.relative(root, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('支付密钥路径无效', 503)
    const stat = statSync(target); if (!stat.isFile() || stat.size > 32768) fail('支付密钥文件无效', 503)
    const content = readFileSync(target, 'utf8')
    if (kind === 'private' && !content.includes('-----BEGIN PRIVATE KEY-----')) fail('商户私钥文件无效', 503)
    if (kind === 'public' && !content.includes('-----BEGIN PUBLIC KEY-----')) fail('微信支付公钥文件无效', 503)
    return content
  }

  ensureMethodsConfigured(config, methods) {
    if (methods.includes('OFFICIAL') && (!config.officialAppId || !config.officialAppSecret)) fail('公众号支付参数不完整', 503)
    if (methods.some(method => ['NATIVE','H5'].includes(method)) && !config.appId) fail('Native/H5 支付需要配置微信应用 AppID', 503)
  }
  validateToken(token) { if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('支付链接无效', 404); return token }
  description(row) { return (`功能授权 · ${row.module_name}`).slice(0, 120) }
  time(value) { if (!value) return '长期有效'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { hour12: false }) }
  css() { return `*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#172033;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(720px,calc(100% - 28px));margin:34px auto;padding:clamp(22px,5vw,42px);background:#fff;border:1px solid #dfe5ee;border-radius:20px;box-shadow:0 20px 60px #1f29371a}.eyebrow{margin:0;color:#708096;font-size:12px;letter-spacing:.14em}h1{margin:6px 0 24px;font-size:30px}.order{display:grid;gap:10px;padding:18px;background:#f7f9fc;border-radius:14px}.order div{display:flex;justify-content:space-between;gap:20px}.order span{color:#718096}.order strong{text-align:right}.price{font-size:24px;color:#111827}.pay-box{margin-top:22px}.primary,.secondary{display:block;width:100%;padding:13px 18px;margin-top:12px;border-radius:10px;text-align:center;text-decoration:none;font-weight:700}.primary{background:#2563eb;color:#fff}.secondary{background:#fff;color:#1f4f9e;border:1px solid #b9cdec}.scan{display:grid;place-items:center;margin:18px auto;padding:16px;border:1px dashed #cbd5e1;border-radius:14px}.scan svg{width:230px;height:230px}.scan p{text-align:center;color:#64748b}.hidden{display:none}.message{min-height:25px;color:#6b7280}.foot{color:#8a96a8;font-size:13px;text-align:center;margin-top:26px}@media(max-width:520px){.order div{align-items:flex-start;flex-direction:column;gap:2px}.order strong{text-align:left}h1{font-size:25px}}` }
  renderMessage(message) { return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>支付提示</title><style>${this.css()}</style></head><body><main><p class="eyebrow">CANGSHUO · PAYMENT</p><h1>支付暂不可用</h1><p class="message">${html(message)}</p><p class="foot">请返回客户端后重新发起购买。</p></main></body></html>` }
  renderPaid(summary) { return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>支付成功</title><style>${this.css()}</style></head><body><main><p class="eyebrow">CANGSHUO · PAYMENT SUCCESS</p><h1>支付成功，授权已开通</h1><section class="order"><div><span>功能</span><strong>${html(summary.moduleName)}</strong></div><div><span>授权至</span><strong>${html(this.time(summary.validUntil))}</strong></div></section><p class="message">请返回客户端刷新功能商城，再自行启用该功能。</p></main></body></html>` }
  renderJsapi(params,token,origin) { const json = JSON.stringify(params).replaceAll('<','\\u003c'),paymentDirectory=JSON.stringify(`${origin}/api/pay/wx/`).replaceAll('<','\\u003c'); return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>微信支付</title><style>${this.css()}</style></head><body><main><p class="eyebrow">WECHAT PAY</p><h1>正在连接微信支付</h1><p id="message" class="message">请稍候…</p><button class="primary" id="retry">重新发起支付</button></main><script>const params=${json};const token=${JSON.stringify(token)};const paymentDirectory=${paymentDirectory};const message=document.getElementById('message');function invoke(){if(typeof WeixinJSBridge==='undefined'){message.textContent='请在微信客户端中打开本页面完成支付';return}WeixinJSBridge.invoke('getBrandWCPayRequest',params,res=>{const error=String(res.err_msg||'');if(error==='get_brand_wcpay_request:ok'){message.textContent='支付成功，授权处理中…';location.href='/pay/'+encodeURIComponent(token)+'?paid=1'}else if(error==='get_brand_wcpay_request:cancel'){message.textContent='已取消支付，可点击下方重新发起'}else if(/URL.*未注册|url.*unregistered/i.test(error)){message.textContent='微信商户后台尚未登记支付授权目录：'+paymentDirectory}else{message.textContent='支付未完成，请重新发起'}})}document.getElementById('retry').onclick=invoke;if(document.readyState==='complete')invoke();else document.addEventListener('WeixinJSBridgeReady',invoke,false);</script></body></html>` }
}
