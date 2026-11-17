import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fail } from './store.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export class IdentityPackagePaymentService {
  constructor(store, { packages, payments }) {
    this.store = store
    this.packages = packages
    this.payments = payments
  }

  async createCheckout(instanceId, packageId, baseUrl) {
    if (!this.packages) fail('实名核验套餐服务未配置', 503)
    const order = this.packages.createPackageOrder(instanceId, packageId)
    if (order.status === 'GRANTED') fail('该实名核验套餐已经发放，请不要重复购买', 409)
    const provider = this.store.db.prepare('SELECT p.payment_provider,p.payment_methods,pay.enabled,pay.methods FROM identity_package_orders o JOIN instances i ON i.id=o.instance_id JOIN projects p ON p.id=i.project_id LEFT JOIN payment_providers pay ON pay.id=p.payment_provider WHERE o.id=?').get(order.id)
    if (!provider?.payment_provider || provider.enabled !== 1) fail('授权中心尚未启用可用于实名套餐购买的支付通道', 503)
    const methods = JSON.parse(provider.payment_methods || '[]').filter(method => JSON.parse(provider.methods || '[]').includes(method) && method === 'NATIVE')
    if (!methods.length) fail('实名核验套餐购买当前需要启用微信 Native 扫码支付', 503)
    const config = this.payments.wechatConfig(true)
    if (!config.appId && !config.officialAppId) fail('微信支付 AppID 未配置', 503)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + 30 * 60 * 1000
    this.store.db.prepare('INSERT INTO identity_package_checkout_sessions(token_hash,package_order_id,expires_at,created_at) VALUES (?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at').run(hash(token), order.id, expiresAt, new Date().toISOString())
    return { checkoutUrl: new URL('/pay/identity-package/' + token, baseUrl).href, methods: ['NATIVE'], orderId: order.id, packageName: order.product.name, amountCents: order.amount_cents }
  }

  sessionRow(token) {
    return this.store.db.prepare('SELECT s.token_hash,s.expires_at,o.id AS order_id,o.instance_id,o.amount_cents,o.status,o.paid_at,o.granted_at,o.package_name,o.verification_count,o.validity_days,i.project_id,pr.name AS project_name,c.name AS customer_name,pr.payment_methods AS project_methods,pay.enabled AS provider_enabled,pay.methods AS provider_methods FROM identity_package_checkout_sessions s JOIN identity_package_orders o ON o.id=s.package_order_id JOIN instances i ON i.id=o.instance_id JOIN projects pr ON pr.id=i.project_id JOIN customers c ON c.id=i.customer_id LEFT JOIN payment_providers pay ON pay.id=pr.payment_provider WHERE s.token_hash=?')
      .get(hash(this.payments.validateToken(token)))
  }

  summary(token) {
    const row = this.sessionRow(token)
    if (!row) fail('实名套餐支付链接不存在或已失效', 404)
    if (row.expires_at <= Date.now() && row.status !== 'GRANTED') fail('实名套餐支付链接已过期，请重新发起购买', 410)
    const methods = row.provider_enabled === 1 && JSON.parse(row.project_methods || '[]').includes('NATIVE') ? JSON.parse(row.provider_methods || '[]').filter(method => method === 'NATIVE') : []
    let paymentReady = false
    try { this.payments.wechatConfig(true); paymentReady = methods.length > 0 } catch {}
    return { orderId: row.order_id, packageName: row.package_name, amountCents: row.amount_cents, verificationCount: row.verification_count, validityDays: row.validity_days, projectName: row.project_name, customerName: row.customer_name, status: row.granted_at ? 'GRANTED' : row.status, paidAt: row.paid_at, grantedAt: row.granted_at, expiresAt: new Date(row.expires_at).toISOString(), methods, paymentReady }
  }

  context(token) {
    const summary = this.summary(token)
    if (summary.status === 'GRANTED') return { summary, row: null, payment: null }
    if (!['UNPAID', 'PAID'].includes(summary.status)) fail('实名套餐订单状态不能支付', 409)
    const row = this.sessionRow(token)
    const payment = this.store.db.prepare('SELECT * FROM identity_package_payments WHERE package_order_id=?').get(row.order_id)
    return { summary, row, payment }
  }

  async prepay(token) {
    const context = this.context(token)
    if (context.summary.status === 'GRANTED') return null
    if (context.summary.status === 'PAID') fail('套餐已收款，正在确认发放，请勿再次支付', 409)
    if (!context.summary.paymentReady) fail('实名套餐扫码支付未启用', 503)
    const config = this.payments.wechatConfig(true)
    let payment = context.payment
    if (!payment) {
      const outTradeNo = 'IDPKG' + randomUUID().replaceAll('-', '').slice(0, 26)
      payment = { id: randomUUID(), package_order_id: context.row.order_id, out_trade_no: outTradeNo, amount_cents: context.row.amount_cents, method: 'NATIVE', status: 'UNPAID', created_at: new Date().toISOString() }
      this.store.db.prepare('INSERT INTO identity_package_payments(id,package_order_id,out_trade_no,method,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(payment.id, payment.package_order_id, payment.out_trade_no, 'NATIVE', payment.amount_cents, 'UNPAID', payment.created_at)
    }
    if (payment.method !== 'NATIVE') fail('该实名套餐订单已选择其他支付方式', 409)
    if (payment.prepay_id && Date.now() - Date.parse(payment.created_at) < 2 * 3600000) return { method: 'NATIVE', codeUrl: payment.prepay_id }
    const data = await this.payments.wechatRequest('POST', '/v3/pay/transactions/native', {
      appid: config.appId || config.officialAppId,
      mchid: config.merchantId,
      description: ('实名核验套餐 · ' + context.summary.packageName).slice(0, 120),
      out_trade_no: payment.out_trade_no,
      notify_url: config.notifyUrl,
      amount: { total: payment.amount_cents, currency: 'CNY' }
    })
    if (!data.code_url) fail('微信支付未返回二维码地址', 502)
    const updated = this.store.db.prepare("UPDATE identity_package_payments SET prepay_id=?,status='PREPAY' WHERE id=? AND status IN ('UNPAID','PREPAY')").run(data.code_url, payment.id)
    if (!updated.changes) return null
    return { method: 'NATIVE', codeUrl: data.code_url }
  }

  async page(token) {
    let summary
    try { summary = this.summary(token) } catch (error) { return this.payments.renderMessage(error.message || '实名套餐支付链接无效') }
    if (summary.status === 'GRANTED') {
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>套餐支付成功</title><style>' + this.payments.css() + '</style></head><body><main><p class="eyebrow">CANGSHUO · IDENTITY PACKAGE</p><h1>支付成功，套餐已发放</h1><section class="order"><div><span>套餐</span><strong>' + escapeHtml(summary.packageName) + '</strong></div><div><span>核验次数</span><strong>' + summary.verificationCount + ' 次</strong></div></section><p class="message">请返回客户后台刷新实名核验服务页面。</p></main></body></html>'
    }
    if (!summary.paymentReady) return this.payments.renderMessage('授权中心尚未完成微信 Native 支付配置，请联系维护人员')
    let codeUrl
    try { codeUrl = (await this.prepay(token))?.codeUrl } catch (error) { return this.payments.renderMessage(error.message || '微信支付暂不可用') }
    if (!codeUrl) return this.payments.renderMessage('实名套餐支付暂不可用')
    const scanSvg = await this.payments.qr.toString(codeUrl, { type: 'svg', margin: 1, width: 230, color: { dark: '#111827', light: '#ffffff' } })
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实名核验套餐收款 · 沧烁授权中心</title><style>' + this.payments.css() + '</style></head><body><main><p class="eyebrow">CANGSHUO · IDENTITY PACKAGE</p><h1>实名核验套餐收款</h1><section class="order"><div><span>套餐</span><strong>' + escapeHtml(summary.packageName) + '</strong></div><div><span>客户</span><strong>' + escapeHtml(summary.customerName) + ' · ' + escapeHtml(summary.projectName) + '</strong></div><div><span>支付金额</span><strong class="price">¥' + (summary.amountCents / 100).toFixed(2) + '</strong></div><div><span>核验次数</span><strong>' + summary.verificationCount + ' 次</strong></div></section><section class="pay-box"><h2>微信扫码支付</h2><div class="scan">' + scanSvg + '<p>使用微信扫码完成支付</p></div><p id="message" class="message">付款完成后套餐会自动发放。</p></section><p class="foot">支付由沧烁授权中心统一收取。</p></main><script>const token=' + JSON.stringify(token) + ';setInterval(async()=>{try{const r=await fetch("/api/checkout/identity-package/"+encodeURIComponent(token),{cache:"no-store"});const j=await r.json();if(j.status==="GRANTED")location.reload()}catch{}},3000);</script></body></html>'
  }

  async notification(transaction, config) {
    return this.store.transaction(() => {
      const payment = this.store.db.prepare('SELECT p.*,o.amount_cents AS order_amount,o.status AS order_status,o.granted_at FROM identity_package_payments p JOIN identity_package_orders o ON o.id=p.package_order_id WHERE p.out_trade_no=?').get(transaction.out_trade_no)
      if (!payment) return null
      if (transaction.mchid !== config.merchantId || !([config.officialAppId, config.appId].filter(Boolean).includes(transaction.appid))) fail('微信支付通知商户或 AppID 不匹配', 409)
      if (transaction.amount?.total !== payment.order_amount || (transaction.amount?.currency && transaction.amount.currency !== 'CNY')) fail('微信支付通知金额不匹配', 409)
      if (!transaction.transaction_id || transaction.transaction_id.length > 128) fail('微信支付交易号无效', 409)
      if (payment.status === 'PAID') {
        if (payment.transaction_id !== transaction.transaction_id) fail('微信支付交易号冲突', 409)
        if (payment.order_status === 'GRANTED' || payment.granted_at) return { paid: true, identityPackage: true, orderId: payment.package_order_id, idempotent: true }
      } else {
        this.store.db.prepare("UPDATE identity_package_payments SET status='PAID',transaction_id=?,paid_at=? WHERE id=?").run(transaction.transaction_id, new Date().toISOString(), payment.id)
      }
      this.packages.markPackagePaid(payment.package_order_id, { transactionId: transaction.transaction_id, amountCents: payment.order_amount, reference: transaction.transaction_id })
      return { paid: true, identityPackage: true, orderId: payment.package_order_id }
    })
  }
}
