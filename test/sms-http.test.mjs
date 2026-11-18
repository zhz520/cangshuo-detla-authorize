import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { createAuthorityServer } from '../server/http.mjs'

const masterKey = randomBytes(32).toString('base64')
const receiptKey = randomBytes(32)
const sha256 = value => createHash('sha256').update(String(value)).digest('hex')

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'sms-http-customer', name: '短信接口客户' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'sms-http-customer', productId: 'detla', name: '短信接口项目', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'sms-http-customer', projectId: project, name: '短信接口实例', domains: ['sms-http.example.com'] }, 'owner')
  const provider = {
    calls: 0,
    send: async () => { provider.calls++; return { accepted: true, bizId: 'biz-http', requestId: 'req-http' } },
    queryDelivery: async () => 'DELIVERED'
  }
  const sms = new SmsService(store, { provider, masterKey, receiptKey: receiptKey.toString('base64'), phoneHashKey: 'sms-http-phone-key', defaultMode: 'METERED', defaultPriceCents: 5 })
  sms.saveSettings({ enabled: true, accessKeyId: 'test', accessKeySecret: 'test-secret', defaultSignName: '测试签名' }, 'owner')
  sms.saveTemplate({ templateKey: 'otp_login', name: '登录验证码', scene: 'LOGIN', providerTemplateCode: 'SMS_HTTP', variables: [{ key: 'code', required: true, maxLength: 6 }], status: 'ACTIVE' }, 'owner')
  sms.saveAccount(project, { billingMode: 'METERED', unitPriceCents: 5, dailyLimit: 0, monthlyLimit: 0, lowBalanceCents: 0, enabled: true }, 'owner')
  sms.credit(project, 100, 'http-test-credit', 'owner')
  const credential = sms.rotateCredential(instance, 'owner')
  return { store, project, instance, sms, credential, provider }
}

async function login(base) {
  const response = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'Only-a-test-password-2026' })
  })
  assert.equal(response.status, 200)
  const value = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: value.csrf }
}

function signedHeaders(instance, secret, method, path, raw, nonce = 'nonce-http-test-1', key = '') {
  const timestamp = String(Date.now())
  const message = [method, path, timestamp, nonce, key, sha256(raw)].join(String.fromCharCode(10))
  return {
    'content-type': 'application/json',
    'x-sms-instance': instance,
    'x-sms-timestamp': timestamp,
    'x-sms-nonce': nonce,
    'x-sms-signature': createHmac('sha256', secret).update(message).digest('hex')
  }
}

test('SMS admin and signed client routes are wired without an authenticated browser session on send', async () => {
  const fixture = setup()
  const server = createAuthorityServer(fixture.store, { sms: fixture.sms })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const session = await login(base)
    const settingsResponse = await fetch(base + '/api/sms/settings', { headers: { cookie: session.cookie } })
    assert.equal(settingsResponse.status, 200)
    assert.equal((await settingsResponse.json()).enabled, true)

    const body = { instanceId: fixture.instance, templateKey: 'otp_login', phone: '13800138000', variables: { code: '123456' } }
    const raw = JSON.stringify(body)
    const sendResponse = await fetch(base + '/api/sms/v1/send', {
      method: 'POST', headers: { ...signedHeaders(fixture.instance, fixture.credential.secret, 'POST', '/api/sms/v1/send', raw, 'nonce-http-test-1', 'sms-key-http-1'), 'idempotency-key': 'sms-key-http-1' },
      body: raw
    })
    assert.equal(sendResponse.status, 200)
    const result = await sendResponse.json()
    assert.equal(result.status, 'ACCEPTED')
    assert.equal(result.billing.chargedCents, 0)
    const report = JSON.stringify({ reports: [{ out_id: result.requestId, biz_id: 'biz-http', success: true }] })
    const timestamp = String(Date.now())
    const reportPath = base + '/api/sms/receipts/aliyun'
    assert.equal((await fetch(reportPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: report })).status, 401)
    const reportHeaders = { 'content-type': 'application/json', 'x-sms-receipt-timestamp': timestamp,
      'x-sms-receipt-signature': createHmac('sha256', receiptKey).update(timestamp + '\n' + report).digest('hex') }
    assert.equal((await (await fetch(reportPath, { method: 'POST', headers: reportHeaders, body: report })).json()).processed, 1)
    assert.equal((await (await fetch(reportPath, { method: 'POST', headers: reportHeaders, body: report })).json()).processed, 0)

    const accountPath = '/api/sms/v1/account'
    const accountResponse = await fetch(base + accountPath, { headers: signedHeaders(fixture.instance, fixture.credential.secret, 'GET', accountPath, '', 'nonce-http-test-2') })
    assert.equal(accountResponse.status, 200)
    assert.equal((await accountResponse.json()).balanceCents, 95)

    const replayResponse = await fetch(base + '/api/sms/v1/send', {
      method: 'POST', headers: { ...signedHeaders(fixture.instance, fixture.credential.secret, 'POST', '/api/sms/v1/send', raw, 'nonce-http-test-3', 'sms-key-http-1'), 'idempotency-key': 'sms-key-http-1' },
      body: raw
    })
    assert.equal(replayResponse.status, 200)
    assert.equal(fixture.provider.calls, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fixture.store.close()
  }
})


