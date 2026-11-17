import { randomUUID } from 'node:crypto'
import { fail, identifier, integer, text } from './store.mjs'

const STATUS = new Set(['DRAFT', 'ACTIVE', 'RETIRED'])
const now = () => new Date().toISOString()
const optionalText = (value, label, maximum = 500) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > maximum || /[\r\n]/.test(value)) fail(label + '格式不正确')
  return value.trim()
}

export class IdentityPackageService {
  constructor(store, { billing } = {}) {
    this.store = store
    this.db = store.db
    this.billing = billing
  }

  instance(instanceId) {
    const row = this.db.prepare('SELECT i.id,i.project_id,i.customer_id,i.name FROM instances i WHERE i.id=?').get(text(instanceId, '实例编号', 36))
    if (!row) fail('实例不存在', 404)
    return row
  }

  packages() {
    return this.db.prepare('SELECT * FROM identity_package_products ORDER BY sort,created_at').all()
  }

  savePackage(body = {}, actor = 'owner') {
    const editing = Boolean(body.id)
    const id = editing ? identifier(body.id, '套餐编号') : randomUUID()
    const code = optionalText(body.code, '套餐编码', 80)
    if (!/^[A-Za-z0-9_.-]{2,80}$/.test(code)) fail('套餐编码格式不正确')
    const name = optionalText(body.name, '套餐名称', 120)
    if (!name) fail('套餐名称不能为空')
    const creditCents = integer(body.creditCents ?? 0, '充值金额（分）', 0, 100000000)
    if (creditCents > 0 && creditCents < 100) fail('充值金额至少为 1 元')
    const priceCents = creditCents > 0 && body.priceCents == null
      ? creditCents
      : integer(body.priceCents, '套餐价格（分）', 0, 100000000)
    const verificationCount = creditCents > 0 ? 0 : integer(body.verificationCount, '核验次数', 1, 10000000)
    const validityDays = creditCents > 0 ? 1 : integer(body.validityDays, '有效天数', 1, 3660)
    const scopeType = String(body.scopeType || 'GLOBAL').toUpperCase()
    if (!['GLOBAL', 'PROJECT'].includes(scopeType)) fail('套餐适用范围不正确')
    const scopeId = scopeType === 'PROJECT' ? identifier(body.scopeId, '套餐项目') : null
    if (scopeType === 'PROJECT' && !this.db.prepare('SELECT id FROM projects WHERE id=?').get(scopeId)) fail('套餐项目不存在', 404)
    const status = String(body.status || 'DRAFT').toUpperCase()
    if (!STATUS.has(status)) fail('套餐状态不正确')
    const time = now()
    const duplicate = this.db.prepare('SELECT id FROM identity_package_products WHERE code=?').get(code)
    if (duplicate && (!editing || duplicate.id !== id)) fail('套餐编码已存在，请换一个编码', 409)
    if (editing && !this.db.prepare('SELECT 1 FROM identity_package_products WHERE id=?').get(id)) fail('套餐不存在', 404)
    this.store.transaction(() => {
      if (editing) {
        this.db.prepare('UPDATE identity_package_products SET code=?,name=?,verification_count=?,price_cents=?,validity_days=?,credit_cents=?,scope_type=?,scope_id=?,status=?,sort=?,description=?,updated_at=? WHERE id=?')
          .run(code, name, verificationCount, priceCents, validityDays, creditCents, scopeType, scopeId, status, Number(body.sort) || 0, optionalText(body.description, '套餐说明'), time, id)
      } else {
        this.db.prepare('INSERT INTO identity_package_products(id,code,name,verification_count,price_cents,validity_days,credit_cents,scope_type,scope_id,status,sort,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, code, name, verificationCount, priceCents, validityDays, creditCents, scopeType, scopeId, status, Number(body.sort) || 0, optionalText(body.description, '套餐说明'), time, time)
      }
      this.store.audit(actor, editing ? 'UPDATE_IDENTITY_PACKAGE' : 'CREATE_IDENTITY_PACKAGE', code, { status, verificationCount, priceCents, creditCents, scopeType })
    })
    return this.db.prepare('SELECT * FROM identity_package_products WHERE code=?').get(code)
  }

  deletePackage(packageId, actor = 'owner') {
    const id = identifier(packageId, '套餐编号')
    if (!this.db.prepare('SELECT 1 FROM identity_package_products WHERE id=?').get(id)) fail('套餐不存在', 404)
    const used = this.db.prepare('SELECT 1 FROM identity_package_orders WHERE package_product_id=? UNION ALL SELECT 1 FROM identity_package_balances WHERE package_product_id=? LIMIT 1').get(id, id)
    if (used) fail('套餐已有购买或发放记录，不能删除；请将状态改为停用', 409)
    this.store.transaction(() => {
      this.db.prepare('DELETE FROM identity_package_products WHERE id=?').run(id)
      this.store.audit(actor, 'DELETE_IDENTITY_PACKAGE', id, {})
    })
    return { id, deleted: true }
  }

  availablePackages(instanceId) {
    const instance = this.instance(instanceId)
    return this.db.prepare("SELECT * FROM identity_package_products WHERE status='ACTIVE' AND (scope_type='GLOBAL' OR scope_id=?) ORDER BY sort,created_at").all(instance.project_id)
  }

  activePackages(instanceId, units = 1) {
    return this.db.prepare("SELECT b.* FROM identity_package_balances b JOIN identity_package_products p ON p.id=b.package_product_id WHERE b.instance_id=? AND b.status='ACTIVE' AND p.status='ACTIVE' AND b.valid_from<=? AND b.valid_until>? AND b.remaining_count-b.reserved_count>=? ORDER BY b.valid_until,b.created_at LIMIT 10")
      .all(text(instanceId, '实例编号', 36), now(), now(), Math.max(1, Number(units) || 1))
  }

  grantPackage(instanceId, packageId, actor = 'owner', sourceOrderId = null) {
    const instance = this.instance(instanceId)
    const product = this.db.prepare("SELECT * FROM identity_package_products WHERE id=? AND status='ACTIVE'").get(identifier(packageId, '套餐编号'))
    if (!product) fail('套餐不存在或未启用', 404)
    if (Number(product.credit_cents) > 0) fail('余额充值套餐请由客户购买后自动入账', 409)
    if (product.scope_type === 'PROJECT' && product.scope_id !== instance.project_id) fail('套餐不适用于该项目', 409)
    if (sourceOrderId) {
      const existing = this.db.prepare('SELECT * FROM identity_package_balances WHERE source_order_id=?').get(sourceOrderId)
      if (existing) return { id: existing.id, remainingCount: existing.remaining_count, validUntil: existing.valid_until, idempotent: true }
    }
    const start = new Date()
    const end = new Date(start.getTime() + product.validity_days * 86400000)
    const id = randomUUID()
    this.store.transaction(() => {
      this.db.prepare('INSERT INTO identity_package_balances(id,instance_id,package_product_id,total_count,remaining_count,reserved_count,valid_from,valid_until,status,source_type,source_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, instance.id, product.id, product.verification_count, product.verification_count, 0, start.toISOString(), end.toISOString(), 'ACTIVE', sourceOrderId ? 'PURCHASE' : 'MANUAL', sourceOrderId, start.toISOString(), start.toISOString())
      this.store.audit(actor, 'IDENTITY_PACKAGE_GRANT', instance.id, { packageId: product.id, verificationCount: product.verification_count, sourceOrderId })
    })
    return { id, remainingCount: product.verification_count, validUntil: end.toISOString() }
  }

  createPackageOrder(instanceId, packageId) {
    const instance = this.instance(instanceId)
    const product = this.db.prepare("SELECT * FROM identity_package_products WHERE id=? AND status='ACTIVE'").get(identifier(packageId, '套餐编号'))
    if (!product) fail('套餐不存在或未启用', 404)
    if (product.scope_type === 'PROJECT' && product.scope_id !== instance.project_id) fail('套餐不适用于该项目', 409)
    if (!Number.isSafeInteger(product.price_cents) || product.price_cents < 1) fail('套餐价格尚未配置', 409)
    const existing = this.db.prepare("SELECT * FROM identity_package_orders WHERE instance_id=? AND package_product_id=? AND status='UNPAID' ORDER BY created_at DESC LIMIT 1").get(instance.id, product.id)
    if (existing) return { ...existing, product }
    const id = randomUUID()
    this.db.prepare('INSERT INTO identity_package_orders(id,instance_id,package_product_id,package_name,verification_count,validity_days,amount_cents,credit_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, instance.id, product.id, product.name, product.verification_count, product.validity_days, product.price_cents, product.credit_cents || 0, 'UNPAID', now())
    this.store.audit('client', 'IDENTITY_PACKAGE_ORDER', id, { instanceId: instance.id, packageId: product.id, amountCents: product.price_cents })
    return { ...this.db.prepare('SELECT * FROM identity_package_orders WHERE id=?').get(id), product }
  }

  packageOrder(orderId) {
    return this.db.prepare('SELECT o.*,p.code,i.name AS instance_name,i.customer_id,c.name AS customer_name,pr.name AS project_name FROM identity_package_orders o LEFT JOIN identity_package_products p ON p.id=o.package_product_id JOIN instances i ON i.id=o.instance_id JOIN customers c ON c.id=i.customer_id JOIN projects pr ON pr.id=i.project_id WHERE o.id=?').get(orderId)
  }

  markPackagePaid(orderId, { transactionId, amountCents, reference } = {}) {
    return this.store.transaction(() => {
      const order = this.packageOrder(orderId)
      if (!order) fail('实名套餐订单不存在', 404)
      if (order.status === 'GRANTED' || (order.status === 'PAID' && order.granted_at)) return { order, idempotent: true }
      if (order.status === 'CANCELLED') fail('实名套餐订单已取消', 409)
      if (Number(amountCents) !== Number(order.amount_cents)) fail('实名套餐支付金额不匹配', 409)
      const time = now()
      this.db.prepare("UPDATE identity_package_orders SET status='PAID',payment_reference=?,paid_at=? WHERE id=?").run(String(reference || transactionId || '').slice(0, 128), time, orderId)
      if (Number(order.credit_cents) > 0) {
        const creditReference = 'IDENTITY-BALANCE-' + orderId
        const credited = this.db.prepare("SELECT id FROM service_ledger WHERE instance_id=? AND type='CREDIT' AND reference=?").get(order.instance_id, creditReference)
        this.db.prepare('INSERT OR IGNORE INTO service_accounts(instance_id,updated_at) VALUES (?,?)').run(order.instance_id, time)
        let balance
        if (!credited) {
          const account = this.db.prepare('SELECT * FROM service_accounts WHERE instance_id=?').get(order.instance_id)
          balance = Number(account.balance_cents || 0) + Number(order.credit_cents)
          this.db.prepare('UPDATE service_accounts SET balance_cents=?,updated_at=? WHERE instance_id=?').run(balance, time, order.instance_id)
          this.db.prepare('INSERT INTO service_ledger VALUES (?,?,?,?,?,?,?)')
            .run(randomUUID(), order.instance_id, 'CREDIT', order.credit_cents, balance, creditReference, time)
        } else {
          balance = Number(this.db.prepare('SELECT balance_cents FROM service_accounts WHERE instance_id=?').get(order.instance_id)?.balance_cents || 0)
        }
        this.db.prepare("UPDATE identity_package_orders SET status='GRANTED',granted_at=? WHERE id=?").run(time, orderId)
        this.store.audit('system', 'IDENTITY_BALANCE_PAID', orderId, { transactionId: String(transactionId || '').slice(0, 80), creditCents: order.credit_cents, balanceCents: balance, idempotent: Boolean(credited) })
        return { order: this.packageOrder(orderId), grant: { creditCents: order.credit_cents, balanceCents: balance, idempotent: Boolean(credited) } }
      }
      const existing = this.db.prepare('SELECT * FROM identity_package_balances WHERE source_order_id=?').get(orderId)
      let grant
      if (existing) {
        grant = { id: existing.id, remainingCount: existing.remaining_count, validUntil: existing.valid_until, idempotent: true }
      } else {
        const start = new Date()
        const end = new Date(start.getTime() + Number(order.validity_days) * 86400000)
        const balanceId = randomUUID()
        this.db.prepare('INSERT INTO identity_package_balances(id,instance_id,package_product_id,total_count,remaining_count,reserved_count,valid_from,valid_until,status,source_type,source_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(balanceId, order.instance_id, order.package_product_id, order.verification_count, order.verification_count, 0, start.toISOString(), end.toISOString(), 'ACTIVE', 'PURCHASE', orderId, start.toISOString(), start.toISOString())
        grant = { id: balanceId, remainingCount: order.verification_count, validUntil: end.toISOString() }
      }
      this.db.prepare("UPDATE identity_package_orders SET status='GRANTED',granted_at=? WHERE id=?").run(time, orderId)
      this.store.audit('system', 'IDENTITY_PACKAGE_PAID', orderId, { transactionId: String(transactionId || '').slice(0, 80), amountCents })
      return { order: this.packageOrder(orderId), grant }
    })
  }
}
