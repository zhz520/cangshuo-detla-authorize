#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TENANT = /^[a-z0-9][a-z0-9-]{0,47}$/
const GROUP = /^[a-z0-9][a-z0-9-]{0,47}$/
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/

function loadMapping(path) {
  const value = JSON.parse(readFileSync(resolve(path), 'utf8'))
  if (!value || typeof value !== 'object') throw new Error('mapping must be a JSON object')
  const serviceGroupId = String(value.serviceGroupId || '')
  const productId = String(value.productId || '')
  const name = String(value.name || '')
  const maintenanceMaxMinutes = value.maintenanceMaxMinutes ?? 240
  if (!GROUP.test(serviceGroupId)) throw new Error('invalid serviceGroupId')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) throw new Error('invalid productId')
  if (!name.trim() || name.length > 80) throw new Error('invalid service group name')
  if (!Number.isInteger(maintenanceMaxMinutes) || maintenanceMaxMinutes < 1 || maintenanceMaxMinutes > 1440) throw new Error('invalid maintenanceMaxMinutes')
  if (!Array.isArray(value.tenants) || !value.tenants.length) throw new Error('tenants must be a non-empty array')
  const ids = new Set()
  const instanceIds = new Set()
  const tenants = value.tenants.map((row, index) => {
    if (!row || !TENANT.test(String(row.tenantId || '')) || !UUID.test(String(row.instanceId || ''))) throw new Error('invalid tenant entry at index ' + index)
    if (ids.has(row.tenantId)) throw new Error('duplicate tenantId: ' + row.tenantId)
    if (instanceIds.has(row.instanceId)) throw new Error('duplicate instanceId: ' + row.instanceId)
    ids.add(row.tenantId)
    instanceIds.add(row.instanceId)
    return { tenantId: row.tenantId, instanceId: row.instanceId }
  })
  return { serviceGroupId, productId, name: name.trim(), maintenanceMaxMinutes, tenants }
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

export function bootstrapRuntimeTenants(database, mapping, apply = false, now = new Date().toISOString()) {
  const db = new DatabaseSync(database)
  db.exec('PRAGMA busy_timeout=5000')
  try {
    for (const table of ('instances products service_groups service_group_instances audit').split(' ')) {
      if (!tableExists(db, table)) throw new Error('missing table: ' + table)
    }
    const product = db.prepare('SELECT id FROM products WHERE id=?').get(mapping.productId)
    if (!product) throw new Error('product does not exist: ' + mapping.productId)
    const rows = mapping.tenants.map(item => {
      const row = db.prepare('SELECT id,runtime_tenant_id FROM instances WHERE id=?').get(item.instanceId)
      if (!row) throw new Error('instance does not exist: ' + item.instanceId)
      if (row.runtime_tenant_id && row.runtime_tenant_id !== item.tenantId) throw new Error('instance already has another runtime tenant: ' + item.instanceId)
      const conflict = db.prepare('SELECT id FROM instances WHERE runtime_tenant_id=? AND id<>?').get(item.tenantId, item.instanceId)
      if (conflict) throw new Error('runtime tenant is already assigned to another instance: ' + item.tenantId)
      return item
    })
    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      serviceGroupId: mapping.serviceGroupId,
      productId: mapping.productId,
      name: mapping.name,
      maintenanceMaxMinutes: mapping.maintenanceMaxMinutes,
      tenants: rows.map(row => ({ tenantId: row.tenantId, instanceId: row.instanceId })),
    }
    if (!apply) return summary
    db.exec('BEGIN IMMEDIATE')
    try {
      const updateMany = db.prepare('UPDATE instances SET runtime_tenant_id=? WHERE id=? AND (runtime_tenant_id=? OR runtime_tenant_id=?)')
      for (const row of rows) {
        const result = updateMany.run(row.tenantId, row.instanceId, row.tenantId, '')
        if (result.changes !== 1) throw new Error('instance runtime tenant update did not change one row: ' + row.instanceId)
      }
      db.prepare("INSERT INTO service_groups(id,product_id,name,status,maintenance_max_minutes,created_at,updated_at) VALUES (?,?,?,'ACTIVE',?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,status='ACTIVE',maintenance_max_minutes=excluded.maintenance_max_minutes,updated_at=excluded.updated_at")
        .run(mapping.serviceGroupId, mapping.productId, mapping.name, mapping.maintenanceMaxMinutes, now, now)
      db.prepare('DELETE FROM service_group_instances WHERE group_id=?').run(mapping.serviceGroupId)
      const add = db.prepare('INSERT INTO service_group_instances(group_id,instance_id,created_at) VALUES (?,?,?)')
      for (const row of rows) add.run(mapping.serviceGroupId, row.instanceId, now)
      db.prepare('INSERT INTO audit(actor,action,target,detail,created_at) VALUES (?,?,?,?,?)')
        .run('system:bootstrap-runtime-tenants', 'BOOTSTRAP_RUNTIME_TENANTS', mapping.serviceGroupId,
          JSON.stringify({ tenants: rows.map(row => row.tenantId), productId: mapping.productId }), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return summary
  } finally {
    db.close()
  }
}

function main() {
  const args = process.argv.slice(2)
  const options = { apply: false }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--database') options.database = args[++index]
    else if (args[index] === '--mapping') options.mapping = args[++index]
    else if (args[index] === '--apply') options.apply = true
    else throw new Error('unknown argument: ' + args[index])
  }
  if (!options.database || !options.mapping) throw new Error('--database and --mapping are required')
  const mapping = loadMapping(options.mapping)
  console.log(JSON.stringify(bootstrapRuntimeTenants(options.database, mapping, options.apply), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error('ERROR: ' + error.message)
    process.exit(2)
  }
}
