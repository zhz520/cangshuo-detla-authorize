import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { createAuthorityServer } from '../server/http.mjs'

const VERSION = '1.13.0'
const PREVIOUS = '1.12.4'
const REPOSITORY = 'zhz520/cangshuo-detla'

function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({
    database: ':memory:',
    privateKey,
    ownerUsername: 'owner',
    ownerPassword: 'Shared-release-test-password-2026',
  })
  store.db.prepare("UPDATE products SET repository=? WHERE id='detla'").run(REPOSITORY)
  store.createCustomer({ id: 'shared-customer', name: '共享客户' }, 'owner')
  const project = store.management.saveProject(null, {
    customerId: 'shared-customer', productId: 'detla', name: '共享项目', maintenanceUntil: '2030-12-01T00:00:00Z',
  }, 'owner')
  const first = randomUUID()
  const second = randomUUID()
  for (const [id, runtimeTenantId, host] of [
    [first, 'jax', 'jax.example.com'],
    [second, '742', '742.example.com'],
  ]) {
    store.createInstance({
      id, customerId: 'shared-customer', projectId: project.id, name: runtimeTenantId,
      domains: [host], runtimeTenantId, maintenanceUntil: '2030-12-01T00:00:00Z',
    }, 'owner')
  }
  store.releaseService.create({
    version: VERSION,
    channel: 'stable',
    notes: '共享发布计划测试 https://github.com/fixture/private',
    sourceUrl: `https://github.com/${REPOSITORY}/releases/tag/v${VERSION}`,
  }, 'owner')
  store.releaseService.publish('detla', VERSION, 'owner')
  const assets = ['backend', 'admin', 'h5'].map((component, index) => ({
    name: `cangshuo-${component}.zip`,
    url: `https://github.com/${REPOSITORY}/releases/download/v${VERSION}/cangshuo-${component}.zip`,
    size: 1000 + index,
    digest: 'sha256:' + String(index + 1).repeat(64),
  }))
  store.db.prepare('UPDATE release_catalog SET assets=? WHERE product_id=? AND version=?').run(JSON.stringify(assets), 'detla', VERSION)
  return { store, first, second, project }
}

function window() {
  const now = Date.now()
  return { startAt: new Date(now - 60000).toISOString(), endAt: new Date(now + 3600000).toISOString() }
}

test('service group plan signs the exact shared release contract', () => {
  const { store, first, second } = fixture()
  const group = store.serviceGroupService.save({
    id: 'delta-shared-prod', productId: 'detla', name: 'Delta 共享生产', instanceIds: [first, second],
    maintenanceMaxMinutes: 240,
  }, 'owner')
  assert.equal(group.active, true)
  assert.deepEqual(group.members.map(row => row.runtime_tenant_id), ['742', 'jax'])
  const registry = store.runtimeRegistry()
  assert.deepEqual(registry.tenants.map(row => [row.tenantId, row.serviceGroupId]), [['742', 'delta-shared-prod'], ['jax', 'delta-shared-prod']])

  const result = store.serviceGroupService.createPlan('delta-shared-prod', {
    fromVersion: PREVIOUS, targetVersion: VERSION, ...window(),
  }, 'owner')
  assert.equal(result.envelope.format, 'cangshuo-shared-release-v1')
  assert.equal(verify(null, Buffer.from(result.envelope.format + '.' + result.envelope.payload),
    store.publicKey, Buffer.from(result.envelope.signature, 'base64url')), true)
  const claims = JSON.parse(Buffer.from(result.envelope.payload, 'base64url'))
  assert.equal(claims.format, 'cangshuo-shared-release-v1')
  assert.equal(claims.serviceGroupId, 'delta-shared-prod')
  assert.equal(claims.targetVersion, VERSION)
  assert.equal(claims.fromVersion, PREVIOUS)
  assert.deepEqual(claims.tenants, ['742', 'jax'])
  assert.equal(claims.schemaVersion, 1)
  assert.equal(claims.backupRequired, true)
  assert.equal(claims.releaseTag, 'v' + VERSION)
  assert.deepEqual(claims.packages.map(row => row.component), ['backend', 'admin', 'h5'])
  assert.match(store.lists().audit.find(row => row.action === 'CREATE_SHARED_RELEASE_PLAN').detail, /delta-shared-prod/)
})

test('service groups reject duplicate runtime ids and incompatible instances', () => {
  const { store, first, second } = fixture()
  store.serviceGroupService.save({ id: 'one', productId: 'detla', name: '一组', instanceIds: [first] }, 'owner')
  assert.throws(() => store.serviceGroupService.save({ id: 'two', productId: 'detla', name: '二组', instanceIds: [first] }, 'owner'), /其他服务组/)
  const missingRuntime = randomUUID()
  store.createInstance({
    id: missingRuntime, customerId: 'shared-customer', projectId: store.lists().projects[0].id,
    name: 'missing-runtime', domains: ['missing.example.com'], maintenanceUntil: '2030-12-01T00:00:00Z',
  }, 'owner')
  assert.throws(() => store.serviceGroupService.save({ id: 'two', productId: 'detla', name: '二组', instanceIds: [missingRuntime] }, 'owner'), /尚未配置运行租户编号/)
  assert.throws(() => store.createInstance({
    id: randomUUID(), customerId: 'shared-customer', projectId: store.lists().projects[0].id,
    name: 'duplicate', domains: ['dup.example.com'], runtimeTenantId: 'jax', maintenanceUntil: '2030-12-01T00:00:00Z',
  }, 'owner'), /已被其他实例使用/)
})

test('signed shared release API requires login and emits a downloadable envelope', async () => {
  const { store, first, second } = fixture()
  const server = createAuthorityServer(store)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  let cookie = ''
  let csrf = ''
  async function call(route, method = 'GET', body, expected = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    assert.equal(response.status, expected, method + ' ' + route + ': ' + JSON.stringify(result))
    return { result, response }
  }
  try {
    await call('/api/service-groups', 'GET', undefined, 401)
    const login = await call('/api/login', 'POST', { username: 'owner', password: 'Shared-release-test-password-2026' })
    cookie = login.response.headers.get('set-cookie').split(';')[0]
    csrf = login.result.csrf
    await call('/api/service-groups', 'POST', {
      id: 'delta-shared-prod', productId: 'detla', name: 'Delta 共享生产', instanceIds: [first, second],
    }, 201)
    const created = await call('/api/service-groups/delta-shared-prod/plans', 'POST', {
      fromVersion: PREVIOUS, targetVersion: VERSION, ...window(),
    }, 201)
    assert.equal(created.result.envelope.format, 'cangshuo-shared-release-v1')
    const listed = await call('/api/service-groups/delta-shared-prod/plans')
    assert.equal(listed.result[0].id, created.result.id)
    const envelope = await call('/api/shared-release-plans/' + created.result.id)
    assert.equal(envelope.result.envelope.signature, created.result.envelope.signature)
  } finally {
    await new Promise(resolve => server.close(resolve))
    store.close()
  }
})
