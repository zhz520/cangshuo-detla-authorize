import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AuthorityStore } from '../server/store.mjs'
import { createAuthorityServer } from '../server/http.mjs'

const username = 'runtime-owner'
const password = 'Runtime-registry-test-password-2026'
const maintenanceUntil = '2035-01-01T00:00:00.000Z'

function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  return new AuthorityStore({ database: ':memory:', privateKey, ownerUsername: username, ownerPassword: password })
}

async function withServer(run) {
  const store = fixture()
  const server = createAuthorityServer(store)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  let cookie = '', csrf = ''
  async function call(route, method = 'GET', body, expected = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const result = await response.json()
    assert.equal(response.status, expected, method + ' ' + route + ': ' + JSON.stringify(result))
    return { result, response }
  }
  async function login() {
    const result = await call('/api/login', 'POST', { username, password })
    cookie = result.response.headers.get('set-cookie').split(';')[0]
    csrf = result.result.csrf
    return { cookie, csrf }
  }
  try { await run({ store, base, call, login }) }
  finally { await new Promise(resolve => server.close(resolve)); store.close() }
}

test('runtime registry requires authentication and exports all explicitly mapped tenants', async () => {
  await withServer(async ({ store, base, call, login }) => {
    assert(store.db.prepare('PRAGMA table_info(instances)').all().some(column => column.name === 'runtime_tenant_id'))
    assert(store.db.prepare('PRAGMA index_list(instances)').all().some(index => index.name === 'ux_instances_runtime_tenant_id'))

    await call('/api/runtime/tenants', 'GET', undefined, 401)
    const session = await login()

    const withoutCsrf = await fetch(base + '/api/runtime/tenants', { headers: { Cookie: session.cookie } })
    assert.equal(withoutCsrf.status, 200)

    await call('/api/customers', 'POST', { id: 'runtime-a', name: '运行时甲客户' }, 201)
    await call('/api/customers', 'POST', { id: 'runtime-b', name: '运行时乙客户' }, 201)

    const jaxId = randomUUID()
    await call('/api/instances', 'POST', {
      id: jaxId, customerId: 'runtime-a', name: 'JAX', runtimeTenantId: 'jax',
      domains: ['jax.example.com'], maintenanceUntil
    }, 201)
    store.db.prepare('UPDATE instances SET domains=? WHERE id=?').run(JSON.stringify([
      'JAX.Example.COM.', 'jax.example.com', '*.Sub.Example.com.', '*.sub.example.com'
    ]), jaxId)

    const tenant742Id = randomUUID()
    await call('/api/instances', 'POST', {
      id: tenant742Id, customerId: 'runtime-a', name: '742', runtimeTenantId: '742',
      domains: ['chuan742.idcgov.cn', '*.chuan742.idcgov.cn'], maintenanceUntil
    }, 201)

    const tenant747Id = randomUUID()
    await call('/api/instances', 'POST', {
      id: tenant747Id, customerId: 'runtime-a', name: '747', runtimeTenantId: '747',
      domains: ['youci747.idcgov.cn'], maintenanceUntil
    }, 201)

    const pausedProject = (await call('/api/projects', 'POST', {
      customerId: 'runtime-b', productId: 'detla', name: '暂停项目', status: 'PAUSED', maintenanceUntil
    }, 201)).result.id
    await call('/api/instances', 'POST', {
      id: randomUUID(), customerId: 'runtime-b', projectId: pausedProject, name: '暂停租户',
      runtimeTenantId: 'paused-project', domains: ['paused.example.com']
    }, 201)

    await call('/api/instances', 'POST', {
      id: randomUUID(), customerId: 'runtime-b', name: '停用客户租户', runtimeTenantId: 'disabled-customer',
      domains: ['disabled.example.com'], maintenanceUntil
    }, 201)
    await call('/api/customers/runtime-b', 'PUT', { name: '运行时乙客户', status: 'DISABLED', note: '测试停用' })

    const unmappedId = randomUUID()
    await call('/api/instances', 'POST', {
      id: unmappedId, customerId: 'runtime-a', name: '未登记运行时编号',
      domains: ['unmapped.example.com'], maintenanceUntil
    }, 201)

    const registry = (await call('/api/runtime/tenants')).result
    assert.equal(registry.formatVersion, 1)
    assert.equal(Number.isFinite(Date.parse(registry.generatedAt)), true)
    assert.equal(registry.tenants.length, 5)
    assert.deepEqual(registry.tenants.map(item => item.tenantId), ['742', '747', 'disabled-customer', 'jax', 'paused-project'])
    assert.equal(registry.tenants.some(item => item.tenantId === unmappedId || item.platformInstanceId === unmappedId), false)

    const expectedKeys = [
      'active', 'customerId', 'hosts', 'maintenanceUntil', 'name', 'platformCustomerId',
      'platformInstanceId', 'productId', 'projectId', 'serviceGroupId', 'tenantId', 'wildcardDomains'
    ]
    for (const tenant of registry.tenants) assert.deepEqual(Object.keys(tenant).sort(), expectedKeys)

    const jax = registry.tenants.find(item => item.tenantId === 'jax')
    assert.equal(jax.platformInstanceId, jaxId)
    assert.notEqual(jax.tenantId, jax.platformInstanceId)
    assert.equal(jax.platformCustomerId, 'runtime-a')
    assert.equal(jax.customerId, 'runtime-a')
    assert.equal(jax.productId, 'detla')
    assert.equal(jax.serviceGroupId, null)
    assert.equal(jax.maintenanceUntil, maintenanceUntil)
    assert.equal(jax.active, true)
    assert.deepEqual(jax.hosts, ['jax.example.com'])
    assert.deepEqual(jax.wildcardDomains, ['*.sub.example.com'])

    assert.equal(registry.tenants.find(item => item.tenantId === 'paused-project').active, false)
    assert.equal(registry.tenants.find(item => item.tenantId === 'disabled-customer').active, false)
    assert.doesNotMatch(JSON.stringify(registry), /password|privateKey|apiV3Key|accessKey|merchantId|secret/i)

    await call('/api/logout', 'POST', {})
    await call('/api/runtime/tenants', 'GET', undefined, 401)
  })
})

