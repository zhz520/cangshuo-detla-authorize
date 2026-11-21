import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { SmsPackagePaymentService } from '../server/sms-payments.mjs'
import { IdentityPackageService } from '../server/identity-packages.mjs'
import { UsageBilling } from '../server/usage.mjs'
import { IdentityVerificationService } from '../server/identity.mjs'
import { createAuthorityServer } from '../server/http.mjs'

const OWNER_PASSWORD = 'Only-a-test-password-2026'
const MAINTENANCE_UNTIL = '2099-12-01T00:00:00Z'
// 合成证件号，仅用于校验算法，不对应真实个人。
const SYNTHETIC_ID = '990000199001010017'
const masterKey = randomBytes(32).toString('base64')
const receiptKey = randomBytes(32).toString('base64')
const sha256 = value => createHash('sha256').update(String(value)).digest('hex')

function fakePayments() {
  return {
    validateToken: token => token,
    ensureMethodsConfigured: () => {},
    wechatConfig: () => ({
      merchantId: 'mch-test-only',
      appId: 'app-test-only',
      officialAppId: 'official-app-test-only',
      notifyUrl: 'https://authority.example.invalid/api/pay/wx/notify'
    }),
    css: () => '',
    renderMessage: message => message,
    renderPaid: () => '',
    qr: { toString: async () => '<svg aria-label="test-only-payment-qr"/>' }
  }
}

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const store = new AuthorityStore({
    database: ':memory:',
    privateKey,
    ownerUsername: 'owner',
    ownerPassword: OWNER_PASSWORD
  })
  const tenants = {}
  for (const key of ['a', 'b']) {
    const customerId = 'tenant-' + key
    store.createCustomer({ id: customerId, name: '测试租户' + key.toUpperCase() }, 'owner')
    const project = store.management.saveProject(null, {
      customerId,
      productId: 'detla',
      name: '隔离项目' + key.toUpperCase(),
      maintenanceUntil: MAINTENANCE_UNTIL
    }, 'owner').id
    const instance = randomUUID()
    store.createInstance({
      id: instance,
      customerId,
      projectId: project,
      name: '隔离实例' + key.toUpperCase(),
      domains: [key + '.authority.example.invalid']
    }, 'owner')
    tenants[key] = { customerId, project, instance }
  }

  const provider = {
    calls: 0,
    async send() {
      provider.calls += 1
      return {
        accepted: true,
        bizId: 'biz-test-' + provider.calls,
        requestId: 'provider-request-' + provider.calls
      }
    },
    async queryDelivery() { return 'DELIVERED' }
  }
  const sms = new SmsService(store, {
    provider,
    masterKey,
    receiptKey,
    phoneHashKey: 'two-tenant-phone-hash-key',
    defaultMode: 'METERED',
    defaultPriceCents: 5
  })
  sms.saveSettings({
    enabled: true,
    accessKeyId: 'test-only-access-key',
    accessKeySecret: 'test-only-access-secret',
    defaultSignName: '测试签名'
  }, 'owner')
  sms.saveTemplate({
    templateKey: 'otp_login',
    name: '登录验证码',
    scene: 'LOGIN',
    providerTemplateCode: 'SMS_TEST_ONLY',
    variables: [{ key: 'code', required: true, maxLength: 6 }],
    status: 'ACTIVE',
    billable: true,
    minClientVersion: '1.4.0'
  }, 'owner')
  for (const key of ['a', 'b']) {
    sms.saveAccount(tenants[key].project, {
      billingMode: 'METERED',
      unitPriceCents: 5,
      dailyLimit: 0,
      monthlyLimit: 0,
      lowBalanceCents: 0,
      enabled: true
    }, 'owner')
  }
  sms.credit(tenants.a.project, 100, 'sms-credit-a', 'owner')
  sms.credit(tenants.b.project, 200, 'sms-credit-b', 'owner')
  return {
    store,
    tenants,
    sms,
    provider,
    credentials: {
      a: sms.rotateCredential(tenants.a.instance, 'owner'),
      b: sms.rotateCredential(tenants.b.instance, 'owner')
    }
  }
}

