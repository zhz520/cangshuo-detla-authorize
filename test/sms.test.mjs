import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { SmsProviderUncertain } from '../server/sms-provider.mjs'

const masterKey = randomBytes(32).toString('base64')
const receiptKey = randomBytes(32).toString('base64')
const sha256 = value => createHash('sha256').update(String(value)).digest('hex')

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'c', name: '客户' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'c', productId: 'detla', name: '短信项目', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'c', projectId: project, name: '短信实例', domains: ['sms.example.com'] }, 'owner')
  let calls = 0
  let outcome = 'accepted'
  const provider = {
    async send() {
      calls++
      if (outcome === 'uncertain') throw new SmsProviderUncertain('SMS_PROVIDER_TIMEOUT')
      if (outcome === 'rejected') return { accepted: false, code: 'isv.REJECTED', message: 'rejected' }
      return { accepted: true, bizId: 'biz-1', requestId: 'req-1' }
    }
  }
  const service = new SmsService(store, { provider, masterKey, receiptKey, phoneHashKey: 'phone-test-key', defaultMode: 'METERED', defaultPriceCents: 5 })
  service.saveSettings({ enabled: true, accessKeyId: 'test-key', accessKeySecret: 'test-secret', defaultSignName: '测试签名' }, 'owner')
  service.saveTemplate({ templateKey: 'otp_login', name: '登录验证码', scene: 'LOGIN', providerTemplateCode: 'SMS_TEST', variables: [{ key: 'code', required: true, maxLength: 6 }], status: 'ACTIVE', billable: true }, 'owner')
  service.saveAccount(project, { billingMode: 'METERED', unitPriceCents: 5, dailyLimit: 0, monthlyLimit: 0, lowBalanceCents: 0, enabled: true }, 'owner')
  service.credit(project, 100, 'test-credit', 'owner')
  return { store, project, instance, service, provider, get calls() { return calls }, set outcome(value) { outcome = value } }
}

const receipt = (service, result, success = true, biz = 'biz-1') =>
  service.applyReceipts([{ out_id: result.requestId, biz_id: biz, success }])

test('metered send reserves on acceptance, charges once on receipt, and never resends on replay', async () => {
  const fixture = setup()
  try {
    const first = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '123456' } }, 'sms-key-0001')
    const second = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '123456' } }, 'sms-key-0001')
    assert.equal(first.status, 'ACCEPTED')
    assert.equal(second.status, 'ACCEPTED')
    assert.equal(fixture.calls, 1)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 100)
    assert.equal(fixture.service.usageSummary(fixture.project).pending_count, 1)
    assert.equal(receipt(fixture.service, first, true, 'wrong-biz').processed, 0)
    assert.equal(receipt(fixture.service, first).processed, 1)
    assert.equal(receipt(fixture.service, first).processed, 0)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 95)
    assert.equal(fixture.service.usageSummary(fixture.project).delivered_count, 1)
    assert.equal(fixture.store.db.prepare("SELECT COUNT(*) AS count FROM sms_ledger WHERE type='CHARGE'").get().count, 1)
  } finally { fixture.store.close() }
})

test('package mode consumes package units and does not debit wallet', async () => {
  const fixture = setup()
  try {
    const pkg = fixture.service.savePackage({ code: 'p10', name: '10条包', messageCount: 10, priceCents: 50, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    fixture.service.saveAccount(fixture.project, { billingMode: 'PACKAGE', unitPriceCents: 5, dailyLimit: 0, monthlyLimit: 0, lowBalanceCents: 0, enabled: true }, 'owner')
    fixture.service.grantPackage(fixture.project, pkg.id, 'owner')
    const result = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '654321' } }, 'sms-key-0002')
    assert.equal(result.status, 'ACCEPTED')
    assert.equal(receipt(fixture.service, result).processed, 1)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 100)
    const balance = fixture.store.db.prepare('SELECT remaining_count,reserved_count FROM sms_package_balances WHERE project_id=?').get(fixture.project)
    assert.equal(balance.remaining_count, 9)
    assert.equal(balance.reserved_count, 0)
  } finally { fixture.store.close() }
})

test('hybrid consumes an available package first and then falls back to the wallet', async () => {
  const fixture = setup()
  try {
    const pkg = fixture.service.savePackage({ code: 'p1', name: '1条包', messageCount: 1, priceCents: 10, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    fixture.service.saveAccount(fixture.project, { billingMode: 'HYBRID', unitPriceCents: 5, dailyLimit: 0, monthlyLimit: 0, lowBalanceCents: 0, enabled: true }, 'owner')
    fixture.service.grantPackage(fixture.project, pkg.id, 'owner')
    const first = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '111111' } }, 'sms-key-hybrid-1')
    const second = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '222222' } }, 'sms-key-hybrid-2')
    assert.equal(first.billing.mode, 'PACKAGE')
    assert.equal(second.billing.mode, 'METERED')
    receipt(fixture.service, first)
    receipt(fixture.service, second)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 95)
  } finally { fixture.store.close() }
})