test('runtime tenant ids are globally unique and must use the lowercase contract', async () => {
  await withServer(async ({ call, login }) => {
    await login()
    await call('/api/customers', 'POST', { id: 'runtime-unique', name: '唯一性客户' }, 201)
    await call('/api/instances', 'POST', {
      id: randomUUID(), customerId: 'runtime-unique', name: '首个租户', runtimeTenantId: 'shared-tenant',
      domains: ['first.example.com'], maintenanceUntil
    }, 201)
    await call('/api/instances', 'POST', {
      id: randomUUID(), customerId: 'runtime-unique', name: '重复租户', runtimeTenantId: 'shared-tenant',
      domains: ['second.example.com'], maintenanceUntil
    }, 409)
    await call('/api/instances', 'POST', {
      id: randomUUID(), customerId: 'runtime-unique', name: '大写租户', runtimeTenantId: 'SHARED',
      domains: ['invalid.example.com'], maintenanceUntil
    }, 400)
  })
})

test('legacy databases gain the optional runtime tenant column and unique index', () => {
  const root = 'D:\\CodexData\\temp\\detla-authorize-runtime-registry\\migrations'
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(path.join(root, 'legacy-'))
  const database = path.join(directory, 'authority.sqlite')
  const legacy = new DatabaseSync(database)
  legacy.exec("CREATE TABLE instances (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)")
  legacy.close()
  const { privateKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const store = new AuthorityStore({ database, privateKey, ownerUsername: username, ownerPassword: password })
  try {
    const columns = store.db.prepare('PRAGMA table_info(instances)').all()
    assert(columns.some(column => column.name === 'runtime_tenant_id'))
    const index = store.db.prepare('PRAGMA index_list(instances)').all().find(item => item.name === 'ux_instances_runtime_tenant_id')
    assert(index)
    assert.equal(index.unique, 1)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