function signedHeaders(instanceId, secret, method, path, rawBody, nonce, idempotencyKey = '') {
  const timestamp = String(Date.now())
  const message = [method, path, timestamp, nonce, idempotencyKey, sha256(rawBody)].join(String.fromCharCode(10))
  const headers = {
    'content-type': 'application/json',
    'x-sms-instance': instanceId,
    'x-sms-timestamp': timestamp,
    'x-sms-nonce': nonce,
    'x-sms-signature': createHmac('sha256', secret).update(message).digest('hex')
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

async function startServer(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + server.address().port
}

async function closeServer(server) {
  if (!server.listening) return
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

test('SMS receipts debit only the owning tenant and cross-tenant access is rejected', async () => {
  const f = setup()
  const server = createAuthorityServer(f.store, { sms: f.sms, payments: fakePayments() })
  try {
    const A = f.tenants.a
    const B = f.tenants.b
    assert.notEqual(A.project, B.project)
    assert.notEqual(A.instance, B.instance)
    assert.equal(f.sms.instanceProject(A.instance).project_id, A.project)
    assert.equal(f.sms.instanceProject(B.instance).project_id, B.project)
    assert.equal(f.sms.accountDetail(A.project).balance_cents, 100)
    assert.equal(f.sms.accountDetail(B.project).balance_cents, 200)

    const sentA = await f.sms.send(A.instance, {
      templateKey: 'otp_login',
      phone: '19900000001',
      variables: { code: '111111' },
      clientVersion: '1.4.0'
    }, 'sms-request-a-0001')
    const sentB = await f.sms.send(B.instance, {
      templateKey: 'otp_login',
      phone: '19900000002',
      variables: { code: '222222' },
      clientVersion: '1.4.0'
    }, 'sms-request-b-0001')
    assert.equal(sentA.status, 'ACCEPTED')
    assert.equal(sentB.status, 'ACCEPTED')
    assert.equal(f.provider.calls, 2)

    assert.equal(f.sms.applyReceipts([{
      out_id: sentA.requestId,
      biz_id: sentA.providerMessageId,
      success: true
    }]).processed, 1)
    assert.equal(f.sms.accountDetail(A.project).balance_cents, 95)
    assert.equal(f.sms.accountDetail(B.project).balance_cents, 200)
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE project_id=? AND type='CHARGE'").get(A.project).count, 1)
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE project_id=? AND type='CHARGE'").get(B.project).count, 0)

    assert.equal(f.sms.applyReceipts([{
      out_id: sentA.requestId,
      biz_id: sentA.providerMessageId,
      success: true
    }]).processed, 0)
    assert.equal(f.sms.accountDetail(A.project).balance_cents, 95)

    assert.equal(f.sms.applyReceipts([{
      out_id: sentB.requestId,
      biz_id: sentB.providerMessageId,
      success: true
    }]).processed, 1)
    assert.equal(f.sms.accountDetail(A.project).balance_cents, 95)
    assert.equal(f.sms.accountDetail(B.project).balance_cents, 195)
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE project_id=? AND type='CHARGE'").get(B.project).count, 1)
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE type='CHARGE'").get().count, 2)

    assert.throws(() => f.sms.requestForInstance(B.instance, sentA.requestId), /短信请求不存在/)
    assert.throws(() => f.sms.requestForInstance(A.instance, sentB.requestId), /短信请求不存在/)

    const base = await startServer(server)
    const crossRequestPath = '/api/sms/v1/requests/' + sentA.requestId
    let response = await fetch(base + crossRequestPath, {
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'GET', crossRequestPath, '', 'two-tenant-nonce-request-cross')
    })
    assert.equal(response.status, 404)

    const ownRequestPath = '/api/sms/v1/requests/' + sentB.requestId
    response = await fetch(base + ownRequestPath, {
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'GET', ownRequestPath, '', 'two-tenant-nonce-request-own')
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).requestId, sentB.requestId)

    response = await fetch(base + '/api/sms/v1/account', {
      headers: signedHeaders(A.instance, f.credentials.b.secret, 'GET', '/api/sms/v1/account', '', 'two-tenant-nonce-credential-cross')
    })
    assert.equal(response.status, 401)
    assert.match((await response.json()).message, /认证失败/)
  } finally {
    await closeServer(server)
    f.store.close()
  }
})

test('project-scoped packages stay inside their tenant and duplicate payment callbacks grant once', async () => {
  const f = setup()
  const payments = fakePayments()
  const smsPackagePayments = new SmsPackagePaymentService(f.store, { sms: f.sms, payments })
  payments.smsPackagePayments = smsPackagePayments
  const server = createAuthorityServer(f.store, { sms: f.sms, payments })
  try {
    const A = f.tenants.a
    const B = f.tenants.b
    const exclusiveSms = f.sms.savePackage({
      code: 'a-exclusive-sms',
      name: 'A 专属短信套餐',
      messageCount: 10,
      priceCents: 123,
      validityDays: 30,
      scopeType: 'PROJECT',
      scopeId: A.project,
      status: 'ACTIVE'
    }, 'owner')
    assert.deepEqual(f.sms.availablePackages(A.instance).map(item => item.id), [exclusiveSms.id])
    assert.equal(f.sms.availablePackages(B.instance).some(item => item.id === exclusiveSms.id), false)
    assert.throws(() => f.sms.createPackageOrder(B.instance, exclusiveSms.id), /套餐不适用于该项目/)
    await assert.rejects(
      () => smsPackagePayments.createCheckout(B.instance, exclusiveSms.id, 'https://authority.example.invalid'),
      /套餐不适用于该项目/
    )

    const identityPackages = new IdentityPackageService(f.store, { billing: new UsageBilling(f.store) })
    const exclusiveIdentity = identityPackages.savePackage({
      code: 'a-exclusive-identity',
      name: 'A 专属实名套餐',
      verificationCount: 5,
      priceCents: 200,
      validityDays: 30,
      scopeType: 'PROJECT',
      scopeId: A.project,
      status: 'ACTIVE'
    }, 'owner')
    assert.deepEqual(identityPackages.availablePackages(A.instance).map(item => item.id), [exclusiveIdentity.id])
    assert.equal(identityPackages.availablePackages(B.instance).some(item => item.id === exclusiveIdentity.id), false)
    assert.throws(() => identityPackages.createPackageOrder(B.instance, exclusiveIdentity.id), /套餐不适用于该项目/)

    const base = await startServer(server)
    let path = '/api/sms/v1/packages'
    let response = await fetch(base + path, {
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'GET', path, '', 'two-tenant-nonce-packages-b')
    })
    assert.equal(response.status, 200)
    let packages = await response.json()
    assert.equal(Array.isArray(packages), true)
    assert.equal(packages.some(item => item.id === exclusiveSms.id), false)

    path = '/api/sms/v1/packages/' + exclusiveSms.id + '/checkout'
    const checkoutBody = {}
    const checkoutRaw = JSON.stringify(checkoutBody)
    response = await fetch(base + path, {
      method: 'POST',
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'POST', path, checkoutRaw, 'two-tenant-nonce-checkout-b'),
      body: checkoutRaw
    })
    assert.equal(response.status, 409)
    assert.match((await response.json()).message, /套餐不适用于该项目/)

    path = '/api/sms/v1/packages'
    response = await fetch(base + path, {
      headers: signedHeaders(A.instance, f.credentials.a.secret, 'GET', path, '', 'two-tenant-nonce-packages-a')
    })
    assert.equal(response.status, 200)
    packages = await response.json()
    assert.equal(packages.some(item => item.id === exclusiveSms.id), true)

    const order = f.sms.createPackageOrder(A.instance, exclusiveSms.id)
    const transaction = {
      out_trade_no: 'SMSPKG-TWO-TENANT-A-0001',
      transaction_id: 'wx-test-two-tenant-a-0001',
      mchid: 'mch-test-only',
      appid: 'app-test-only',
      amount: { total: 123, currency: 'CNY' }
    }
    f.store.db.prepare('INSERT INTO sms_package_payments(id,package_order_id,out_trade_no,method,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), order.id, transaction.out_trade_no, 'NATIVE', 123, 'UNPAID', new Date().toISOString())
    const grantCount = () => f.store.db.prepare('SELECT COUNT(*) AS count FROM sms_package_balances WHERE source_order_id=?').get(order.id).count
    assert.equal(grantCount(), 0)

    const first = await smsPackagePayments.notification(transaction, payments.wechatConfig())
    assert.equal(first.paid, true)
    assert.equal(first.smsPackage, true)
    assert.equal(grantCount(), 1)
    const replay = await smsPackagePayments.notification(transaction, payments.wechatConfig())
    assert.equal(replay.idempotent, true)
    assert.equal(grantCount(), 1)
    assert.equal(f.store.db.prepare('SELECT remaining_count FROM sms_package_balances WHERE source_order_id=?').get(order.id).remaining_count, 10)
    assert.equal(f.store.db.prepare('SELECT status FROM sms_package_orders WHERE id=?').get(order.id).status, 'GRANTED')
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM sms_package_balances WHERE project_id=?').get(B.project).count, 0)
  } finally {
    await closeServer(server)
    f.store.close()
  }
})

