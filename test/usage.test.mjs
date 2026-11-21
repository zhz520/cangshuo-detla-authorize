import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { UsageBilling } from '../server/usage.mjs'
import { IdentityPackageService } from '../server/identity-packages.mjs'

function setup() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'Only-a-test-password-2026' })
  store.createCustomer({ id: 'a', name: '客户A' }, 'owner')
  const project = store.management.saveProject(null, { customerId: 'a', productId: 'detla', name: '项目A', maintenanceUntil: '2028-12-01T00:00:00Z' }, 'owner').id
  const instance = randomUUID()
  store.createInstance({ id: instance, customerId: 'a', projectId: project, name: '实例A', domains: ['a.example.com'] }, 'owner')
  const billing = new UsageBilling(store)
  return { store, instance, project, billing, packages: new IdentityPackageService(store, { billing }) }
}

function addInstance(store, project, name, domain) {
  const id = randomUUID()
  store.createInstance({ id, customerId: 'a', projectId: project, name, domains: [domain] }, 'owner')
  return id
}

function ageRequest(store, requestId, ageMs) {
  store.db.prepare('UPDATE verification_requests SET updated_at=? WHERE id=?').run(new Date(Date.now() - ageMs).toISOString(), requestId)
}

function auditCount(store, action) {
  return store.db.prepare('SELECT COUNT(*) AS count FROM audit WHERE action=?').get(action).count
}

