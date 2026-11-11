import { randomUUID } from 'node:crypto'
import { compareVersions, fail, identifier, integer, text, timestamp } from './store.mjs'

const FORMAT = 'cangshuo-shared-release-v1'
const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const COMPONENTS = ('backend admin h5').split(' ')
const MAX_PLAN_MINUTES = 15

const tenantIdentifier = value => {
  const result = text(value, '运行租户编号', 48)
  if (!TENANT_ID.test(result)) fail('运行租户编号只能包含小写字母、数字和短横线')
  return result
}

const version = (value, label) => {
  const result = text(value, label, 80)
  if (!VERSION.test(result)) fail(label + '须为 MAJOR.MINOR.PATCH')
  return result
}

const isoNow = () => new Date().toISOString()

export class ServiceGroups {
  constructor(store) {
    this.store = store
    this.db = store.db
  }

  members(groupId) {
    return this.db.prepare(`SELECT i.id AS instance_id,i.runtime_tenant_id,i.name AS instance_name,
      i.customer_id,c.name AS customer_name,i.project_id,p.name AS project_name,p.status AS project_status,
      p.maintenance_until,p.product_id
      FROM service_group_instances sgi
      JOIN instances i ON i.id=sgi.instance_id
      JOIN customers c ON c.id=i.customer_id
      JOIN projects p ON p.id=i.project_id
      WHERE sgi.group_id=? ORDER BY i.runtime_tenant_id,i.id`).all(groupId)
  }

  view(row) {
    const members = this.members(row.id)
    return {
      ...row,
      maintenance_max_minutes: row.maintenance_max_minutes,
      members,
      active: row.status === 'ACTIVE' && members.length > 0
        && members.every(member => member.project_status === 'ACTIVE' && Date.parse(member.maintenance_until) > Date.now()),
    }
  }

  list() {
    return this.db.prepare('SELECT * FROM service_groups ORDER BY created_at DESC,id').all().map(row => this.view(row))
  }

  find(id) {
    const row = this.db.prepare('SELECT * FROM service_groups WHERE id=?').get(text(id, '服务组编号', 48))
    if (!row) fail('服务组不存在', 404)
    return this.view(row)
  }

  save(body, actor, fixedId = null) {
    const id = fixedId || identifier(body.id, '服务组编号')
    if (!GROUP_ID.test(id)) fail('服务组编号只能包含小写字母、数字和短横线')
    const name = text(body.name, '服务组名称', 80)
    const productId = identifier(body.productId, '软件编号')
    if (!this.db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) fail('软件不存在', 404)
    const status = body.status || 'ACTIVE'
    if (!['ACTIVE', 'PAUSED'].includes(status)) fail('服务组状态不正确')
    const maxMinutes = integer(body.maintenanceMaxMinutes ?? 240, '维护窗口上限（分钟）', 1, 1440)
    const instanceIds = body.instanceIds
    if (!Array.isArray(instanceIds) || !instanceIds.length || instanceIds.length > 200
      || instanceIds.some(item => typeof item !== 'string')) fail('服务组必须包含 1 至 200 个实例')
    if (new Set(instanceIds).size !== instanceIds.length) fail('服务组实例不能重复')

    const members = []
    const tenantIds = new Set()
    for (const instanceId of instanceIds) {
      const row = this.db.prepare(`SELECT i.id,i.runtime_tenant_id,p.product_id,p.status AS project_status,
        p.maintenance_until FROM instances i JOIN projects p ON p.id=i.project_id WHERE i.id=?`).get(instanceId)
      if (!row) fail('服务组实例不存在：' + instanceId, 404)
      if (!row.runtime_tenant_id) fail('实例尚未配置运行租户编号：' + instanceId)
      if (tenantIds.has(row.runtime_tenant_id)) fail('服务组内运行租户编号重复')
      if (row.product_id !== productId) fail('服务组实例必须属于同一软件')
      tenantIds.add(row.runtime_tenant_id)
      members.push(row)
    }
    const occupied = this.db.prepare(`SELECT sgi.group_id,i.id FROM service_group_instances sgi
      JOIN instances i ON i.id=sgi.instance_id WHERE sgi.instance_id IN (${instanceIds.map(() => '?').join(',')})
      AND sgi.group_id<>?`).all(...instanceIds, id)
    if (occupied.length) fail('实例已经属于其他服务组：' + occupied.map(row => row.id).join(', '), 409)

    const at = isoNow()
    return this.store.transaction(() => {
      this.db.prepare(`INSERT INTO service_groups(id,product_id,name,status,maintenance_max_minutes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,
        status=excluded.status,maintenance_max_minutes=excluded.maintenance_max_minutes,updated_at=excluded.updated_at`)
        .run(id, productId, name, status, maxMinutes, at, at)
      this.db.prepare('DELETE FROM service_group_instances WHERE group_id=?').run(id)
      const add = this.db.prepare('INSERT INTO service_group_instances(group_id,instance_id,created_at) VALUES (?,?,?)')
      for (const member of members) add.run(id, member.id, at)
      this.store.audit(actor, fixedId ? 'UPDATE_SERVICE_GROUP' : 'CREATE_SERVICE_GROUP', id, {
        productId,instanceIds,runtimeTenantIds:members.map(member => member.runtime_tenant_id).sort(),status,
      })
      return this.find(id)
    })
  }