test('disabling tenant A identity entitlement rejects A while tenant B remains verifiable', async () => {
  const f = setup()
  const server = createAuthorityServer(f.store, { sms: f.sms, payments: fakePayments() })
  try {
    const A = f.tenants.a
    const B = f.tenants.b
    const entitlementA = f.store.createEntitlement({ instanceId: A.instance, moduleId: 'identity_verification' }, 'owner')
    const entitlementB = f.store.createEntitlement({ instanceId: B.instance, moduleId: 'identity_verification' }, 'owner')
    const licenseA = entitlementA.license
    const licenseB = entitlementB.license
    assert.match(Buffer.from(licenseA.payload, 'base64url').toString('utf8'), /identity_verification/)
    assert.match(Buffer.from(licenseB.payload, 'base64url').toString('utf8'), /identity_verification/)

    const base = await startServer(server)
    const accountPath = '/api/client/identity/account'
    let raw = JSON.stringify({ license: licenseA, version: '1.4.0' })
    let response = await fetch(base + accountPath, {
      method: 'POST',
      headers: signedHeaders(A.instance, f.credentials.a.secret, 'POST', accountPath, raw, 'two-tenant-nonce-identity-a-before'),
      body: raw
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).instance_id, A.instance)

    raw = JSON.stringify({ license: licenseB, version: '1.4.0' })
    response = await fetch(base + accountPath, {
      method: 'POST',
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'POST', accountPath, raw, 'two-tenant-nonce-identity-b-before'),
      body: raw
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).instance_id, B.instance)

    const disabled = f.store.updateEntitlement(A.instance, 'identity_verification', { enabled: false }, 'owner')
    assert.equal(disabled.enabled, false)
    for (const [license, nonce] of [
      [licenseA, 'two-tenant-nonce-identity-a-stale'],
      [disabled.license, 'two-tenant-nonce-identity-a-refreshed']
    ]) {
      raw = JSON.stringify({ license, version: '1.4.0' })
      response = await fetch(base + accountPath, {
        method: 'POST',
        headers: signedHeaders(A.instance, f.credentials.a.secret, 'POST', accountPath, raw, nonce),
        body: raw
      })
      assert.equal(response.status, 403)
      assert.match((await response.json()).message, /未开通实名认证模块/)
    }

    raw = JSON.stringify({ license: licenseB, version: '1.4.0' })
    response = await fetch(base + accountPath, {
      method: 'POST',
      headers: signedHeaders(B.instance, f.credentials.b.secret, 'POST', accountPath, raw, 'two-tenant-nonce-identity-b-after'),
      body: raw
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).instance_id, B.instance)

    const billing = new UsageBilling(f.store, { defaultMode: 'METERED', defaultPriceCents: 100 })
    billing.credit(B.instance, 500, 'identity-credit-b', 'owner')
    const providerCalls = []
    const identityProvider = {
      configured: () => true,
      async verify({ realName, idNumber }) {
        providerCalls.push({ realName, idNumber })
        return { matched: true, reference: 'fake-identity-reference' }
      }
    }
    const identity = new IdentityVerificationService(f.store, billing, identityProvider, {
      priceCents: 100,
      subjectPepper: 'two-tenant-test-pepper'
    })

    await assert.rejects(() => identity.verify({
      license: disabled.license,
      version: '1.4.0',
      realName: '测试甲',
      idNumber: SYNTHETIC_ID,
      idempotencyKey: 'identity-verify-a-0001'
    }), /未开通实名认证模块/)
    assert.equal(providerCalls.length, 0)

    const verified = await identity.verify({
      license: licenseB,
      version: '1.4.0',
      realName: '测试乙',
      idNumber: SYNTHETIC_ID,
      idempotencyKey: 'identity-verify-b-0001'
    })
    assert.equal(verified.matched, true)
    assert.equal(verified.chargedCents, 100)
    assert.equal(providerCalls.length, 1)
    assert.equal(f.store.db.prepare('SELECT balance_cents FROM service_accounts WHERE instance_id=?').get(B.instance).balance_cents, 400)
    assert.equal(f.store.db.prepare('SELECT balance_cents FROM service_accounts WHERE instance_id=?').get(A.instance)?.balance_cents || 0, 0)
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM verification_requests WHERE instance_id=?').get(A.instance).count, 0)
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM verification_requests WHERE instance_id=?').get(B.instance).count, 1)
  } finally {
    await closeServer(server)
    f.store.close()
  }
})