test('usage balance reserves once and settles idempotently', () => {
  const { store, instance, billing } = setup()
  try {
    billing.credit(instance, 1000, 'test-credit', 'owner')
    billing.saveAccount(instance, { billingMode: 'METERED', unitPriceCents: 300 }, 'owner')
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

test('credit is idempotent for the same instance and non-empty reference', () => {
  const { store, instance, billing } = setup()
  try {
    const first = billing.credit(instance, 1000, 'credit-ref-1', 'owner')
    const replay = billing.credit(instance, 1000, 'credit-ref-1', 'owner')
    assert.equal(first.idempotent, false)
    assert.equal(replay.idempotent, true)
    assert.equal(replay.balanceCents, 1000)
    assert.equal(billing.ensure(instance).balance_cents, 1000)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='CREDIT' AND reference='credit-ref-1'").get().count, 1)
    assert.equal(auditCount(store, 'SERVICE_CREDIT'), 1)

    assert.throws(() => billing.credit(instance, 2000, 'credit-ref-1', 'owner'), /充值引用已用于其他金额/)
    assert.equal(billing.ensure(instance).balance_cents, 1000)

    const differentReference = billing.credit(instance, 500, 'credit-ref-2', 'owner')
    assert.equal(differentReference.idempotent, false)
    assert.equal(differentReference.balanceCents, 1500)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='CREDIT'").get().count, 2)
  } finally { store.close() }
})

test('empty credit reference keeps the existing validation behavior', () => {
  const { store, instance, billing } = setup()
  try {
    for (const reference of ['', '   ', null, undefined]) {
      assert.throws(() => billing.credit(instance, 100, reference, 'owner'), /充值引用不能为空/)
    }
    assert.equal(billing.ensure(instance).balance_cents, 0)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='CREDIT'").get().count, 0)
  } finally { store.close() }
})

test('credit reference idempotency is scoped to one instance', () => {
  const { store, instance, project, billing } = setup()
  try {
    const secondInstance = addInstance(store, project, '实例B', 'b.example.com')
    billing.credit(instance, 700, 'shared-reference', 'owner')
    const second = billing.credit(secondInstance, 700, 'shared-reference', 'owner')
    assert.equal(second.idempotent, false)
    assert.equal(billing.ensure(instance).balance_cents, 700)
    assert.equal(billing.ensure(secondInstance).balance_cents, 700)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='CREDIT' AND reference='shared-reference'").get().count, 2)
  } finally { store.close() }
})

test('releaseStale releases only aged meter holds and is idempotent', () => {
  const { store, instance, billing } = setup()
  try {
    billing.credit(instance, 1000, 'meter-credit', 'owner')
    billing.saveAccount(instance, { billingMode: 'METERED', unitPriceCents: 300 }, 'owner')
    const reservation = billing.reserve(instance, 'meter-stale-1', 'subject-meter', 300)
    assert.equal(billing.ensure(instance).reserved_cents, 300)

    const tooYoung = billing.releaseStale(instance, 1, 'owner')
    assert.equal(tooYoung.olderThanMs, 60000)
    assert.equal(tooYoung.releasedCount, 0)
    assert.equal(tooYoung.failed.length, 0)
    assert.equal(billing.ensure(instance).reserved_cents, 300)
    assert.equal(store.db.prepare('SELECT status FROM verification_requests WHERE id=?').get(reservation.request.id).status, 'RESERVED')

    ageRequest(store, reservation.request.id, 120000)
    const released = billing.releaseStale(instance, 60000, 'owner')
    assert.equal(released.releasedCount, 1)
    assert.equal(released.released[0].status, 'RELEASED')
    assert.equal(released.released[0].result, 'STALE_RELEASE')
    const account = billing.ensure(instance)
    assert.equal(account.balance_cents, 1000)
    assert.equal(account.reserved_cents, 0)
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM service_ledger WHERE type='DEBIT'").get().count, 0)
    assert.equal(auditCount(store, 'SERVICE_REQUEST_RELEASE'), 1)

    const replay = billing.releaseStale(instance, 60000, 'owner')
    assert.equal(replay.releasedCount, 0)
    assert.equal(billing.ensure(instance).reserved_cents, 0)
    assert.equal(auditCount(store, 'SERVICE_REQUEST_RELEASE'), 1)
    const byId = billing.releaseRequest(reservation.request.id, 'owner')
    assert.equal(byId.released, false)
    assert.equal(byId.idempotent, true)
    assert.equal(byId.request.status, 'RELEASED')
  } finally { store.close() }
})

test('releaseStale releases only aged package holds and is idempotent', () => {
  const { store, instance, billing, packages } = setup()
  try {
    billing.saveAccount(instance, { billingMode: 'PACKAGE', unitPriceCents: 100 }, 'owner')
    const product = packages.savePackage({ code: 'identity-package-5', name: '五次套餐', verificationCount: 5, priceCents: 0, validityDays: 30, status: 'ACTIVE' }, 'owner')
    const grant = packages.grantPackage(instance, product.id, 'owner')
    const reservation = billing.reserve(instance, 'package-stale-1', 'subject-package', 100)
    assert.equal(reservation.request.billing_mode, 'PACKAGE')
    assert.equal(reservation.request.package_balance_id, grant.id)
    assert.equal(store.db.prepare('SELECT reserved_count FROM identity_package_balances WHERE id=?').get(grant.id).reserved_count, 1)

    assert.equal(billing.releaseStale(instance, 60000, 'owner').releasedCount, 0)
    assert.equal(store.db.prepare('SELECT reserved_count FROM identity_package_balances WHERE id=?').get(grant.id).reserved_count, 1)

    ageRequest(store, reservation.request.id, 120000)
    const released = billing.releaseStale(instance, 60000, 'operator')
    assert.equal(released.releasedCount, 1)
    assert.equal(released.released[0].status, 'RELEASED')
    const packageBalance = store.db.prepare('SELECT remaining_count,reserved_count FROM identity_package_balances WHERE id=?').get(grant.id)
    assert.equal(packageBalance.remaining_count, 5)
    assert.equal(packageBalance.reserved_count, 0)
    assert.equal(billing.ensure(instance).reserved_cents, 0)
    assert.equal(store.db.prepare("SELECT actor FROM audit WHERE action='SERVICE_REQUEST_RELEASE'").get().actor, 'operator')
    assert.equal(auditCount(store, 'SERVICE_REQUEST_RELEASE'), 1)

    assert.equal(billing.releaseStale(instance, 60000, 'operator').releasedCount, 0)
    assert.equal(store.db.prepare('SELECT reserved_count FROM identity_package_balances WHERE id=?').get(grant.id).reserved_count, 0)
    assert.equal(auditCount(store, 'SERVICE_REQUEST_RELEASE'), 1)
  } finally { store.close() }
})

test('releaseRequest releases a selected reservation once and audits the actor', () => {
  const { store, instance, billing } = setup()
  try {
    billing.credit(instance, 500, 'manual-credit', 'owner')
    billing.saveAccount(instance, { billingMode: 'METERED', unitPriceCents: 100 }, 'owner')
    const reservation = billing.reserve(instance, 'manual-release-1', 'subject-manual', 100)
    assert.equal(billing.ensure(instance).reserved_cents, 100)

    const tooYoung = billing.releaseRequest(reservation.request.id, 'operator')
    assert.equal(tooYoung.released, false)
    assert.equal(tooYoung.skipped, 'TOO_RECENT')
    assert.equal(billing.ensure(instance).reserved_cents, 100)

    ageRequest(store, reservation.request.id, 120000)
    const released = billing.releaseRequest(reservation.request.id, 'operator')
    assert.equal(released.released, true)
    assert.equal(released.idempotent, false)
    assert.equal(released.request.status, 'RELEASED')
    assert.equal(released.request.result, 'MANUAL_RELEASE')
    assert.equal(billing.ensure(instance).reserved_cents, 0)
    assert.equal(billing.ensure(instance).balance_cents, 500)
    assert.equal(store.db.prepare("SELECT actor FROM audit WHERE action='SERVICE_REQUEST_RELEASE'").get().actor, 'operator')

    const replay = billing.releaseRequest(reservation.request.id, 'operator')
    assert.equal(replay.released, false)
    assert.equal(replay.idempotent, true)
    assert.equal(billing.ensure(instance).reserved_cents, 0)
    assert.equal(auditCount(store, 'SERVICE_REQUEST_RELEASE'), 1)
  } finally { store.close() }
})
