import { randomUUID } from 'node:crypto'
import { fail, identifier, text } from './store.mjs'

const stamp = () => new Date().toISOString()

export class UsageBilling {
  constructor(store) { this.store = store }

  ensure(instanceId) {
    const id = text(instanceId, '实例编号', 36)
    this.store.db.prepare('INSERT OR IGNORE INTO service_accounts(instance_id,updated_at) VALUES (?,?)').run(id, stamp())
    return this.store.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
  }

  credit(instanceId, amountCents, reference, actor) {
    const id = text(instanceId, '实例编号', 36)
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) fail('充值金额必须为正整数分')
    return this.store.transaction(() => {
      this.ensure(id)
      const account = this.store.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
      const balance = account.balance_cents + amountCents
      this.store.db.prepare('UPDATE service_accounts SET balance_cents=?,updated_at=? WHERE instance_id=?').run(balance, stamp(), id)
      this.store.db.prepare('INSERT INTO service_ledger VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, 'CREDIT', amountCents, balance, text(reference || '', '充值引用', 128), stamp())
      this.store.audit(actor, 'SERVICE_CREDIT', id, { amountCents })
      return { instanceId: id, balanceCents: balance, reservedCents: account.reserved_cents }
    })
  }

  reserve(instanceId, idempotencyKey, subjectHash, priceCents) {
    const id = text(instanceId, '实例编号', 36)
    const key = identifier(idempotencyKey, '幂等键')
    const subject = text(subjectHash, '主体摘要', 128)
    if (!Number.isSafeInteger(priceCents) || priceCents < 0) fail('核验价格无效')
    return this.store.transaction(() => {
      const existing = this.store.db.prepare('SELECT * FROM verification_requests WHERE instance_id=? AND idempotency_key=?').get(id, key)
      if (existing && existing.status === 'RESERVED') {
        const age = Date.now() - Date.parse(existing.updated_at)
        if (Number.isFinite(age) && age < 60000) return { created: false, request: existing }
        this.store.db.prepare('UPDATE verification_requests SET updated_at=? WHERE id=?').run(stamp(), existing.id)
        return { created: true, retried: true, request: this.store.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(existing.id) }
      }
      if (existing && existing.status !== 'RELEASED') return { created: false, request: existing }
      this.ensure(id)
      const account = this.store.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
      if (account.status !== 'ACTIVE') fail('服务账户已停用', 409)
      if (account.balance_cents - account.reserved_cents < priceCents) fail('实名核验服务余额不足', 409)
      const now = stamp()
      this.store.db.prepare('UPDATE service_accounts SET reserved_cents=reserved_cents+?,updated_at=? WHERE instance_id=?').run(priceCents, now, id)
      if (existing) {
        this.store.db.prepare("UPDATE verification_requests SET status='RESERVED',price_cents=?,subject_hash=?,result=NULL,updated_at=? WHERE id=?")
          .run(priceCents, subject, now, existing.id)
        return { created: true, retried: true, request: this.store.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(existing.id) }
      }
      const requestId = randomUUID()
      this.store.db.prepare('INSERT INTO verification_requests(id,instance_id,idempotency_key,subject_hash,status,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(requestId, id, key, subject, 'RESERVED', priceCents, now, now)
      return { created: true, request: this.store.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(requestId) }
    })
  }

  settle(instanceId, idempotencyKey, result, charged) {
    const id = text(instanceId, '实例编号', 36)
    const key = identifier(idempotencyKey, '幂等键')
    const outcome = text(result, '核验结果', 32)
    return this.store.transaction(() => {
      const request = this.store.db.prepare('SELECT * FROM verification_requests WHERE instance_id=? AND idempotency_key=?').get(id, key)
      if (!request) fail('核验请求不存在', 404)
      if (request.status !== 'RESERVED') return request
      const account = this.store.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(id)
      const debit = charged === true
      const balance = debit ? account.balance_cents - request.price_cents : account.balance_cents
      if (balance < 0) fail('服务账户余额异常', 409)
      this.store.db.prepare('UPDATE service_accounts SET balance_cents=?,reserved_cents=reserved_cents-?,updated_at=? WHERE instance_id=?')
        .run(balance, request.price_cents, stamp(), id)
      if (debit) this.store.db.prepare('INSERT INTO service_ledger VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), id, 'DEBIT', request.price_cents, balance, request.id, stamp())
      this.store.db.prepare('UPDATE verification_requests SET status=?,result=?,updated_at=? WHERE id=?')
        .run(debit ? 'CHARGED' : 'RELEASED', outcome, stamp(), request.id)
      return this.store.db.prepare('SELECT * FROM verification_requests WHERE id=?').get(request.id)
    })
  }

  accounts() {
    return this.store.db.prepare(`SELECT a.*,i.name AS instance_name,i.customer_id,c.name AS customer_name
      FROM service_accounts a LEFT JOIN instances i ON i.id=a.instance_id LEFT JOIN customers c ON c.id=i.customer_id
      ORDER BY c.name,i.name`).all()
  }

  requests(instanceId, limit = 200) {
    const id = text(instanceId, '实例编号', 36)
    const size = Math.max(1, Math.min(Number(limit) || 200, 500))
    return this.store.db.prepare('SELECT id,instance_id,idempotency_key,status,price_cents,result,created_at,updated_at FROM verification_requests WHERE instance_id=? ORDER BY created_at DESC LIMIT ?').all(id, size)
  }

  ledger(instanceId, limit = 200) {
    const id = text(instanceId, '实例编号', 36)
    const size = Math.max(1, Math.min(Number(limit) || 200, 500))
    return this.store.db.prepare('SELECT * FROM service_ledger WHERE instance_id=? ORDER BY created_at DESC LIMIT ?').all(id, size)
  }

  setStatus(instanceId, status, actor) {
    const id = text(instanceId, '实例编号', 36)
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) fail('服务账户状态无效')
    this.ensure(id)
    this.store.db.prepare('UPDATE service_accounts SET status=?,updated_at=? WHERE instance_id=?').run(status, stamp(), id)
    this.store.audit(actor, 'SERVICE_STATUS', id, { status })
    return this.ensure(id)
  }
}