  createPlan(groupId, body, actor) {
    const group = this.find(groupId)
    if (group.status !== 'ACTIVE') fail('服务组已暂停，不能签发发布计划', 409)
    const members = group.members
    if (!members.length) fail('服务组没有实例')
    const now = new Date()
    const start = new Date(timestamp(body.startAt, '维护窗口开始时间'))
    const end = new Date(timestamp(body.endAt, '维护窗口结束时间'))
    if (start > now) fail('维护窗口尚未开始')
    if (end <= now) fail('维护窗口已结束')
    if (end <= start || end - start > group.maintenance_max_minutes * 60000) fail('维护窗口超过服务组配置上限')
    for (const member of members) {
      if (member.project_status !== 'ACTIVE') fail('实例所属项目未启用：' + member.instance_id, 409)
      if (Date.parse(member.maintenance_until) <= now.getTime()) fail('实例维护期已到期：' + member.instance_id, 409)
      if (!member.runtime_tenant_id || !TENANT_ID.test(member.runtime_tenant_id)) fail('实例运行租户编号无效：' + member.instance_id)
    }
    const tenantIds = members.map(member => member.runtime_tenant_id).sort()
    if (new Set(tenantIds).size !== tenantIds.length) fail('服务组运行租户编号重复')

    const targetVersion = version(body.targetVersion, '目标版本')
    const fromVersion = version(body.fromVersion, '当前版本')
    if (compareVersions(targetVersion, fromVersion) < 0) fail('目标版本不能低于当前版本')
    const release = this.db.prepare(`SELECT version,notes,source_url,status,assets,items FROM release_catalog
      WHERE product_id=? AND version=?`).get(group.product_id, targetVersion)
    if (!release) fail('正式版本目录不存在', 409)
    if (release.status !== 'PUBLISHED') fail('目标版本尚未发布为正式版', 409)
    const source = new URL(release.source_url)
    const releaseTag = 'v' + targetVersion
    if (source.origin !== 'https://github.com' || !source.pathname.endsWith('/releases/tag/' + releaseTag)) {
      fail('正式版本仓库地址与目标版本不匹配', 409)
    }
    let assets
    try { assets = JSON.parse(release.assets || '[]') } catch { fail('正式版本资产目录损坏', 409) }
    if (!Array.isArray(assets)) fail('正式版本资产目录无效', 409)
    const packages = COMPONENTS.map(component => {
      const asset = assets.find(item => item.name === 'cangshuo-' + component + '.zip')
      if (!asset || !DIGEST.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 500000000) {
        fail('正式版本缺少可校验的 ' + component + ' 更新包', 409)
      }
      let url
      try { url = new URL(asset.url) } catch { fail('更新包地址无效：' + component, 409) }
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/' + source.pathname.split('/')[1] + '/' + source.pathname.split('/')[2] + '/releases/download/' + releaseTag + '/')) {
        fail('更新包地址没有绑定到当前正式版本：' + component, 409)
      }
      return { component, version: targetVersion, url: url.href, size: asset.size, sha256: asset.digest.slice(7) }
    })
    let items = []
    try { items = JSON.parse(release.items || '[]').map(item => String(item.id || '')).filter(Boolean).slice(0, 100) } catch { items = [] }
    const id = randomUUID()
    const issuedAt = now.toISOString()
    const expiresAt = new Date(Math.min(now.getTime() + MAX_PLAN_MINUTES * 60000, end.getTime())).toISOString()
    const plan = {
      format: FORMAT,
      id,
      serviceGroupId: group.id,
      issuedAt,
      expiresAt,
      maintenanceWindow: { startAt: start.toISOString(), endAt: end.toISOString() },
      schemaVersion: 1,
      backupRequired: true,
      releaseTag,
      tenants: tenantIds,
      targetVersion,
      fromVersion,
      packages,
      items,
    }
    const envelope = this.store.management.signed(FORMAT, plan)
    return this.store.transaction(() => {
      this.db.prepare(`INSERT INTO shared_release_plans(id,group_id,product_id,target_version,from_version,
        tenants,window_start,window_end,envelope,status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, group.id, group.product_id, targetVersion, fromVersion,
        JSON.stringify(tenantIds), start.toISOString(), end.toISOString(), JSON.stringify(envelope), 'CREATED', actor, issuedAt)
      this.store.audit(actor, 'CREATE_SHARED_RELEASE_PLAN', id, {
        serviceGroupId: group.id, productId: group.product_id, targetVersion, fromVersion, tenants: tenantIds,
        packages: packages.map(item => ({ component: item.component, version: item.version, sha256: item.sha256 })),
      })
      return { id, serviceGroupId: group.id, targetVersion, fromVersion, tenants: tenantIds, envelope }
    })
  }

  plans(groupId = null) {
    const rows = groupId
      ? this.db.prepare('SELECT * FROM shared_release_plans WHERE group_id=? ORDER BY created_at DESC LIMIT 100').all(groupId)
      : this.db.prepare('SELECT * FROM shared_release_plans ORDER BY created_at DESC LIMIT 100').all()
    return rows.map(row => ({
      id: row.id, groupId: row.group_id, productId: row.product_id, targetVersion: row.target_version,
      fromVersion: row.from_version, tenants: JSON.parse(row.tenants || '[]'),
      maintenanceWindow: { startAt: row.window_start, endAt: row.window_end },
      status: row.status, createdBy: row.created_by, createdAt: row.created_at,
    }))
  }

  getPlan(id) {
    const row = this.db.prepare('SELECT * FROM shared_release_plans WHERE id=?').get(text(id, '发布计划编号', 36))
    if (!row) fail('发布计划不存在', 404)
    return {
      id: row.id, groupId: row.group_id, productId: row.product_id, targetVersion: row.target_version,
      fromVersion: row.from_version, tenants: JSON.parse(row.tenants || '[]'),
      maintenanceWindow: { startAt: row.window_start, endAt: row.window_end },
      status: row.status, createdBy: row.created_by, createdAt: row.created_at,
      envelope: JSON.parse(row.envelope),
    }
  }
}
