import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { UsageBilling } from '../server/usage.mjs'
import { createAuthorityServer } from '../server/http.mjs'

function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: 'owner', ownerPassword: 'HTTP-usage-only-password-2026' })
  const customer = store.createCustomer({ id: 'usage-customer', name: '用量接口客户' }, 'owner')
  const project = store.management.saveProject(null, { customerId: customer.id, productId: 'detla', name: '用量接口项目', maintenanceUntil: '2030-12-01T00:00:00Z' }, 'owner').id
  const id = randomUUID()
  store.createInstance({ id, customerId: customer.id, projectId: project, name: '用量接口实例', domains: ['usage.example.com'] }, 'owner')
  const billing = new UsageBilling(store)
  billing.credit(id, 1000, 'http-credit-ref', 'owner')
  billing.saveAccount(id, { billingMode: 'METERED', unitPriceCents: 100 }, 'owner')
  return { store, id, billing }
}

test('manual identity credit and stale release routes are idempotent and audited', async () => {
  const f = fixture()
  const server = createAuthorityServer(f.store)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  let cookie = ''
  let csrf = ''
  async function call(route, method = 'GET', body, expected = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const value = await response.json()
    assert.equal(response.status, expected, method + ' ' + route + ': ' + JSON.stringify(value))
    return value
  }
  try {
    const response = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'HTTP-usage-only-password-2026' })
    })
    const login = await response.json()
    assert.equal(response.status, 200)
    cookie = response.headers.get('set-cookie').split(';')[0]
    csrf = login.csrf

    const replay = await call('/api/usage/accounts/' + f.id + '/credit', 'POST', { amountCents: 1000, reference: 'http-credit-ref' })
    assert.equal(replay.idempotent, true)
    assert.equal(f.billing.ensure(f.id).balance_cents, 1000)

    const reservation = f.billing.reserve(f.id, 'http-stale-request', 'subject-http', 100)
    f.store.db.prepare('UPDATE verification_requests SET updated_at=? WHERE id=?')
      .run(new Date(Date.now() - 120000).toISOString(), reservation.request.id)
    const released = await call('/api/usage/requests/' + reservation.request.id + '/release', 'POST', {})
    assert.equal(released.released, true)
    assert.equal(f.billing.ensure(f.id).reserved_cents, 0)
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='SERVICE_REQUEST_RELEASE'").get().count, 1)
    const replayRelease = await call('/api/usage/requests/' + reservation.request.id + '/release', 'POST', {})
    assert.equal(replayRelease.idempotent, true)
    const swept = await call('/api/usage/accounts/' + f.id + '/release-stale', 'POST', { olderThanMs: 600000 })
    assert.equal(swept.releasedCount, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    f.store.close()
  }
})