test('delivery failure releases wallet and unknown send can be resolved by a verified receipt', async () => {
  const fixture = setup()
  try {
    const body = { templateKey: 'otp_login', phone: '13800138000', variables: { code: '444444' } }
    const first = await fixture.service.send(fixture.instance, body, 'sms-key-fail-report')
    assert.equal(receipt(fixture.service, first, false).processed, 1)
    assert.equal(fixture.service.accountDetail(fixture.project).reserved_cents, 0)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 100)
    fixture.outcome = 'uncertain'
    const unknown = await fixture.service.send(fixture.instance, body, 'sms-key-unknown-report')
    assert.equal(unknown.status, 'UNKNOWN')
    await assert.rejects(fixture.service.send(fixture.instance, { ...body, phone: '13800138001' }, 'sms-key-unknown-report'), /幂等键/)
    receipt(fixture.service, unknown)
    assert.equal(fixture.service.accountDetail(fixture.project).balance_cents, 95)
    assert.equal(fixture.service.usageSummary(fixture.project).failed_count, 1)
  } finally { fixture.store.close() }
})

test('daily limit blocks another accepted request', async () => {
  const fixture = setup()
  try {
    fixture.service.saveAccount(fixture.project, { billingMode: 'METERED', unitPriceCents: 5, dailyLimit: 1, monthlyLimit: 0, lowBalanceCents: 0, enabled: true }, 'owner')
    await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '111111' } }, 'sms-key-limit-1')
    await assert.rejects(() => fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '222222' } }, 'sms-key-limit-2'), /每日发送上限/)
  } finally { fixture.store.close() }
})

test('package order payment grants the package once', async () => {
  const fixture = setup()
  try {
    const pkg = fixture.service.savePackage({ code: 'paid-pack', name: '购买套餐', messageCount: 20, priceCents: 100, validityDays: 30, scopeType: 'GLOBAL', status: 'ACTIVE' }, 'owner')
    const order = fixture.service.createPackageOrder(fixture.instance, pkg.id)
    const paid = fixture.service.markPackagePaid(order.id, { transactionId: 'wx-package-1', amountCents: 100 })
    assert.equal(paid.order.status, 'GRANTED')
    const idempotent = fixture.service.markPackagePaid(order.id, { transactionId: 'wx-package-1', amountCents: 100 })
    assert.equal(idempotent.idempotent, true)
    assert.equal(fixture.store.db.prepare('SELECT COUNT(*) AS count FROM sms_package_balances WHERE source_order_id=?').get(order.id).count, 1)
  } finally { fixture.store.close() }
})

test('definitive provider failure releases the hold, uncertain result keeps it', async () => {
  const fixture = setup()
  try {
    fixture.outcome = 'rejected'
    const rejected = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138000', variables: { code: '111111' } }, 'sms-key-0003')
    assert.equal(rejected.status, 'FAILED')
    assert.equal(fixture.service.accountDetail(fixture.project).reserved_cents, 0)
    fixture.outcome = 'uncertain'
    const unknown = await fixture.service.send(fixture.instance, { templateKey: 'otp_login', phone: '13800138001', variables: { code: '222222' } }, 'sms-key-0004')
    assert.equal(unknown.status, 'UNKNOWN')
    assert.equal(fixture.service.accountDetail(fixture.project).reserved_cents, 5)
    const released = fixture.service.releaseUnknown(unknown.requestId, 'owner')
    assert.equal(released.status, 'FAILED')
    assert.equal(fixture.service.accountDetail(fixture.project).reserved_cents, 0)
  } finally { fixture.store.close() }
})

test('client HMAC credentials reject replay and accept a valid request', async () => {
  const fixture = setup()
  try {
    const credential = fixture.service.rotateCredential(fixture.instance, 'owner')
    const timestamp = String(Date.now())
    const nonce = 'nonce-12345678'
    const body = { instanceId: fixture.instance, templateKey: 'otp_login', phone: '13800138000', variables: { code: '333333' } }
    const raw = JSON.stringify(body)
    const message = ['POST', '/api/sms/v1/send', timestamp, nonce, '', sha256(raw)].join(String.fromCharCode(10))
    const signature = createHmac('sha256', credential.secret).update(message).digest('hex')
    const headers = { 'x-sms-instance': fixture.instance, 'x-sms-timestamp': timestamp, 'x-sms-nonce': nonce, 'x-sms-signature': signature }
    assert.equal(fixture.service.verifyClient(headers, 'POST', '/api/sms/v1/send', raw, body), fixture.instance)
    assert.throws(() => fixture.service.verifyClient(headers, 'POST', '/api/sms/v1/send', raw, body), /已使用/)
    assert.throws(() => fixture.service.verifyClient({ ...headers, 'x-sms-signature': '0'.repeat(64) }, 'POST', '/api/sms/v1/send', raw, body), /认证失败/)
  } finally { fixture.store.close() }
})

