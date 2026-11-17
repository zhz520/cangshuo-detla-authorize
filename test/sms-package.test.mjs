import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { SmsPackagePaymentService } from '../server/sms-payments.mjs'
import { IdentityPackageService } from '../server/identity-packages.mjs'
import { IdentityPackagePaymentService } from '../server/identity-payments.mjs'
import { UsageBilling } from '../server/usage.mjs'
import { PaymentService } from '../server/payments.mjs'
import { createAuthorityServer } from '../server/http.mjs'
import { DatabaseSync } from 'node:sqlite'
import { ensureIdentityPackagePaymentOpenid } from '../server/migrations/identity-package-payment-openid.mjs'

test('identity package migration is repeatable and preserves existing Native payments', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec("CREATE TABLE identity_package_payments (id TEXT PRIMARY KEY, method TEXT NOT NULL); INSERT INTO identity_package_payments VALUES ('existing', 'NATIVE')")
    ensureIdentityPackagePaymentOpenid(db)
    ensureIdentityPackagePaymentOpenid(db)
    const row = db.prepare('SELECT method, openid FROM identity_package_payments WHERE id=?').get('existing')
    assert.equal(row.method, 'NATIVE')
    assert.equal(row.openid, null)
  } finally { db.close() }
})

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'pkg-customer', name: '套餐客户' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'pkg-customer', productId: 'detla', name: '套餐项目', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'pkg-customer', projectId: project, name: '套餐实例', domains: ['pkg.example.com'] }, 'owner')
  const sms = new SmsService(store, { masterKey: Buffer.alloc(32, 4).toString('base64'), defaultMode: 'HYBRID', defaultPriceCents: 5 })
  const payments = { validateToken: token => token, ensureMethodsConfigured: () => {}, wechatConfig: () => ({ merchantId: 'mch-test', appId: 'app-test', officialAppId: 'official-test', notifyUrl: 'https://example.invalid/notify' }), css: () => '', renderMessage: () => '', renderPaid: () => '', qr: { toString: async () => '<svg/>' } }
  const service = new SmsPackagePaymentService(store, { sms, payments })
  return { store, project, instance, sms, service, payments }
}

