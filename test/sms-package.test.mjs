import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { SmsPackagePaymentService } from '../server/sms-payments.mjs'
import { IdentityPackageService } from '../server/identity-packages.mjs'
import { IdentityPackagePaymentService } from '../server/identity-payments.mjs'
import { UsageBilling } from '../server/usage.mjs'

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'pkg-customer', name: '套餐客户' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'pkg-customer', productId: 'detla', name: '套餐项目', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'pkg-customer', projectId: project, name: '套餐实例', domains: ['pkg.example.com'] }, 'owner')
  const sms = new SmsService(store, { masterKey: Buffer.alloc(32, 4).toString('base64'), defaultMode: 'HYBRID', defaultPriceCents: 5 })
  const payments = { validateToken: token => token, wechatConfig: () => ({ merchantId: 'mch-test', appId: 'app-test', officialAppId: 'official-test', notifyUrl: 'https://example.invalid/notify' }), css: () => '', renderMessage: () => '', renderPaid: () => '', qr: { toString: async () => '<svg/>' } }
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
    const identityPackages = new IdentityPackageService(store, new UsageBilling(store))
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
      store.db.prepare("UPDATE projects SET payment_methods='[]' WHERE id=?").run(project)
      assert.equal(checkout.summary(token).paymentReady, false)
      await assert.rejects(() => checkout.prepay(token), /扫码支付未启用/)
      store.db.prepare('UPDATE projects SET payment_methods=? WHERE id=?').run('["NATIVE"]', project)
    }
    assert.equal(calls.length, 2)
  } finally { store.close() }
})
