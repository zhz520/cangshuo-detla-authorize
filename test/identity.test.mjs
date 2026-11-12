import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { UsageBilling } from '../server/usage.mjs'
import { IdentityVerificationService, validateIdNumber } from '../server/identity.mjs'

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'a', name: '客户A' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'a', productId: 'detla', name: '项目A', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'a', projectId: project, name: '实例A', domains: ['a.example.com'] }, 'owner')
  store.createEntitlement({
    instanceId: instance,
    moduleId: 'identity_verification',
    validFrom: new Date(Date.now() - 60000).toISOString(),
    validUntil: '2028-01-01T00:00:00.000Z'
  }, 'owner')
  return { store, instance, license: store.management.identity(instance, 'owner'), billing: new UsageBilling(store) }
}

test('identity verification charges once and replays the result without a second charge', async () => {
  const { store, instance, license, billing } = setup()
  try {
    billing.credit(instance, 1000, 'test-credit', 'owner')
    let calls = 0
    const provider = { configured: () => true, verify: async () => { calls++; return { matched: true, reference: 'provider-1' } } }
    const service = new IdentityVerificationService(store, billing, provider, { priceCents: 100, subjectPepper: 'test-pepper' })
    const body = { license, version: '1.15.0', idempotencyKey: 'identity-request-0001', realName: '张三', idNumber: '11010519491231002X' }

    const first = await service.verify(body)
    const replay = await service.verify(body)

    assert.equal(first.matched, true)
    assert.equal(first.alreadyProcessed, false)
    assert.equal(replay.alreadyProcessed, true)
    assert.equal(calls, 1)
    assert.equal(billing.ensure(instance).balance_cents, 900)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM service_ledger').get().count, 2)
  } finally { store.close() }
})

test('provider failure releases the hold and a retry can use the same idempotency key', async () => {
  const { store, instance, license, billing } = setup()
  try {
    billing.credit(instance, 500, 'test-credit', 'owner')
    let failNext = true
    const provider = { configured: () => true, verify: async () => {
      if (failNext) { failNext = false; throw new Error('provider unavailable') }
      return { matched: true, reference: 'provider-2' }
    } }
    const service = new IdentityVerificationService(store, billing, provider, { priceCents: 100, subjectPepper: 'test-pepper' })
    const body = { license, version: '1.15.0', idempotencyKey: 'identity-request-0002', realName: '李四', idNumber: '11010519491231002X' }

    await assert.rejects(() => service.verify(body), /暂时不可用/)
    assert.equal(billing.ensure(instance).reserved_cents, 0)
    assert.equal(billing.ensure(instance).balance_cents, 500)

    const retried = await service.verify(body)
    assert.equal(retried.matched, true)
    assert.equal(billing.ensure(instance).balance_cents, 400)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='DEBIT'").get().count, 1)
  } finally { store.close() }
})

test('identity request is rejected when the instance lacks the paid entitlement', async () => {
  const { store, instance, license, billing } = setup()
  try {
    store.db.prepare('DELETE FROM entitlements WHERE instance_id=? AND module_id=?').run(instance, 'identity_verification')
    billing.credit(instance, 500, 'test-credit', 'owner')
    const service = new IdentityVerificationService(store, billing,
      { configured: () => true, verify: async () => ({ matched: true }) },
      { priceCents: 100, subjectPepper: 'test-pepper' })

    await assert.rejects(() => service.verify({ license, version: '1.15.0', idempotencyKey: 'identity-request-0003', realName: '王五', idNumber: '11010519491231002X' }), /未开通实名认证模块/)
    assert.equal(billing.ensure(instance).balance_cents, 500)
  } finally { store.close() }
})

test('a concurrent reservation is rejected while a stale reservation can be safely retried', async () => {
  const { store, instance, license, billing } = setup()
  try {
    billing.credit(instance, 500, 'test-credit', 'owner')
    let calls = 0
    const service = new IdentityVerificationService(store, billing,
      { configured: () => true, verify: async () => { calls++; return { matched: true, reference: 'provider-3' } } },
      { priceCents: 100, subjectPepper: 'test-pepper' })
    const body = { license, version: '1.15.0', idempotencyKey: 'identity-request-0004', realName: '赵六', idNumber: '11010519491231002X' }
    billing.reserve(instance, body.idempotencyKey, 'subject-4', 100)

    await assert.rejects(() => service.verify(body), /正在处理中/)
    assert.equal(calls, 0)
    store.db.prepare('UPDATE verification_requests SET updated_at=? WHERE idempotency_key=?').run(new Date(Date.now() - 120000).toISOString(), body.idempotencyKey)
    const retried = await service.verify(body)
    assert.equal(retried.matched, true)
    assert.equal(calls, 1)
    assert.equal(billing.ensure(instance).balance_cents, 400)
    assert.equal(billing.ensure(instance).reserved_cents, 0)
  } finally { store.close() }
})

test('Chinese identity number checksum is validated before billing', () => {
  assert.equal(validateIdNumber('11010519491231002x'), '11010519491231002X')
  assert.throws(() => validateIdNumber('110105194912310021'), /校验失败/)
})