test('package payment notification grants exactly one package balance', async () => {
  const { store, project, instance, sms, service } = setup()
  try {
    const packageProduct = sms.savePackage({ code: 'package-1', name: '套餐一', messageCount: 10, priceCents: 100, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    const order = sms.createPackageOrder(instance, packageProduct.id)
    const token = 'A'.repeat(43)
    store.db.prepare('INSERT INTO sms_package_checkout_sessions(token_hash,package_order_id,expires_at,created_at) VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), order.id, Date.now() + 60000, new Date().toISOString())
    const summary = service.summary(token)
    assert.equal(summary.packageName, '套餐一')
    assert.equal(summary.amountCents, 100)
    const transaction = { out_trade_no: 'SMSPKG-test', transaction_id: 'wx-pkg-transaction', mchid: 'mch-test', appid: 'app-test', amount: { total: 100, currency: 'CNY' } }
    store.db.prepare('INSERT INTO sms_package_payments(id,package_order_id,out_trade_no,method,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), order.id, transaction.out_trade_no, 'NATIVE', 100, 'UNPAID', new Date().toISOString())
    const result = await service.notification(transaction, { merchantId: 'mch-test', appId: 'app-test', officialAppId: 'official-test' })
    assert.equal(result.paid, true)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sms_package_balances WHERE project_id=?').get(project).count, 1)
    const replay = await service.notification(transaction, { merchantId: 'mch-test', appId: 'app-test', officialAppId: 'official-test' })
    assert.equal(replay.idempotent, true)
  } finally { store.close() }
})

test('SMS and identity checkout reuse Native QR, validate project gate, and snapshot amount', async () => {
  const { store, project, instance, sms, service, payments } = setup()
  try {
    // Fixture only: production settings validate real credentials before enabling Native.
    store.db.prepare("UPDATE payment_providers SET enabled=1,methods=? WHERE id='wechat_pay'").run('["NATIVE"]')
    store.db.prepare("UPDATE projects SET payment_provider='wechat_pay',payment_methods=? WHERE id=?").run('["NATIVE"]', project)
    const calls = []
    payments.wechatRequest = async (method, path, request) => {
      calls.push(request)
      assert.equal(method, 'POST')
      assert.equal(path, '/v3/pay/transactions/native')
      return { code_url: 'weixin://wxpay/bizpayurl?pr=synthetic' }
    }
    const identityPackages = new IdentityPackageService(store, { billing: new UsageBilling(store) })
    const identityService = new IdentityPackagePaymentService(store, { packages: identityPackages, payments })
    const smsProduct = sms.savePackage({ code: 'sms-checkout', name: '测试短信', messageCount: 5, priceCents: 123, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    const identityProduct = identityPackages.savePackage({ code: 'kyc-checkout', name: '测试实名', verificationCount: 3, priceCents: 789, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    for (const [checkout, product, amount] of [[service, smsProduct, 123], [identityService, identityProduct, 789]]) {
      const result = await checkout.createCheckout(instance, product.id, 'https://authority.example.invalid')
      const token = new URL(result.checkoutUrl).pathname.split('/').at(-1)
      assert.equal(result.amountCents, amount)
      assert.equal((await checkout.prepay(token)).method, 'NATIVE')
      assert.equal((await checkout.prepay(token)).method, 'NATIVE')
      assert.equal(calls.at(-1).amount.total, amount)
      store.db.prepare("UPDATE payment_providers SET methods=? WHERE id='wechat_pay'").run('["OFFICIAL","NATIVE"]')
      store.db.prepare('UPDATE projects SET payment_methods=? WHERE id=?').run('["OFFICIAL","NATIVE"]', project)
      const page = await checkout.page(token, { headers: { 'user-agent': 'iPhone Mobile MicroMessenger/8.0' } }, 'https://authority.example.invalid')
      assert.match(page, /<svg/)
      assert.doesNotMatch(page, /id="official-pay"/)
      store.db.prepare("UPDATE projects SET payment_methods='[]' WHERE id=?").run(project)
      assert.equal(checkout.summary(token).paymentReady, false)
      await assert.rejects(() => checkout.prepay(token), /扫码支付未启用/)
      store.db.prepare('UPDATE projects SET payment_methods=? WHERE id=?').run('["NATIVE"]', project)
    }
    assert.equal(calls.length, 2)
  } finally { store.close() }
})

test('both OFFICIAL-only packages: QR outside mobile WeChat, OAuth in mobile WeChat, verified payment grants once', async () => {
  const { store, project, instance, sms } = setup()
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const mobile = { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile/15E148 MicroMessenger/8.0.60' }
  const desktopAgents = [
    'Mozilla/5.0 (Windows NT 10.0) MicroMessenger/8.0 Mobile WindowsWechat',
    'Mozilla/5.0 (Macintosh) MicroMessenger/8.0 MacWechat',
    'Mozilla/5.0 (Android 14) Mobile Chrome/130',
    'Mozilla/5.0 (Windows NT 10.0) Chrome/130'
  ]
  const calls = [], qrs = []
  const payments = new PaymentService(store, {
    fetcher: async url => {
      assert.equal(new URL(url).hostname, 'api.weixin.qq.com')
      return Response.json({ openid: 'verified-openid' })
    },
    qr: { toString: async value => { qrs.push(value); return '<svg aria-label="payment-qr"/>' } }
  })
  const config = { methods: ['OFFICIAL'], origin: 'https://auth.example.invalid', merchantId: 'mch-test', officialAppId: 'official-test', officialAppSecret: 'test-only', notifyUrl: 'https://auth.example.invalid/api/pay/wx/notify', privateKey }
  payments.wechatConfig = () => config
  payments.wechatRequest = async (method, path, body) => {
    calls.push(body)
    assert.equal(method, 'POST')
    assert.equal(path, '/v3/pay/transactions/jsapi')
    await new Promise(resolve => setTimeout(resolve, 20))
    return { prepay_id: 'test-prepay-' + body.out_trade_no }
  }
  const server = createAuthorityServer(store, { payments, sms })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const local = 'http://127.0.0.1:' + server.address().port
  try {
    store.db.prepare("UPDATE payment_providers SET enabled=1,methods='[\"OFFICIAL\"]' WHERE id='wechat_pay'").run()
    store.db.prepare("UPDATE projects SET payment_provider='wechat_pay',payment_methods='[\"OFFICIAL\"]' WHERE id=?").run(project)
    const smsProduct = sms.savePackage({ code: 'sms-official', name: '短信测试', messageCount: 5, priceCents: 123, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    const identity = payments.identityPackagePayments
    const identityProduct = identity.packages.savePackage({ code: 'id-official', name: '实名测试', verificationCount: 3, priceCents: 789, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    for (const [kind, service, product, amount, table] of [
      ['sms', payments.smsPackagePayments, smsProduct, 123, 'sms'],
      ['identity', identity, identityProduct, 789, 'identity']
    ]) {
      const checkout = await service.createCheckout(instance, product.id, config.origin)
      assert.deepEqual(checkout.methods, ['OFFICIAL'])
      const path = new URL(checkout.checkoutUrl).pathname
      const token = path.split('/').at(-1)
      const api = '/api/pay/wx/oauth?token=' + token + '&kind=' + kind
      for (const ua of desktopAgents) {
        const body = await (await fetch(local + path, { headers: { 'user-agent': ua } })).text()
        assert.match(body, /<svg/)
        assert.doesNotMatch(body, /id="official-pay"/)
        assert.equal(qrs.at(-1), checkout.checkoutUrl)
      }
      const oldCallCount = calls.length
      assert.doesNotMatch(await (await fetch(local + path + '?paid=1', { headers: mobile })).text(), /id="official-pay"/)
      assert.match(await (await fetch(local + path, { headers: mobile })).text(), /location\.replace\(document\.getElementById\('official-pay'\)/)
      assert.equal((await fetch(local + api, { redirect: 'manual' })).headers.get('location'), path)
      const oauth = await fetch(local + api, { headers: mobile, redirect: 'manual' })
      assert.equal(oauth.status, 302)
      const redirect = new URL(new URL(oauth.headers.get('location')).searchParams.get('redirect_uri'))
      assert.equal(redirect.searchParams.get('kind'), kind)
      assert.equal(redirect.pathname, '/api/pay/wx/oauth-callback')
      const callback = local + redirect.pathname + redirect.search + '&code=test-code'
      assert.equal((await fetch(callback + '&state=wrong', { headers: mobile })).status, 400)
      assert.equal(calls.length, oldCallCount)
      const responses = await Promise.all(Array.from({ length: 2 }, () => fetch(callback + '&state=' + token, { headers: mobile })))
      for (const response of responses) {
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-security-policy'), /script-src 'unsafe-inline'/)
        const body = await response.text()
        assert.match(body, /getBrandWCPayRequest/)
        assert.ok(body.includes(path))
      }
      assert.equal(calls.length, oldCallCount + 1)
      const call = calls.at(-1)
      assert.equal(call.amount.total, amount)
      assert.ok(call.out_trade_no.length <= 32)
      await assert.rejects(service.prepayOfficial(token, 'other-openid'), /首次发起/)
      const transaction = { out_trade_no: call.out_trade_no, transaction_id: 'test-' + kind, mchid: config.merchantId, appid: config.officialAppId, trade_type: 'JSAPI', payer: { openid: call.payer.openid }, amount: { total: amount, currency: 'CNY' } }
      await assert.rejects(service.notification({ ...transaction, amount: { total: amount + 1 } }, config), /金额/)
      await assert.rejects(service.notification({ ...transaction, trade_type: 'NATIVE' }, config), /交易类型/)
      await assert.rejects(service.notification({ ...transaction, payer: { openid: 'other' } }, config), /付款人/)
      assert.equal(service.summary(token).status, 'UNPAID')
      assert.equal((await service.notification(transaction, config)).paid, true)
      assert.equal((await service.notification(transaction, config)).idempotent, true)
      assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}_package_balances WHERE source_order_id=?`).get(checkout.orderId).count, 1)
      assert.match(await (await fetch(local + path, { headers: mobile })).text(), /支付成功，套餐已发放/)
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
    store.close()
  }
})
