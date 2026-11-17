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
    const id = body.id ? identifier(body.id, '套餐编号') : randomUUID()
    const code = optionalText(body.code, '套餐编码', 80)
    if (!/^[A-Za-z0-9_.-]{2,80}$/.test(code)) fail('套餐编码格式不正确')
    const name = optionalText(body.name, '套餐名称', 120)
    if (!name) fail('套餐名称不能为空')
    const verificationCount = integer(body.verificationCount, '核验次数', 1, 10000000)
    const priceCents = integer(body.priceCents, '套餐价格（分）', 0, 100000000)
    const validityDays = integer(body.validityDays, '有效天数', 1, 3660)
    const scopeType = String(body.scopeType || 'GLOBAL').toUpperCase()
    if (!['GLOBAL', 'PROJECT'].includes(scopeType)) fail('套餐适用范围不正确')
    const scopeId = scopeType === 'PROJECT' ? identifier(body.scopeId, '套餐项目') : null
    if (scopeType === 'PROJECT' && !this.db.prepare('SELECT id FROM projects WHERE id=?').get(scopeId)) fail('套餐项目不存在', 404)
    const status = String(body.status || 'DRAFT').toUpperCase()
    if (!STATUS.has(status)) fail('套餐状态不正确')
    const time = now()
    this.store.transaction(() => {
      this.db.prepare('INSERT INTO identity_package_products(id,code,name,verification_count,price_cents,validity_days,scope_type,scope_id,status,sort,description,created_at,updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,verification_count=excluded.verification_count,price_cents=excluded.price_cents,validity_days=excluded.validity_days,scope_type=excluded.scope_type,scope_id=excluded.scope_id,status=excluded.status,sort=excluded.sort,description=excluded.description,updated_at=excluded.updated_at')
        .run(id, code, name, verificationCount, priceCents, validityDays, scopeType, scopeId, status, Number(body.sort) || 0, optionalText(body.description, '套餐说明'), time, time)
      this.store.audit(actor, 'SAVE_IDENTITY_PACKAGE', code, { status, verificationCount, priceCents, scopeType })
    })
    return this.db.prepare('SELECT * FROM identity_package_products WHERE code=?').get(code)
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
    this.db.prepare('INSERT INTO identity_package_orders(id,instance_id,package_product_id,package_name,verification_count,validity_days,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, instance.id, product.id, product.name, product.verification_count, product.validity_days, product.price_cents, 'UNPAID', now())
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
