import { randomUUID } from 'node:crypto'
import { fail, identifier, integer, text } from './store.mjs'

const stamp = () => new Date().toISOString()
const MODES = new Set(['METERED', 'PACKAGE', 'HYBRID'])

export class UsageBilling {
  constructor(store, {
    defaultMode = process.env.IDENTITY_DEFAULT_MODE || 'HYBRID',
    defaultPriceCents = Number(process.env.IDENTITY_PRICE_CENTS || '100')
  } = {}) {
    this.store = store
    this.db = store.db
    this.defaultMode = MODES.has(defaultMode) ? defaultMode : 'HYBRID'
    this.defaultPriceCents = Number.isSafeInteger(defaultPriceCents) && defaultPriceCents >= 0 ? defaultPriceCents : 100
  }

  ensure(instanceId) {
    const id = text(instanceId, '实例编号', 36)
    if (!this.db.prepare('SELECT id FROM instances WHERE id=?').get(id)) fail('实例不存在', 404)
    this.db.prepare('INSERT OR IGNORE INTO service_accounts(instance_id,billing_mode,unit_price_cents,updated_at) VALUES (?,?,?,?)')
      .run(id, this.defaultMode, this.defaultPriceCents, stamp())
    return this.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
  }

  credit(instanceId, amountCents, reference, actor) {
    const id = text(instanceId, '实例编号', 36)
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) fail('充值金额必须为正整数分')
    return this.store.transaction(() => {
      this.ensure(id)
      const account = this.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
      const balance = account.balance_cents + amountCents
      this.db.prepare('UPDATE service_accounts SET balance_cents=?,updated_at=? WHERE instance_id=?').run(balance, stamp(), id)
      this.db.prepare('INSERT INTO service_ledger VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, 'CREDIT', amountCents, balance, text(reference || '', '充值引用', 128), stamp())
      this.store.audit(actor, 'SERVICE_CREDIT', id, { amountCents })
      return { instanceId: id, balanceCents: balance, reservedCents: account.reserved_cents }
    })
  }

