import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fail } from './store.mjs'
import { packageMethods, packageOfficialContext, prepayPackageOfficial, renderPackageCheckout, validatePackageNotification } from './package-checkout.mjs'

export class SmsPackagePaymentService {
  constructor(store, { sms, payments }) {
    this.store = store
    this.sms = sms
    this.payments = payments
    this.hash = value => createHash('sha256').update(value).digest('hex')
  }

  async createCheckout(instanceId, packageId, baseUrl) {
    if (!this.sms) fail('短信套餐服务未配置', 503)
    const order = this.sms.createPackageOrder(instanceId, packageId, 'client')
    if (order.status === 'GRANTED') fail('该套餐已经发放，请不要重复购买', 409)
    const provider = this.store.db.prepare('SELECT p.payment_provider,p.payment_methods,pay.enabled,pay.methods FROM sms_package_orders o JOIN projects p ON p.id=o.project_id LEFT JOIN payment_providers pay ON pay.id=p.payment_provider WHERE o.id=?').get(order.id)
    if (!provider?.payment_provider || provider.enabled !== 1) fail('授权中心尚未启用可用于套餐购买的支付通道', 503)
    const methods = packageMethods(provider.methods, provider.payment_methods, this.payments)
    if (!methods.length) fail('套餐购买需在授权中心和项目中启用公众号支付或微信 Native', 503)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + 30 * 60 * 1000
    this.store.db.prepare('INSERT INTO sms_package_checkout_sessions(token_hash,package_order_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(this.hash(token), order.id, expiresAt, new Date().toISOString())
    return { checkoutUrl: new URL('/pay/sms-package/' + token, baseUrl).href, methods, orderId: order.id, packageName: order.product.name, amountCents: order.amount_cents }
  }

  summary(token) {
    const row = this.store.db.prepare('SELECT s.token_hash,s.expires_at,o.id AS order_id,o.project_id,o.package_product_id,o.amount_cents,o.status,o.paid_at,o.granted_at,o.package_name,o.message_count,o.validity_days,pr.name AS project_name,c.name AS customer_name,pr.payment_methods AS project_methods,pay.enabled AS provider_enabled,pay.methods AS provider_methods FROM sms_package_checkout_sessions s JOIN sms_package_orders o ON o.id=s.package_order_id JOIN projects pr ON pr.id=o.project_id JOIN customers c ON c.id=pr.customer_id LEFT JOIN payment_providers pay ON pay.id=pr.payment_provider WHERE s.token_hash=?')
      .get(this.hash(this.payments.validateToken(token)))
    if (!row) fail('套餐支付链接不存在或已失效', 404)
    if (row.expires_at <= Date.now()) fail('套餐支付链接已过期，请重新发起购买', 410)
    let methods = []
    try {
      if (row.provider_enabled === 1) methods = packageMethods(row.provider_methods, row.project_methods, this.payments)
    } catch {}
    const paymentReady = methods.length > 0
    return { orderId: row.order_id, packageName: row.package_name, amountCents: row.amount_cents, messageCount: row.message_count, validityDays: row.validity_days, projectName: row.project_name, customerName: row.customer_name, status: row.granted_at ? 'GRANTED' : row.status, paidAt: row.paid_at, grantedAt: row.granted_at, expiresAt: new Date(row.expires_at).toISOString(), methods, paymentReady }
  }

  context(token) {
    const summary = this.summary(token)
    if (summary.status === 'GRANTED') return { summary, row: null, payment: null }
    if (!['UNPAID', 'PAID'].includes(summary.status)) fail('套餐订单状态不能支付', 409)
    const row = this.store.db.prepare('SELECT s.*,o.id AS order_id,o.amount_cents,o.status FROM sms_package_checkout_sessions s JOIN sms_package_orders o ON o.id=s.package_order_id WHERE s.token_hash=?')
      .get(this.hash(this.payments.validateToken(token)))
    const payment = this.store.db.prepare('SELECT * FROM sms_package_payments WHERE package_order_id=?').get(row.order_id)
    return { summary, row, payment }
  }

  async prepay(token) {
    const context = this.context(token)
    if (context.summary.status === 'GRANTED') return null
    if (context.summary.status === 'PAID') fail('套餐已收款，正在确认发放，请勿再次支付', 409)
    if (!context.summary.methods.includes('NATIVE')) fail('短信套餐扫码支付未启用', 503)
    const config = this.payments.wechatConfig(true)
    let payment = context.payment
    if (!payment) {
      const outTradeNo = 'SMSPKG' + randomUUID().replaceAll('-', '').slice(0, 26)
      payment = { id: randomUUID(), package_order_id: context.row.order_id, out_trade_no: outTradeNo, amount_cents: context.row.amount_cents, method: 'NATIVE', status: 'UNPAID', created_at: new Date().toISOString() }
      this.store.db.prepare('INSERT INTO sms_package_payments(id,package_order_id,out_trade_no,method,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(payment.id, payment.package_order_id, payment.out_trade_no, 'NATIVE', payment.amount_cents, 'UNPAID', new Date().toISOString())
    }
    if (payment.method !== 'NATIVE') fail('该套餐订单已选择其他支付方式', 409)
    if (payment.prepay_id && Date.now() - Date.parse(payment.created_at) < 2 * 3600000) return { method: 'NATIVE', codeUrl: payment.prepay_id }
    const data = await this.payments.wechatRequest('POST', '/v3/pay/transactions/native', {
      appid: config.appId || config.officialAppId,
      mchid: config.merchantId,
      description: ('短信套餐 · ' + context.summary.packageName).slice(0, 120),
      out_trade_no: payment.out_trade_no,
      notify_url: config.notifyUrl,
      amount: { total: payment.amount_cents, currency: 'CNY' }
    })
    if (!data.code_url) fail('微信支付未返回二维码地址', 502)
    const updated = this.store.db.prepare("UPDATE sms_package_payments SET prepay_id=?,status='PREPAY' WHERE id=? AND status IN ('UNPAID','PREPAY')").run(data.code_url, payment.id)
    if (!updated.changes) return null
    return { method: 'NATIVE', codeUrl: data.code_url }
  }

  officialContext(token) { return packageOfficialContext(this, token) }

  prepayOfficial(token, openid) { return prepayPackageOfficial(this, token, openid, 'sms', '短信套餐') }

  page(token, request, baseUrl) { return renderPackageCheckout(this, token, request, baseUrl, 'sms') }

  async notification(transaction, config) {
    return this.store.transaction(() => {
      const payment = this.store.db.prepare('SELECT p.*,o.amount_cents AS order_amount,o.status AS order_status,o.granted_at FROM sms_package_payments p JOIN sms_package_orders o ON o.id=p.package_order_id WHERE p.out_trade_no=?').get(transaction.out_trade_no)
      if (!payment) return null
      validatePackageNotification(transaction, payment, config)
      if (!transaction.transaction_id || transaction.transaction_id.length > 128) fail('微信支付交易号无效', 409)
      if (payment.status === 'PAID') {
        if (payment.transaction_id !== transaction.transaction_id) fail('微信支付交易号冲突', 409)
        if (payment.order_status === 'GRANTED' || payment.granted_at) return { paid: true, smsPackage: true, orderId: payment.package_order_id, idempotent: true }
      } else {
        this.store.db.prepare("UPDATE sms_package_payments SET status='PAID',transaction_id=?,paid_at=? WHERE id=?").run(transaction.transaction_id, new Date().toISOString(), payment.id)
      }
      this.sms.markPackagePaid(payment.package_order_id, { transactionId: transaction.transaction_id, amountCents: payment.order_amount, reference: transaction.transaction_id })
      return { paid: true, smsPackage: true, orderId: payment.package_order_id }
    })
  }
}
