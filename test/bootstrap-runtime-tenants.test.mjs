import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapRuntimeTenants } from '../scripts/bootstrap-runtime-tenants.mjs'

const JAX = '81fa9bd2-2a1e-40ef-8b7e-501b79c3ddf9'
const C742 = '4aa1ade5-cd37-4d25-bd31-5f4f0fba391d'

function mapping(tenants = [{ tenantId: 'jax', instanceId: JAX }, { tenantId: '742', instanceId: C742 }]) {
  return { serviceGroupId: 'delta-shared-prod', productId: 'detla', name: 'Delta 共享生产', maintenanceMaxMinutes: 240, tenants }
}

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'delta-authority-bootstrap-'))
  const path = join(directory, 'authority.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY);
    CREATE TABLE instances(id TEXT PRIMARY KEY,runtime_tenant_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE service_groups(id TEXT PRIMARY KEY,product_id TEXT,name TEXT,status TEXT,maintenance_max_minutes INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE service_group_instances(group_id TEXT,instance_id TEXT UNIQUE,created_at TEXT,PRIMARY KEY(group_id,instance_id));
    CREATE TABLE audit(actor TEXT,action TEXT,target TEXT,detail TEXT,created_at TEXT);
    INSERT INTO products(id) VALUES('detla');
    INSERT INTO instances(id) VALUES('${JAX}');
    INSERT INTO instances(id) VALUES('${C742}');`)
  db.close()
  return { path, directory }
}

test('runtime tenant bootstrap is dry-run by default, idempotent and audited', () => {
  const { path, directory } = database()
  try {
    const dry = bootstrapRuntimeTenants(path, mapping(), false, '2026-11-11T00:00:00Z')
    assert.equal(dry.mode, 'dry-run')
    let db = new DatabaseSync(path)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM instances WHERE runtime_tenant_id<>''").get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM service_groups').get().n, 0)
    db.close()

    const applied = bootstrapRuntimeTenants(path, mapping(), true, '2026-11-11T00:00:00Z')
    assert.equal(applied.mode, 'apply')
    db = new DatabaseSync(path)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM instances WHERE runtime_tenant_id<>''").get().n, 2)
    assert.deepEqual(db.prepare("SELECT runtime_tenant_id FROM instances ORDER BY runtime_tenant_id").all().map(row => row.runtime_tenant_id), ['742', 'jax'])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM service_group_instances').get().n, 2)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='BOOTSTRAP_RUNTIME_TENANTS'").get().n, 1)
    db.close()

    bootstrapRuntimeTenants(path, mapping(), true, '2026-11-11T00:01:00Z')
    db = new DatabaseSync(path)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM service_group_instances').get().n, 2)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='BOOTSTRAP_RUNTIME_TENANTS'").get().n, 2)
    db.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('runtime tenant bootstrap rejects an instance already bound to another tenant', () => {
  const { path, directory } = database()
  try {
    bootstrapRuntimeTenants(path, mapping(), true, '2026-11-11T00:00:00Z')
    assert.throws(() => bootstrapRuntimeTenants(path, mapping([{ tenantId: 'jax', instanceId: JAX }, { tenantId: '747', instanceId: C742 }]), true), /another runtime tenant/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