  saveAccount(instanceId, body = {}, actor = 'owner') {
    const id = text(instanceId, '实例编号', 36)
    this.ensure(id)
    const mode = String(body.billingMode || this.defaultMode).toUpperCase()
    if (!MODES.has(mode)) fail('实名核验计费模式不正确')
    const price = integer(body.unitPriceCents, '单次核验价格（分）', 0, 100000)
    const status = String(body.status || 'ACTIVE').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) fail('服务账户状态无效')
    this.db.prepare('UPDATE service_accounts SET billing_mode=?,unit_price_cents=?,status=?,updated_at=? WHERE instance_id=?')
      .run(mode, price, status, stamp(), id)
    this.store.audit(actor, 'SERVICE_ACCOUNT_UPDATE', id, { mode, price, status })
    return this.accountView(id)
  }

  reserve(instanceId, idempotencyKey, subjectHash, priceCents) {
    const id = text(instanceId, '实例编号', 36)
    const key = identifier(idempotencyKey, '幂等键')
    const subject = text(subjectHash, '主体摘要', 128)
    return this.store.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM verification_requests WHERE instance_id=? AND idempotency_key=?').get(id, key)
      if (existing && existing.subject_hash !== subject) fail('幂等键已绑定其他核验主体，请使用新的请求编号', 409)
      if (existing?.status === 'RESERVED') {
        const age = Date.now() - Date.parse(existing.updated_at)
        if (Number.isFinite(age) && age < 60000) return { created: false, request: existing }
        // Do not dispatch again: the previous provider call may have completed before a crash.
        return { created: false, request: existing }
      }
      if (existing && existing.status !== 'RELEASED') return { created: false, request: existing }

      const account = this.ensure(id)
      if (account.status !== 'ACTIVE') fail('服务账户已停用', 409)
      const mode = MODES.has(account.billing_mode) ? account.billing_mode : this.defaultMode
      const unitPrice = Number.isSafeInteger(account.unit_price_cents) && account.unit_price_cents >= 0
        ? account.unit_price_cents
        : (Number.isSafeInteger(priceCents) && priceCents >= 0 ? priceCents : this.defaultPriceCents)
      let billingMode = mode
      let charge = unitPrice
      let packageRow = null
      if (mode === 'PACKAGE') {
        packageRow = this.activePackages(id)[0] || null
        if (!packageRow) fail('实名核验套餐不足，请先购买套餐', 409)
        billingMode = 'PACKAGE'
        charge = 0
      } else if (mode === 'HYBRID') {
        packageRow = this.activePackages(id)[0] || null
        billingMode = packageRow ? 'PACKAGE' : 'METERED'
        if (packageRow) charge = 0
      }
      if (billingMode === 'METERED' && charge > 0 && account.balance_cents - account.reserved_cents < charge)
        fail('实名核验服务余额不足', 409)
      const now = stamp()
      if (packageRow) {
        const changed = this.db.prepare("UPDATE identity_package_balances SET reserved_count=reserved_count+1,updated_at=? WHERE id=? AND status='ACTIVE' AND remaining_count-reserved_count>=1")
          .run(now, packageRow.id).changes
        if (!changed) fail('实名核验套餐额度已被占用，请重试', 409)
      } else if (billingMode === 'METERED' && charge > 0) {
        const changed = this.db.prepare('UPDATE service_accounts SET reserved_cents=reserved_cents+?,updated_at=? WHERE instance_id=? AND balance_cents-reserved_cents>=?')
          .run(charge, now, id, charge).changes
        if (!changed) fail('实名核验服务余额不足', 409)
      }
      if (existing) {
        this.db.prepare("UPDATE verification_requests SET status='RESERVED',billing_mode=?,package_balance_id=?,price_cents=?,subject_hash=?,result=NULL,updated_at=? WHERE id=?")
          .run(billingMode, packageRow?.id || null, charge, subject, now, existing.id)
        return { created: true, retried: true, request: this.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(existing.id) }
      }
      const requestId = randomUUID()
      this.db.prepare('INSERT INTO verification_requests(id,instance_id,idempotency_key,subject_hash,status,billing_mode,package_balance_id,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(requestId, id, key, subject, 'RESERVED', billingMode, packageRow?.id || null, charge, now, now)
      return { created: true, request: this.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(requestId) }
    })
  }

  settle(instanceId, idempotencyKey, result, charged, providerRequestId = '') {
    const id = text(instanceId, '实例编号', 36)
    const key = identifier(idempotencyKey, '幂等键')
    const outcome = text(result, '核验结果', 32)
    return this.store.transaction(() => {
      const request = this.db.prepare('SELECT * FROM verification_requests WHERE instance_id=? AND idempotency_key=?').get(id, key)
      if (!request) fail('核验请求不存在', 404)
      if (request.status !== 'RESERVED') return request
      if (charged !== true) {
        this.releaseHold(request)
        this.db.prepare("UPDATE verification_requests SET status='RELEASED',result=?,updated_at=? WHERE id=?").run(outcome, stamp(), request.id)
        return this.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(request.id)
      }
      if (request.package_balance_id) {
        const changed = this.db.prepare('UPDATE identity_package_balances SET remaining_count=remaining_count-1,reserved_count=reserved_count-1,updated_at=? WHERE id=? AND remaining_count>=1 AND reserved_count>=1')
          .run(stamp(), request.package_balance_id).changes
        if (!changed) fail('实名核验套餐预占状态异常', 409)
      } else if (request.billing_mode === 'METERED') {
        const account = this.ensure(id)
        const balance = account.balance_cents - request.price_cents
        const reserved = account.reserved_cents - request.price_cents
        if (balance < 0 || reserved < 0) fail('实名核验账户预占状态异常', 409)
        this.db.prepare('UPDATE service_accounts SET balance_cents=?,reserved_cents=?,updated_at=? WHERE instance_id=?').run(balance, reserved, stamp(), id)
        this.db.prepare('INSERT INTO service_ledger VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, 'DEBIT', request.price_cents, balance, request.id, stamp())
      }
      const reference = typeof providerRequestId === 'string' ? providerRequestId.slice(0, 128) : ''
      this.db.prepare("UPDATE verification_requests SET status='CHARGED',result=?,provider_request_id=?,updated_at=? WHERE id=?").run(outcome, reference, stamp(), request.id)
      return this.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(request.id)
    })
  }

  releaseHold(request) {
    if (request.package_balance_id) {
      this.db.prepare('UPDATE identity_package_balances SET reserved_count=MAX(0,reserved_count-1),updated_at=? WHERE id=?').run(stamp(), request.package_balance_id)
    } else if (request.billing_mode === 'METERED' && request.price_cents > 0) {
      this.db.prepare('UPDATE service_accounts SET reserved_cents=MAX(0,reserved_cents-?),updated_at=? WHERE instance_id=?').run(request.price_cents, stamp(), request.instance_id)
    }
  }

  activePackages(instanceId) {
    return this.db.prepare("SELECT b.* FROM identity_package_balances b WHERE b.instance_id=? AND b.status='ACTIVE' AND b.valid_from<=? AND b.valid_until>? AND b.remaining_count-b.reserved_count>=1 ORDER BY b.valid_until,b.created_at LIMIT 10")
      .all(text(instanceId, '实例编号', 36), stamp(), stamp())
  }

  usageStats(instanceId) {
    const id = text(instanceId, '实例编号', 36)
    return this.db.prepare("SELECT SUM(CASE WHEN status='CHARGED' THEN 1 ELSE 0 END) AS charged_count, " +
      "SUM(CASE WHEN status='CHARGED' AND result LIKE 'MATCH%' THEN 1 ELSE 0 END) AS matched_count, " +
      "SUM(CASE WHEN status='CHARGED' AND result LIKE 'MISMATCH%' THEN 1 ELSE 0 END) AS mismatch_count, " +
      "SUM(CASE WHEN status='RELEASED' THEN 1 ELSE 0 END) AS released_count " +
      "FROM verification_requests WHERE instance_id=?").get(id)
  }

  accountView(instanceId) {
    const id = text(instanceId, '实例编号', 36)
    const account = this.ensure(id)
    const row = this.db.prepare('SELECT i.id AS instance_id,i.name AS instance_name,i.project_id,i.customer_id,c.name AS customer_name,p.name AS project_name FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(id)
    if (!row) fail('实例不存在', 404)
    const packages = this.db.prepare("SELECT b.id,p.name,b.remaining_count-b.reserved_count AS remaining_count,b.valid_until FROM identity_package_balances b JOIN identity_package_products p ON p.id=b.package_product_id WHERE b.instance_id=? AND b.status='ACTIVE' AND b.valid_until>? ORDER BY b.valid_until,b.created_at").all(id, stamp())
    return { ...row, ...account, packages, usage: this.usageStats(id) }
  }

  accounts() {
    const sql = "SELECT i.id AS instance_id,i.name AS instance_name,i.project_id,i.customer_id,c.name AS customer_name,p.name AS project_name, " +
      "a.balance_cents,a.reserved_cents,a.billing_mode,a.unit_price_cents,a.status,a.updated_at, " +
      "COALESCE((SELECT SUM(b.remaining_count-b.reserved_count) FROM identity_package_balances b WHERE b.instance_id=i.id AND b.status='ACTIVE' AND b.valid_until>?),0) AS package_remaining, " +
      "COALESCE((SELECT COUNT(*) FROM verification_requests r WHERE r.instance_id=i.id AND r.status='CHARGED'),0) AS charged_count, " +
      "COALESCE((SELECT COUNT(*) FROM verification_requests r WHERE r.instance_id=i.id AND r.status='CHARGED' AND r.result LIKE 'MATCH%'),0) AS matched_count, " +
      "COALESCE((SELECT COUNT(*) FROM verification_requests r WHERE r.instance_id=i.id AND r.status='CHARGED' AND r.result LIKE 'MISMATCH%'),0) AS mismatch_count " +
      "FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id " +
      "LEFT JOIN service_accounts a ON a.instance_id=i.id ORDER BY c.name,i.name"
    return this.db.prepare(sql).all(stamp()).map(row => ({
      ...row,
      billing_mode: row.billing_mode || this.defaultMode,
      unit_price_cents: row.unit_price_cents == null ? this.defaultPriceCents : row.unit_price_cents,
      status: row.status || 'ACTIVE',
      balance_cents: Number(row.balance_cents || 0),
      reserved_cents: Number(row.reserved_cents || 0),
      package_remaining: Number(row.package_remaining || 0),
      charged_count: Number(row.charged_count || 0),
      matched_count: Number(row.matched_count || 0),
      mismatch_count: Number(row.mismatch_count || 0)
    }))
  }

  requests(instanceId, limit = 200) {
    const id = text(instanceId, '实例编号', 36)
    const size = Math.max(1, Math.min(Number(limit) || 200, 500))
    return this.db.prepare('SELECT id,instance_id,idempotency_key,status,billing_mode,package_balance_id,price_cents,result,provider_request_id,created_at,updated_at FROM verification_requests WHERE instance_id=? ORDER BY created_at DESC LIMIT ?').all(id, size)
  }

  ledger(instanceId, limit = 200) {
    const id = text(instanceId, '实例编号', 36)
    const size = Math.max(1, Math.min(Number(limit) || 200, 500))
    return this.db.prepare('SELECT * FROM service_ledger WHERE instance_id=? ORDER BY created_at DESC LIMIT ?').all(id, size)
  }

  setStatus(instanceId, status, actor) {
    const id = text(instanceId, '实例编号', 36)
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) fail('服务账户状态无效')
    this.ensure(id)
    this.db.prepare('UPDATE service_accounts SET status=?,updated_at=? WHERE instance_id=?').run(status, stamp(), id)
    this.store.audit(actor, 'SERVICE_STATUS', id, { status })
    return this.ensure(id)
  }
}