test('SMS reconciliation is operator-only, CSRF protected, and settles a verified failure without a new send', async () => {
  const fixture=setup()
  const server=createAuthorityServer(fixture.store,{sms:fixture.sms})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  try {
    const row=await fixture.sms.send(fixture.instance,{templateKey:'otp_login',phone:'13800138000',variables:{code:'123456'}},'receipt-http-check')
    fixture.provider.queryDelivery=async ()=> 'FAILED'
    const url=base+'/api/sms/requests/'+row.requestId+'/reconcile'
    const request=headers=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({phone:'13800138000'})})
    assert.equal((await request({})).status,401)
    const session=await login(base)
    assert.equal((await request({cookie:session.cookie})).status,403)
    const response=await request({cookie:session.cookie,'x-csrf-token':session.csrf})
    assert.equal(response.status,200)
    const result=await response.json()
    assert.equal(result.status,'FAILED')
    assert.equal(result.billing.status,'RELEASED')
    assert.equal(result.billing.chargedCents,0)
    assert.equal(fixture.provider.calls,1)
    assert.equal(fixture.sms.accountDetail(fixture.project).reserved_cents,0)
    assert.equal(fixture.sms.accountDetail(fixture.project).balance_cents,100)
  } finally {
    await new Promise(resolve=>server.close(resolve))
    fixture.store.close()
  }
})

test('Aliyun HTTP receipt push is token protected, verified against QuerySendDetails, and idempotent', async () => {
  const fixture = setup()
  const server = createAuthorityServer(fixture.store, { sms: fixture.sms })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const row = await fixture.sms.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '123456' } }, 'receipt-http-push')
    const payload = JSON.stringify([{
      phone_number: '13800138000', send_time: String(Date.now()), biz_id: 'biz-http',
      out_id: row.requestId, success: true, err_code: 'DELIVERED'
    }])
    const url = base + '/api/sms/receipts/aliyun/http?token=' + encodeURIComponent(fixture.sms.httpReceiptToken())
    const post = token => fetch(token ? url : base + '/api/sms/receipts/aliyun/http', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload
    })
    assert.equal((await post(false)).status, 401)
    const accepted = await post(true)
    assert.equal(accepted.status, 200)
    assert.deepEqual(await accepted.json(), { code: 0, msg: '成功' })
    for (let i = 0; i < 50; i++) {
      const current = fixture.store.db.prepare('SELECT status FROM sms_requests WHERE id=?').get(row.requestId)
      if (current.status === 'DELIVERED') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(fixture.store.db.prepare('SELECT status,billing_status FROM sms_requests WHERE id=?').get(row.requestId).status, 'DELIVERED')
    assert.equal(fixture.sms.accountDetail(fixture.project).balance_cents, 95)
    assert.equal((await post(true)).status, 200)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(fixture.sms.accountDetail(fixture.project).balance_cents, 95)
    assert.equal(fixture.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE type='CHARGE'").get().count, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fixture.store.close()
  }
})
