import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { UsageBilling } from '../server/usage.mjs'

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'a', name: '客户A' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'a', productId: 'detla', name: '项目A', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'a', projectId: project, name: '实例A', domains: ['a.example.com'] }, 'owner')
  return { store, instance, billing: new UsageBilling(store) }
}

test('usage balance reserves once and settles idempotently', () => {
  const { store, instance, billing } = setup()
  try {
    billing.credit(instance, 1000, 'test-credit', 'owner')
    const first = billing.reserve(instance, 'req-1', 'subject-1', 300)
    const duplicate = billing.reserve(instance, 'req-1', 'subject-1', 300)
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.equal(duplicate.request.id, first.request.id)
    assert.equal(billing.ensure(instance).reserved_cents, 300)
    billing.settle(instance, 'req-1', 'MATCH', true)
    billing.settle(instance, 'req-1', 'MATCH', true)
    const account = billing.ensure(instance)
    assert.equal(account.balance_cents, 700)
    assert.equal(account.reserved_cents, 0)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM service_ledger').get().count, 2)
  } finally { store.close() }
})

test('insufficient balance is rejected without creating a request', () => {
  const { store, instance, billing } = setup()
  try {
    assert.throws(() => billing.reserve(instance, 'req-2', 'subject-2', 1), /余额不足/)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM verification_requests').get().count, 0)
  } finally { store.close() }
})