test('default verification templates copy the active Aliyun channel and are idempotent', () => {
  const fixture = setup()
  try {
    const first = fixture.service.defaultVerificationTemplates('owner')
    assert.equal(first.sourceTemplateKey, 'otp_login')
    assert.deepEqual(first.created.sort(), ['otp_bind_new', 'otp_bind_old', 'otp_reset', 'otp_wechat_bind'])
    const templates = fixture.service.templates().filter(item => item.template_key.startsWith('otp_'))
    assert.equal(templates.length, 5)
    for (const template of templates) {
      assert.equal(template.provider_template_code, 'SMS_TEST')
      assert.equal(template.status, 'ACTIVE')
      assert.equal(template.billable, true)
      assert.deepEqual(template.variables, [{ key: 'code', required: true, maxLength: 6 }])
    }
    const second = fixture.service.defaultVerificationTemplates('owner')
    assert.deepEqual(second.created, [])
  } finally { fixture.store.close() }
})


test('missing business templates and missing variables are rejected before send or reservation', async () => {
  const f = setup()
  try {
    await assert.rejects(f.service.send(f.instance, {templateKey:'notice_player_new_order', phone:'13800138000'}, 'notice-no-template'), {
      status:409, publicCode:'SMS_TEMPLATE_NOT_CONFIGURED'
    })
    await assert.rejects(f.service.send(f.instance, {templateKey:'otp_login', phone:'13800138000', variables:{}}, 'otp-no-variable'), {
      status:400, publicCode:'SMS_TEMPLATE_INVALID'
    })
    assert.equal(f.calls, 0)
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM sms_requests').get().n, 0)
    assert.equal(f.service.accountDetail(f.project).reserved_cents, 0)
  } finally { f.store.close() }
})


test('business templates use fixed role and scene keys, without accepting OTP variables', () => {
  const f=setup()
  const template={templateKey:'notice_cs_order_status',name:'接单进度',scene:'ignored',providerTemplateCode:'SMS_12345678',variables:[{key:'status',required:true}],status:'ACTIVE'}
  try{
    assert.throws(()=>f.service.saveTemplate({...template,templateKey:'notice_cs_made_up'}),/角色与场景/)
    assert.throws(()=>f.service.saveTemplate({...template,variables:[{key:'code',required:true}]}),/变量/)
    assert.throws(()=>f.service.saveTemplate({...template,providerTemplateCode:''}),/模板 Code/)
    f.service.saveTemplate(template)
    assert.equal(f.service.templates().find(row=>row.template_key===template.templateKey).scene,'ORDER_STATUS')
  }finally{f.store.close()}
})

test('read-only Aliyun lookup matches original number and settles once without resending', async () => {
  const f=setup()
  try {
    let lookups=0
    let outcome=null
    const result=await f.service.send(f.instance,{templateKey:'otp_login',phone:'13800138000',variables:{code:'123456'}},'lookup-sms-0001')
    f.provider.queryDelivery=async p=>{
      lookups++
      assert.equal(p.phone,'13800138000')
      assert.equal(p.bizId,'biz-1')
      assert.equal(p.outId,result.requestId)
      assert.match(p.sendDate,/^[0-9]{8}$/)
      return outcome
    }
    await assert.rejects(f.service.reconcileDelivery(result.requestId,{phone:'13900139000'}),/手机号与记录不匹配/)
    assert.equal(lookups,0)
    assert.equal((await f.service.reconcileDelivery(result.requestId,{phone:'13800138000'})).checked,false)
    assert.equal(f.service.usageSummary(f.project).waiting_receipt_count,1)
    outcome='DELIVERED'
    const confirmed=await f.service.reconcileDelivery(result.requestId,{phone:'13800138000'})
    assert.equal(confirmed.status,'DELIVERED')
    assert.equal(confirmed.billing.chargedCents,5)
    assert.equal(f.service.usageSummary(f.project).provider_accepted_count,1)
    assert.equal(f.service.usageSummary(f.project).waiting_receipt_count,0)
    assert.equal(receipt(f.service,result).processed,0)
    await assert.rejects(f.service.reconcileDelivery(result.requestId,{phone:'13800138000'}),/等待回执/)
    assert.equal(f.calls,1)
  } finally { f.store.close() }
})

test('Aliyun QuerySendDetails only trusts the matching OutId and terminal status', async () => {
  const {AliyunSmsProvider}=await import('../server/sms-provider.mjs')
  let rows=[]
  const client=new AliyunSmsProvider({fetchImpl:async (url,init)=>{
    assert.equal(new URL(url).hostname,'dysmsapi.aliyuncs.com')
    assert.equal(init.body.get('Action'),'QuerySendDetails')
    assert.equal(init.body.get('BizId'),'biz-test')
    assert.ok(init.body.get('Signature'))
    return {ok:true,json:async()=>({Code:'OK',SmsSendDetailDTOs:{SmsSendDetailDTO:rows}})}
  }})
  const args={accessKeyId:'test',accessKeySecret:'test',phone:'13800138000',sendDate:'20261118',bizId:'biz-test',outId:'ours'}
  rows=[{OutId:'foreign',SendStatus:3},{OutId:'ours',SendStatus:1}]
  assert.equal(await client.queryDelivery(args),null)
  rows[1].SendStatus=2
  assert.equal(await client.queryDelivery(args),'FAILED')
  rows[1].SendStatus=3
  assert.equal(await client.queryDelivery(args),'DELIVERED')
})
