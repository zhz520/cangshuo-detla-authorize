import {
  createCipheriv, createDecipheriv, createHash, createHmac,
  randomBytes, randomUUID, timingSafeEqual
} from 'node:crypto'
import { fail, identifier, integer, text } from './store.mjs'
import { AliyunSmsProvider, SmsProviderUncertain } from './sms-provider.mjs'
import { noticeCatalog, noticeVariables } from '../src/sms-notice-catalog.js'

const MODES = new Set(['METERED', 'PACKAGE', 'HYBRID'])
const TEMPLATE_STATUS = new Set(['DRAFT', 'ACTIVE', 'RETIRED'])
const PACKAGE_STATUS = new Set(['DRAFT', 'ACTIVE', 'RETIRED'])
const PHONE = /^1[3-9][0-9]{9}$/
const KEY = /^[A-Za-z0-9:_-]{8,128}$/
const stamp = () => new Date().toISOString()
const optionalText = (value, label, maximum = 200) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > maximum || /[\r\n]/.test(value)) fail(label + '格式不正确')
  return value.trim()
}
const sha256 = value => createHash('sha256').update(String(value)).digest('hex')
const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

export function keyBytes(value) {
  if (value == null || String(value).trim() === '') return null
  const raw = String(value).trim()
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (bytes.length !== 32) throw new Error('SMS 主密钥必须为 32 字节')
  return bytes
}

export function seal(value, key) {
  if (!key) throw new Error('SMS_MASTER_KEY_MISSING')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.')
}

export function open(value, key) {
  if (!value) return ''
  if (!key) throw new Error('SMS_MASTER_KEY_MISSING')
  const parts = String(value).split('.')
  if (parts.length !== 3) throw new Error('SMS_SECRET_INVALID')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64'))
  decipher.setAuthTag(Buffer.from(parts[1], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8')
}

function normalizeVariables(value) {
  if (!Array.isArray(value) || value.length > 30) fail('模板变量配置不正确')
  const seen = new Set()
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('模板变量配置不正确')
    const key = optionalText(item.key, '变量名', 40)
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) || seen.has(key)) fail('模板变量名不正确或重复')
    seen.add(key)
    return { key, required: item.required === true, maxLength: Math.max(1, Math.min(200, number(item.maxLength, 40))) }
  })
}

function parseVariables(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function maskPhone(phone) {
  return phone.slice(0, 3) + '****' + phone.slice(-4)
}

export class SmsService {
  constructor(store, {
    provider = null,
    masterKey = process.env.AUTHORITY_SMS_MASTER_KEY || '',
    phoneHashKey = process.env.AUTHORITY_SMS_PHONE_HASH_KEY || '',
    receiptKey = process.env.AUTHORITY_SMS_RECEIPT_KEY || '',
    defaultMode = process.env.SMS_DEFAULT_MODE || 'HYBRID',
    defaultPriceCents = Number(process.env.SMS_DEFAULT_PRICE_CENTS || '5'),
    now = stamp
  } = {}) {
    this.store = store
    this.db = store.db
    this.provider = provider || new AliyunSmsProvider()
    this.masterKey = keyBytes(masterKey)
    this.fallbackReceiptKey = keyBytes(receiptKey)
    this.phoneHashKey = phone => createHmac('sha256', String(phoneHashKey || masterKey || 'sms-phone-hash-local')).update(String(phone)).digest('hex')
    this.defaultMode = MODES.has(defaultMode) ? defaultMode : 'HYBRID'
    this.defaultPriceCents = Number.isSafeInteger(defaultPriceCents) && defaultPriceCents >= 0 ? defaultPriceCents : 5
    this.now = now
  }

  ensureAccount(projectId) {
    if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) fail('项目不存在', 404)
    this.db.prepare('INSERT OR IGNORE INTO sms_accounts(project_id,billing_mode,unit_price_cents,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(projectId, this.defaultMode, this.defaultPriceCents, this.now(), this.now())
    this.db.prepare('INSERT OR IGNORE INTO sms_wallets(project_id,updated_at) VALUES (?,?)').run(projectId, this.now())
    return this.db.prepare('SELECT * FROM sms_accounts WHERE project_id=?').get(projectId)
  }

  instanceProject(instanceId) {
    const row = this.db.prepare('SELECT i.id AS instance_id,i.project_id,i.customer_id,i.domains,i.name AS instance_name, ' +
      'p.name AS project_name,p.status AS project_status,p.maintenance_until,c.status AS customer_status,c.name AS customer_name ' +
      'FROM instances i JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=i.customer_id WHERE i.id=?').get(instanceId)
    if (!row) fail('实例不存在', 404)
    if (row.customer_status !== 'ACTIVE' || row.project_status !== 'ACTIVE') fail('实例或项目已停用', 403)
    const until = Date.parse(row.maintenance_until)
    if (!Number.isFinite(until) || until <= Date.now()) fail('项目维护期已过期', 403)
    return row
  }

  settingsRaw() {
    return this.db.prepare('SELECT * FROM sms_provider_settings WHERE id=1').get() || {
      endpoint: 'dysmsapi.aliyuncs.com', access_key_id: '', access_key_secret_cipher: '',
      default_sign_name: '', enabled: 0, timeout_ms: 8000, updated_at: ''
    }
  }

  settings() {
    const row = this.settingsRaw()
    return {
      endpoint: row.endpoint, accessKeyId: row.access_key_id, defaultSignName: row.default_sign_name,
      enabled: row.enabled === 1, timeoutMs: row.timeout_ms, hasSecret: Boolean(row.access_key_secret_cipher),
      masterKeyConfigured: Boolean(this.masterKey),
      receiptConfigured: Boolean(this.receiptKey),
      receiptSaved: Boolean(row.receipt_secret_cipher),
      httpReceiptToken: this.httpReceiptToken()
    }
  }

  httpReceiptToken() {
    const key = this.receiptKey
    if (!key) return ''
    return createHmac('sha256', key).update('aliyun-http-receipt-v1').digest('base64url')
  }

  verifyHttpReceiptToken(token) {
    const expected = this.httpReceiptToken()
    const value = String(token || '')
    if (!expected || value.length !== expected.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(value)))
      fail('短信回执认证失败', 401)
  }

  get receiptKey() {
    const cipher = this.settingsRaw().receipt_secret_cipher
    return cipher ? keyBytes(open(cipher, this.masterKey)) : this.fallbackReceiptKey
  }

  saveSettings(body = {}, actor = 'owner') {
    const current = this.settingsRaw()
    const endpoint = optionalText(body.endpoint == null ? current.endpoint : body.endpoint, 'Endpoint', 120)
    if (endpoint !== 'dysmsapi.aliyuncs.com') fail('短信服务地址只能使用 dysmsapi.aliyuncs.com')
    const accessKeyId = optionalText(body.accessKeyId == null ? current.access_key_id : body.accessKeyId, 'AccessKey ID', 128)
    const defaultSignName = optionalText(body.defaultSignName == null ? current.default_sign_name : body.defaultSignName, '短信签名', 120)
    const timeoutMs = Math.max(1000, Math.min(30000, number(body.timeoutMs, current.timeout_ms)))
    let cipher = current.access_key_secret_cipher
    let receiptCipher = current.receipt_secret_cipher || ''
    if (body.receiptKey != null && String(body.receiptKey).trim() !== '') {
      if (!this.masterKey) fail('系统加密密钥未就绪', 503)
      const candidate = optionalText(body.receiptKey, '回执签名密钥', 128)
      let key
      try { key = keyBytes(candidate) } catch { fail('回执签名密钥须为 32 字节的 Base64 或 64 位十六进制') }
      receiptCipher = seal(key.toString('base64'), this.masterKey)
    }
    if (body.accessKeySecret != null && String(body.accessKeySecret).trim() !== '') {
      if (!this.masterKey) fail('未配置 AUTHORITY_SMS_MASTER_KEY，不能保存阿里云 Secret', 503)
      cipher = seal(optionalText(body.accessKeySecret, 'AccessKey Secret', 500), this.masterKey)
    }
    const enabled = body.enabled === true
    if (enabled && (!accessKeyId || !cipher || !defaultSignName)) fail('启用短信服务前请填写 AccessKey ID、Secret 和短信签名')
    if (enabled && !receiptCipher && !this.fallbackReceiptKey) fail('启用短信服务前请填写回执签名密钥')
    this.store.transaction(() => {
      this.db.prepare('UPDATE sms_provider_settings SET endpoint=?,access_key_id=?,access_key_secret_cipher=?,default_sign_name=?,enabled=?,timeout_ms=?,receipt_secret_cipher=?,updated_at=? WHERE id=1')
        .run(endpoint, accessKeyId, cipher, defaultSignName, enabled ? 1 : 0, timeoutMs, receiptCipher, this.now())
      this.store.audit(actor, 'UPDATE_SMS_SETTINGS', 'aliyun', { enabled, hasSecret: Boolean(cipher), hasReceipt: Boolean(receiptCipher || this.fallbackReceiptKey), endpoint })
    })
    return this.settings()
  }

  templates() {
    return this.db.prepare('SELECT * FROM sms_templates ORDER BY template_key').all().map(row => ({
      ...row, variables: parseVariables(row.variables_schema), billable: row.billable === 1
    }))
  }

  defaultVerificationTemplates(actor = 'owner') {
    const defaults = [
      ['otp_login', '登录验证码', 'LOGIN'],
      ['otp_reset', '找回密码验证码', 'RESET'],
      ['otp_bind_old', '修改手机号-原手机验证', 'BIND_OLD'],
      ['otp_bind_new', '修改手机号-新手机验证', 'BIND_NEW'],
      ['otp_wechat_bind', '微信绑定验证码', 'WECHAT_BIND']
    ]
    const created = []
    const source = this.db.prepare(
      "SELECT * FROM sms_templates WHERE provider_template_code<>'' AND scene IN ('LOGIN','RESET','BIND_OLD','BIND_NEW','WECHAT_BIND') ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1"
    ).get()
    const status = source?.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT'
    const variablesSchema = source?.variables_schema || JSON.stringify([{ key: 'code', required: true, maxLength: 40 }])
    this.store.transaction(() => {
      for (const [key, name, scene] of defaults) {
        if (this.db.prepare('SELECT 1 FROM sms_templates WHERE template_key=?').get(key)) continue
        this.db.prepare('INSERT INTO sms_templates(id,template_key,name,scene,sign_name,provider_template_code,variables_schema,billing_units,billable,status,min_client_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), key, name, scene, source?.sign_name || '', source?.provider_template_code || '',
            variablesSchema, source?.billing_units || 1, source?.billable == null ? 1 : source.billable,
            source?.provider_template_code ? status : 'DRAFT', '1.16.5', this.now(), this.now())
        created.push(key)
      }
      if (created.length) this.store.audit(actor, 'SEED_SMS_VERIFICATION_TEMPLATES', 'verification', {
        created, sourceTemplateKey: source?.template_key || null
      })
    })
    return { created, sourceTemplateKey: source?.template_key || null, templates: this.templates() }
  }

  saveTemplate(body = {}, actor = 'owner') {
    const key = optionalText(body.templateKey || body.id, '模板键', 80).toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(key)) fail('模板键只能使用小写字母、数字、点、下划线或短横线')
    const name = optionalText(body.name, '模板名称', 120)
    if (!name) fail('模板名称不能为空')
    const notice = noticeCatalog.find(item => item.key === key)
    if (key.startsWith('notice_') && !notice) fail('请选择支持的业务短信角色与场景')
    const scene = notice ? notice.group.toUpperCase() : optionalText(body.scene, '模板场景', 80) || 'GENERAL'
    const signName = optionalText(body.signName, '模板签名', 120)
    const providerTemplateCode = optionalText(body.providerTemplateCode, '阿里云模板 Code', 120)
    const variables = normalizeVariables(body.variables || [])
    if (notice && variables.some(item => !noticeVariables.includes(item.key))) fail('业务模板变量不在该系统可提供的字段中；请使用支持的阿里云变量名')
    if (notice && providerTemplateCode && !/^SMS_[0-9]+$/.test(providerTemplateCode)) fail('请填写阿里云已审核的模板 Code（SMS_加数字）')
    const billingUnits = Math.max(1, Math.min(10, number(body.billingUnits, 1)))
    const billable = body.billable !== false
    const status = String(body.status || 'DRAFT').toUpperCase()
    if (!TEMPLATE_STATUS.has(status)) fail('模板状态不正确')
    if (status === 'ACTIVE' && !providerTemplateCode) fail('启用模板前请填写阿里云模板 Code')
    const minVersion = optionalText(body.minClientVersion, '最低客户端版本', 40) || '1.16.5'
    const existing = this.db.prepare('SELECT id FROM sms_templates WHERE template_key=?').get(key)
    const id = existing?.id || randomUUID()
    const time = this.now()
    this.store.transaction(() => {
      this.db.prepare('INSERT INTO sms_templates(id,template_key,name,scene,sign_name,provider_template_code,variables_schema,billing_units,billable,status,min_client_version,created_at,updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(template_key) DO UPDATE SET name=excluded.name,scene=excluded.scene,sign_name=excluded.sign_name,provider_template_code=excluded.provider_template_code,variables_schema=excluded.variables_schema,billing_units=excluded.billing_units,billable=excluded.billable,status=excluded.status,min_client_version=excluded.min_client_version,updated_at=excluded.updated_at')
        .run(id, key, name, scene, signName, providerTemplateCode, JSON.stringify(variables), billingUnits, billable ? 1 : 0, status, minVersion, time, time)
      this.store.audit(actor, existing ? 'UPDATE_SMS_TEMPLATE' : 'CREATE_SMS_TEMPLATE', key, { status, billable, billingUnits })
    })
    return { templateKey: key, id }
  }

  deleteTemplate(templateKey, actor = 'owner') {
    const key = optionalText(templateKey, '模板键', 80).toLowerCase()
    const existing = this.db.prepare('SELECT id FROM sms_templates WHERE template_key=?').get(key)
    if (!existing) fail('模板不存在', 404)
    const used = this.db.prepare('SELECT 1 FROM sms_requests WHERE template_id=? LIMIT 1').get(existing.id)
    if (used) fail('模板已有发送记录，不能删除；请将状态改为停用', 409)
    this.store.transaction(() => {
      this.db.prepare('DELETE FROM sms_templates WHERE id=?').run(existing.id)
      this.store.audit(actor, 'DELETE_SMS_TEMPLATE', key, {})
    })
    return { templateKey: key, deleted: true }
  }

  packages() {
    return this.db.prepare('SELECT * FROM sms_package_products ORDER BY sort,created_at').all()
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
    const messageCount = creditCents > 0 ? 0 : integer(body.messageCount, '套餐条数', 1, 10000000)
    const validityDays = creditCents > 0 ? 1 : integer(body.validityDays, '有效天数', 1, 3660)
    const scopeType = String(body.scopeType || 'GLOBAL').toUpperCase()
    if (!['GLOBAL', 'PROJECT'].includes(scopeType)) fail('套餐适用范围不正确')
    const scopeId = scopeType === 'PROJECT' ? identifier(body.scopeId, '套餐项目') : null
    if (scopeType === 'PROJECT' && !this.db.prepare('SELECT id FROM projects WHERE id=?').get(scopeId)) fail('套餐项目不存在', 404)
    const status = String(body.status || 'DRAFT').toUpperCase()
    if (!PACKAGE_STATUS.has(status)) fail('套餐状态不正确')
    const time = this.now()
    this.store.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM sms_package_products WHERE code=?').get(code)
      if (duplicate && (!editing || duplicate.id !== id)) fail('套餐编码已存在，请换一个编码', 409)
      if (editing) {
        if (!this.db.prepare('SELECT 1 FROM sms_package_products WHERE id=?').get(id)) fail('套餐不存在', 404)
        this.db.prepare('UPDATE sms_package_products SET code=?,name=?,message_count=?,price_cents=?,validity_days=?,credit_cents=?,scope_type=?,scope_id=?,status=?,sort=?,description=?,updated_at=? WHERE id=?')
          .run(code, name, messageCount, priceCents, validityDays, creditCents, scopeType, scopeId, status, number(body.sort, 0), optionalText(body.description, '套餐说明', 500), time, id)
      } else {
        this.db.prepare('INSERT INTO sms_package_products(id,code,name,message_count,price_cents,validity_days,credit_cents,scope_type,scope_id,status,sort,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, code, name, messageCount, priceCents, validityDays, creditCents, scopeType, scopeId, status, number(body.sort, 0), optionalText(body.description, '套餐说明', 500), time, time)
      }
      this.store.audit(actor, editing ? 'UPDATE_SMS_PACKAGE' : 'CREATE_SMS_PACKAGE', code, { status, messageCount, priceCents, creditCents, scopeType })
    })
    return { id, code }
  }

  deletePackage(packageId, actor = 'owner') {
    const id = identifier(packageId, '套餐编号')
    if (!this.db.prepare('SELECT 1 FROM sms_package_products WHERE id=?').get(id)) fail('套餐不存在', 404)
    const used = this.db.prepare('SELECT 1 FROM sms_package_orders WHERE package_product_id=? UNION ALL SELECT 1 FROM sms_package_balances WHERE package_product_id=? LIMIT 1').get(id, id)
    if (used) fail('套餐已有购买或发放记录，不能删除；请将状态改为停用', 409)
    this.store.transaction(() => {
      this.db.prepare('DELETE FROM sms_package_products WHERE id=?').run(id)
      this.store.audit(actor, 'DELETE_SMS_PACKAGE', id, {})
    })
    return { id, deleted: true }
  }

  accountRows() {
    const now = this.now()
    return this.db.prepare('SELECT p.id AS project_id,p.name AS project_name,p.customer_id,c.name AS customer_name,a.billing_mode,a.unit_price_cents,a.daily_limit,a.monthly_limit,a.low_balance_cents,a.enabled, ' +
      'COALESCE(w.balance_cents,0) AS balance_cents,COALESCE(w.reserved_cents,0) AS reserved_cents,COALESCE((SELECT SUM(remaining_count-reserved_count) FROM sms_package_balances b WHERE b.project_id=p.id AND b.status=\'ACTIVE\' AND b.valid_until>?),0) AS package_remaining ' +
      'FROM projects p JOIN customers c ON c.id=p.customer_id LEFT JOIN sms_accounts a ON a.project_id=p.id LEFT JOIN sms_wallets w ON w.project_id=p.id ORDER BY c.name,p.name').all(now).map(row => ({
        ...row, billing_mode: row.billing_mode || this.defaultMode, unit_price_cents: row.unit_price_cents == null ? this.defaultPriceCents : row.unit_price_cents,
        enabled: row.enabled == null ? 1 : row.enabled, package_remaining: Number(row.package_remaining || 0)
      }))
  }

  saveAccount(projectId, body = {}, actor = 'owner') {
    const id = identifier(projectId, '项目编号')
    const mode = String(body.billingMode || '').toUpperCase()
    if (!MODES.has(mode)) fail('计费模式不正确')
    const price = integer(body.unitPriceCents, '单条价格（分）', 0, 100000)
    const daily = integer(body.dailyLimit, '每日上限', 0, 10000000)
    const monthly = integer(body.monthlyLimit, '每月上限', 0, 100000000)
    const low = integer(body.lowBalanceCents, '低余额提醒（分）', 0, 100000000)
    this.ensureAccount(id)
    this.store.transaction(() => {
      this.db.prepare('UPDATE sms_accounts SET billing_mode=?,unit_price_cents=?,daily_limit=?,monthly_limit=?,low_balance_cents=?,enabled=?,updated_at=? WHERE project_id=?')
        .run(mode, price, daily, monthly, low, body.enabled === false ? 0 : 1, this.now(), id)
      this.store.audit(actor, 'UPDATE_SMS_ACCOUNT', id, { mode, price, daily, monthly, low, enabled: body.enabled !== false })
    })
    return this.accountDetail(id)
  }

  accountDetail(projectId) {
    const account = this.ensureAccount(projectId)
    const project = this.db.prepare('SELECT p.id AS project_id,p.name AS project_name,p.customer_id,c.name AS customer_name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').get(projectId)
    const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(projectId)
    const packages = this.db.prepare('SELECT b.*,p.code,p.name AS package_name FROM sms_package_balances b JOIN sms_package_products p ON p.id=b.package_product_id WHERE b.project_id=? ORDER BY b.valid_until,b.created_at').all(projectId)
    return { ...project, ...account, balance_cents: wallet?.balance_cents || 0, reserved_cents: wallet?.reserved_cents || 0, packages }
  }

  credit(projectId, amountCents, reference, actor = 'owner') {
    const id = identifier(projectId, '项目编号')
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) fail('充值金额必须为正整数分')
    this.ensureAccount(id)
    return this.store.transaction(() => {
      const note = optionalText(reference, '充值引用', 128)
      if (note && this.db.prepare("SELECT id FROM sms_ledger WHERE project_id=? AND type='CREDIT' AND note=?").get(id, note))
        fail('该充值引用已经入账，请勿重复提交', 409)
      const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(id)
      const balance = wallet.balance_cents + amountCents
      this.db.prepare('UPDATE sms_wallets SET balance_cents=?,updated_at=? WHERE project_id=?').run(balance, this.now(), id)
      this.db.prepare('INSERT INTO sms_ledger(id,project_id,type,amount_cents,balance_after_cents,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(randomUUID(), id, 'CREDIT', amountCents, balance, actor, note, this.now())
      this.store.audit(actor, 'SMS_CREDIT', id, { amountCents })
      this.notifyLowBalance(id, balance, this.ensureAccount(id))
      return { projectId: id, balanceCents: balance }
    })
  }

  grantPackage(projectId, packageId, actor = 'owner', sourceOrderId = null) {
    const pid = identifier(projectId, '项目编号')
    const product = this.db.prepare("SELECT * FROM sms_package_products WHERE id=? AND status='ACTIVE'").get(identifier(packageId, '套餐编号'))
    if (!product) fail('套餐不存在或未启用', 404)
    if (Number(product.credit_cents) > 0) fail('余额充值套餐请由客户购买后自动入账', 409)
    if (product.scope_type === 'PROJECT' && product.scope_id !== pid) fail('套餐不适用于该项目', 409)
    this.ensureAccount(pid)
    const start = new Date()
    const end = new Date(start.getTime() + product.validity_days * 86400000)
    return this.store.transaction(() => {
      if (sourceOrderId) {
        const existing = this.db.prepare('SELECT * FROM sms_package_balances WHERE source_order_id=?').get(sourceOrderId)
        if (existing) return { id: existing.id, remainingCount: existing.remaining_count, validUntil: existing.valid_until, idempotent: true }
      }
      const id = randomUUID()
      this.db.prepare('INSERT INTO sms_package_balances(id,project_id,package_product_id,total_count,remaining_count,reserved_count,valid_from,valid_until,status,source_type,source_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, pid, product.id, product.message_count, product.message_count, 0, start.toISOString(), end.toISOString(), 'ACTIVE', sourceOrderId ? 'PURCHASE' : 'MANUAL', sourceOrderId, start.toISOString(), start.toISOString())
      const wallet = this.db.prepare('SELECT balance_cents FROM sms_wallets WHERE project_id=?').get(pid)
      this.db.prepare('INSERT INTO sms_ledger(id,project_id,type,amount_cents,balance_after_cents,package_balance_id,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), pid, 'PACKAGE_GRANT', 0, Number(wallet?.balance_cents || 0), id, actor, String(sourceOrderId || product.code).slice(0, 128), this.now())
      this.store.audit(actor, 'SMS_PACKAGE_GRANT', pid, { packageId: product.id, messageCount: product.message_count, sourceOrderId })
      return { id, remainingCount: product.message_count, validUntil: end.toISOString() }
    })
  }

  availablePackages(instanceId) {
    const instance = this.instanceProject(text(instanceId, '实例编号', 36))
    return this.db.prepare("SELECT * FROM sms_package_products WHERE status='ACTIVE' AND (scope_type='GLOBAL' OR scope_id=?) ORDER BY sort,id").all(instance.project_id)
  }

  createPackageOrder(instanceId, packageId, actor = 'client') {
    const instance = this.instanceProject(text(instanceId, '实例编号', 36))
    const product = this.db.prepare("SELECT * FROM sms_package_products WHERE id=? AND status='ACTIVE'").get(identifier(packageId, '套餐编号'))
    if (!product) fail('套餐不存在或未启用', 404)
    if (product.scope_type === 'PROJECT' && product.scope_id !== instance.project_id) fail('套餐不适用于该项目', 409)
    if (!Number.isSafeInteger(product.price_cents) || product.price_cents < 1) fail('套餐价格尚未配置', 409)
    const existing = this.db.prepare("SELECT * FROM sms_package_orders WHERE project_id=? AND package_product_id=? AND status='UNPAID' ORDER BY created_at DESC LIMIT 1").get(instance.project_id, product.id)
    if (existing) return { ...existing, product }
    const id = randomUUID()
    this.db.prepare('INSERT INTO sms_package_orders(id,project_id,package_product_id,package_name,message_count,validity_days,amount_cents,credit_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, instance.project_id, product.id, product.name, product.message_count, product.validity_days, product.price_cents, product.credit_cents || 0, 'UNPAID', this.now())
    this.store.audit(actor, 'SMS_PACKAGE_ORDER', id, { projectId: instance.project_id, packageId: product.id, amountCents: product.price_cents })
    return { ...this.db.prepare('SELECT * FROM sms_package_orders WHERE id=?').get(id), product }
  }

  packageOrder(orderId) {
    return this.db.prepare('SELECT o.*,p.code,c.name AS customer_name,pr.name AS project_name FROM sms_package_orders o LEFT JOIN sms_package_products p ON p.id=o.package_product_id JOIN projects pr ON pr.id=o.project_id JOIN customers c ON c.id=pr.customer_id WHERE o.id=?').get(orderId)
  }

  markPackagePaid(orderId, { transactionId, amountCents, reference } = {}) {
    return this.store.transaction(() => {
      const order = this.packageOrder(orderId)
      if (!order) fail('套餐订单不存在', 404)
      if (order.status === 'GRANTED' || (order.status === 'PAID' && order.granted_at)) return { order, idempotent: true }
      if (order.status === 'CANCELLED') fail('套餐订单已取消', 409)
      if (Number(amountCents) !== Number(order.amount_cents)) fail('套餐支付金额不匹配', 409)
      const time = this.now()
      this.db.prepare("UPDATE sms_package_orders SET status='PAID',payment_reference=?,paid_at=? WHERE id=?").run(String(reference || transactionId || '').slice(0, 128), time, orderId)
      if (Number(order.credit_cents) > 0) {
        const creditReference = 'SMS-BALANCE-' + orderId
        const credited = this.db.prepare("SELECT id FROM sms_ledger WHERE project_id=? AND type='CREDIT' AND note=?").get(order.project_id, creditReference)
        this.db.prepare('INSERT OR IGNORE INTO sms_wallets(project_id,updated_at) VALUES (?,?)').run(order.project_id, time)
        let balance
        if (!credited) {
          const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(order.project_id)
          balance = Number(wallet.balance_cents || 0) + Number(order.credit_cents)
          this.db.prepare('UPDATE sms_wallets SET balance_cents=?,updated_at=? WHERE project_id=?').run(balance, time, order.project_id)
          this.db.prepare('INSERT INTO sms_ledger(id,project_id,type,amount_cents,balance_after_cents,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(randomUUID(), order.project_id, 'CREDIT', order.credit_cents, balance, 'system', creditReference, time)
        } else {
          balance = Number(this.db.prepare('SELECT balance_cents FROM sms_wallets WHERE project_id=?').get(order.project_id)?.balance_cents || 0)
        }
        this.db.prepare("UPDATE sms_package_orders SET status='GRANTED',granted_at=? WHERE id=?").run(time, orderId)
        this.store.audit('system', 'SMS_BALANCE_PAID', orderId, { transactionId: String(transactionId || '').slice(0, 80), creditCents: order.credit_cents, balanceCents: balance, idempotent: Boolean(credited) })
        return { order: this.packageOrder(orderId), grant: { creditCents: order.credit_cents, balanceCents: balance, idempotent: Boolean(credited) } }
      }
      const existing = this.db.prepare('SELECT * FROM sms_package_balances WHERE source_order_id=?').get(orderId)
      let grant
      if (existing) {
        grant = { id: existing.id, remainingCount: existing.remaining_count, validUntil: existing.valid_until, idempotent: true }
      } else {
        const start = new Date()
        const end = new Date(start.getTime() + Number(order.validity_days) * 86400000)
        const balanceId = randomUUID()
        this.db.prepare('INSERT INTO sms_package_balances(id,project_id,package_product_id,total_count,remaining_count,reserved_count,valid_from,valid_until,status,source_type,source_order_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(balanceId, order.project_id, order.package_product_id, order.message_count, order.message_count, 0, start.toISOString(), end.toISOString(), 'ACTIVE', 'PURCHASE', orderId, start.toISOString(), start.toISOString())
        const wallet = this.db.prepare('SELECT balance_cents FROM sms_wallets WHERE project_id=?').get(order.project_id)
        this.db.prepare('INSERT INTO sms_ledger(id,project_id,type,amount_cents,balance_after_cents,package_balance_id,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), order.project_id, 'PACKAGE_GRANT', 0, Number(wallet?.balance_cents || 0), balanceId, 'system', orderId, time)
        grant = { id: balanceId, remainingCount: order.message_count, validUntil: end.toISOString() }
      }
      this.db.prepare("UPDATE sms_package_orders SET status='GRANTED',granted_at=? WHERE id=?").run(time, orderId)
      this.store.audit('system', 'SMS_PACKAGE_PAID', orderId, { transactionId: String(transactionId || '').slice(0, 80), amountCents })
      return { order: this.packageOrder(orderId), grant }
    })
  }

  activePackages(projectId, units) {
    return this.db.prepare("SELECT b.* FROM sms_package_balances b WHERE b.project_id=? AND b.status='ACTIVE' AND b.valid_from<=? AND b.valid_until>? AND b.remaining_count-b.reserved_count>=? ORDER BY b.valid_until,b.created_at LIMIT 10")
      .all(projectId, this.now(), this.now(), units)
  }

  templateForSend(templateKey) {
    const key = optionalText(templateKey, '模板键', 80).toLowerCase()
    const row = this.db.prepare('SELECT * FROM sms_templates WHERE template_key=?').get(key)
    if (!row || row.status !== 'ACTIVE') fail('短信模板未配置或未启用', 409, 'SMS_TEMPLATE_NOT_CONFIGURED')
    return { ...row, variables: parseVariables(row.variables_schema) }
  }

  validateVariables(template, variables) {
    const source = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}
    const result = {}
    for (const rule of template.variables) {
      const value = source[rule.key]
      if (rule.required && (value == null || String(value).trim() === '')) fail('短信模板缺少变量：' + rule.key, 400, 'SMS_TEMPLATE_INVALID')
      if (value != null && String(value).length > rule.maxLength) fail('短信模板变量过长：' + rule.key, 400, 'SMS_TEMPLATE_INVALID')
      if (value != null) result[rule.key] = String(value)
    }
    return result
  }

  notifyProject(projectId, event, key, subject, body) {
    try {
      this.store.management.queueProjectMail(projectId, event, key, subject, body)
    } catch { /* Mail settings are best-effort; billing must not fail because of an alert. */ }
  }

  notifyLowBalance(projectId, balance, account) {
    const threshold = Number(account?.low_balance_cents || 0)
    if (!threshold || balance > threshold) return
    const day = new Date().toISOString().slice(0, 10)
    this.notifyProject(projectId, 'SMS_LOW_BALANCE', 'sms-low:' + projectId + ':' + day,
      '短信余额不足', '项目短信余额为 ¥' + (balance / 100).toFixed(2) + '，低于提醒阈值 ¥' + (threshold / 100).toFixed(2) + '。请及时充值。')
  }

  notifyPackageEmpty(projectId, packageBalanceId) {
    this.notifyProject(projectId, 'SMS_PACKAGE_EMPTY', 'sms-package-empty:' + packageBalanceId,
      '短信套餐已用完', '项目的一个短信套餐已用完，后续发送将按当前计费模式处理。')
  }

  checkLimits(account) {
    const daily = Number(account.daily_limit || 0)
    const monthly = Number(account.monthly_limit || 0)
    if (!daily && !monthly) return
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const count = start => this.db.prepare("SELECT COUNT(*) AS count FROM sms_requests WHERE project_id=? AND status IN ('RESERVED','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=?")
      .get(account.project_id, start).count
    if (daily && count(dayStart) >= daily) fail('短信每日发送上限已达到', 429)
    if (monthly && count(monthStart) >= monthly) fail('短信每月发送上限已达到', 429)
  }

  providerConfig() {
    const row = this.settingsRaw()
    if (row.enabled !== 1) fail('短信服务未启用', 503)
    if (!row.access_key_id || !row.access_key_secret_cipher || !row.default_sign_name) fail('短信服务配置不完整', 503)
    if (!this.masterKey) fail('短信服务密钥未配置', 503)
    try { return { ...row, accessKeySecret: open(row.access_key_secret_cipher, this.masterKey) } }
    catch { fail('短信服务密钥无法解密', 503) }
  }

  async send(instanceId, body = {}, requestKey) {
    const instance = this.instanceProject(text(instanceId, '实例编号', 36))
    const account = this.ensureAccount(instance.project_id)
    if (account.enabled !== 1) fail('短信服务账户已停用', 403)
    const template = this.templateForSend(body.templateKey)
    const phone = text(body.phone, '手机号', 20).replace(/\s+/g, '')
    if (!PHONE.test(phone)) fail('手机号格式不正确')
    const variables = this.validateVariables(template, body.variables)
    const key = optionalText(requestKey || body.requestKey, '幂等键', 128)
    if (!KEY.test(key)) fail('幂等键格式不正确')
    if (!this.receiptKey) fail('短信回执渠道尚未配置', 503)
    const digest = 'hmac:' + createHmac('sha256', this.masterKey || this.receiptKey).update(JSON.stringify(variables)).digest('hex')
    const phoneHash = this.phoneHashKey(phone)
    const existing = this.db.prepare('SELECT * FROM sms_requests WHERE instance_id=? AND request_key=?').get(instance.instance_id, key)
    if (existing) {
      if (existing.phone_hash !== phoneHash || existing.template_id !== template.id ||
          (existing.variables_digest.startsWith('hmac:') && existing.variables_digest !== digest))
        fail('短信幂等键已被其他请求使用', 409)
      if (existing.status === 'RESERVED' && Date.now() - Date.parse(existing.updated_at) > 60000) this.markUnknown(existing.id, 'SMS_STALE_RESERVATION')
      return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(existing.id))
    }
    const provider = this.providerConfig()
    const units = Math.max(1, Number(template.billing_units) || 1)
    const price = Math.max(0, Number(account.unit_price_cents) || 0)
    const billable = template.billable === 1
    let packageRow = null
    let billingMode = billable ? account.billing_mode : 'FREE'
    let charge = billable ? price * units : 0
    if (billable && account.billing_mode === 'PACKAGE') {
      packageRow = this.activePackages(instance.project_id, units)[0] || null
      if (!packageRow) fail('短信套餐不足，请先购买套餐', 409)
      charge = 0
    } else if (billable && account.billing_mode === 'HYBRID') {
      packageRow = this.activePackages(instance.project_id, units)[0] || null
      if (packageRow) { billingMode = 'PACKAGE'; charge = 0 }
      else billingMode = 'METERED'
    }
    if (billable && billingMode === 'METERED') {
      const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(instance.project_id)
      if (!wallet || wallet.balance_cents - wallet.reserved_cents < charge) fail('短信余额不足，请联系平台充值', 409)
    }
    const requestId = randomUUID()
    const time = this.now()
    this.store.transaction(() => {
      this.checkLimits(account)
      if (billable && packageRow) {
        const changed = this.db.prepare("UPDATE sms_package_balances SET reserved_count=reserved_count+?,updated_at=? WHERE id=? AND remaining_count-reserved_count>=? AND status='ACTIVE'")
          .run(units, time, packageRow.id, units).changes
        if (!changed) fail('短信套餐额度已被占用，请重试', 409)
      } else if (billable && billingMode === 'METERED') {
        const changed = this.db.prepare('UPDATE sms_wallets SET reserved_cents=reserved_cents+?,updated_at=? WHERE project_id=? AND balance_cents-reserved_cents>=?')
          .run(charge, time, instance.project_id, charge).changes
        if (!changed) fail('短信余额不足，请联系平台充值', 409)
      }
      this.db.prepare('INSERT INTO sms_requests(id,instance_id,project_id,request_key,template_id,scene,phone_hash,phone_masked,variables_digest,billing_mode,billing_status,billing_units,unit_price_cents,charge_cents,package_balance_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(requestId, instance.instance_id, instance.project_id, key, template.id, template.scene, phoneHash, maskPhone(phone), digest, billingMode, 'RESERVED', units, price, charge, packageRow?.id || null, 'RESERVED', time, time)
    })
    let result
    try {
      result = await this.provider.send({
        endpoint: provider.endpoint, accessKeyId: provider.access_key_id, accessKeySecret: provider.accessKeySecret,
        signName: template.sign_name || provider.default_sign_name, templateCode: template.provider_template_code, phone, outId: requestId, variables, timeoutMs: provider.timeout_ms
      })
    } catch (error) {
      if (error instanceof SmsProviderUncertain) {
        this.markUnknown(requestId, error.code)
        return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
      }
      this.release(requestId, 'SMS_PROVIDER_ERROR')
      fail('短信通道暂时不可用，请稍后重试', 503)
    }
    if (!result.accepted) {
      this.release(requestId, result.code || 'SMS_PROVIDER_REJECTED')
      return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
    }
    this.db.prepare("UPDATE sms_requests SET status='ACCEPTED',provider_request_id=?,provider_message_id=?,updated_at=? WHERE id=? AND status IN ('RESERVED','UNKNOWN')")
      .run(result.requestId || '', result.bizId || '', this.now(), requestId)
    return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
  }

  verifyReceipt(headers, rawBody) {
    if (!this.receiptKey) fail('短信回执渠道尚未配置', 503)
    const timestamp = String(headers['x-sms-receipt-timestamp'] || '')
    const signature = String(headers['x-sms-receipt-signature'] || '')
    if (!/^[0-9]{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/i.test(signature))
      fail('短信回执认证失败', 401)
    const expected = createHmac('sha256', this.receiptKey).update(timestamp + '\n' + rawBody).digest()
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail('短信回执认证失败', 401)
  }

  applyReceipts(reports) {
    if (!Array.isArray(reports) || reports.length > 300) fail('短信回执格式无效', 400)
    const ready = new Map()
    for (const report of reports) {
      const id = String(report?.out_id || ''), bizId = String(report?.biz_id || '')
      if (!/^[0-9a-f-]{36}$/.test(id) || !bizId || bizId.length > 120 || typeof report.success !== 'boolean') continue
      const request = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(id)
      if (!request || request.billing_status !== 'RESERVED' || !['RESERVED','ACCEPTED','UNKNOWN'].includes(request.status)) continue
      if (request.provider_message_id && request.provider_message_id !== bizId) continue
      if (!ready.has(id)) ready.set(id, { id, bizId, success: report.success })
    }
    for (const report of ready.values()) {
      if (report.success) this.settleDelivered(report.id, report.bizId)
      else this.release(report.id, 'SMS_DELIVERY_FAILED')
    }
    return { processed: ready.size }
  }

  async processAliyunHttpReports(reports) {
    const list = Array.isArray(reports) ? reports : [reports]
    if (list.length > 300) fail('短信回执格式无效', 400)
    const provider = this.providerConfig()
    let checked = 0, applied = 0
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const id = String(item.out_id || ''), bizId = String(item.biz_id || ''), phone = String(item.phone_number || '')
      if (!/^[0-9a-f-]{36}$/.test(id) || !bizId || bizId.length > 120 || !PHONE.test(phone)) continue
      const row = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(id)
      if (!row || row.billing_status !== 'RESERVED' || !['RESERVED','ACCEPTED','UNKNOWN'].includes(row.status)) continue
      if (row.provider_message_id && row.provider_message_id !== bizId) continue
      if (this.phoneHashKey(phone) !== row.phone_hash) continue
      const sentAt = Number(item.send_time)
      const created = Number.isFinite(sentAt) && sentAt > 0 ? sentAt : Date.parse(row.created_at)
      if (!Number.isFinite(created)) continue
      const sendDate = new Date(created + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')
      let delivery
      try {
        delivery = await this.provider.queryDelivery({
          accessKeyId: provider.access_key_id, accessKeySecret: provider.accessKeySecret,
          phone, sendDate, bizId: row.provider_message_id || bizId, outId: row.id, timeoutMs: provider.timeout_ms
        })
      } catch (error) {
        console.error('SMS_HTTP_RECEIPT_QUERY_FAILED', row.id, error?.message || 'unknown')
        continue
      }
      checked++
      if (delivery !== 'DELIVERED' && delivery !== 'FAILED') continue
      const result = this.applyReceipts([{ out_id: row.id, biz_id: row.provider_message_id || bizId, success: delivery === 'DELIVERED' }])
      applied += result.processed
    }
    return { received: list.length, checked, applied }
  }

  settleDelivered(requestId, bizId) {
    return this.store.transaction(() => {
      const request = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId)
      if (!request || request.billing_status !== 'RESERVED' || !['RESERVED','ACCEPTED','UNKNOWN'].includes(request.status)) return this.publicRequest(request)
      if (request.provider_message_id && request.provider_message_id !== bizId) return this.publicRequest(request)
      const time = this.now()
      if (request.billing_status === 'RESERVED' && request.package_balance_id) {
        const changed = this.db.prepare('UPDATE sms_package_balances SET remaining_count=remaining_count-?,reserved_count=reserved_count-?,updated_at=? WHERE id=? AND remaining_count>=? AND reserved_count>=?')
          .run(request.billing_units, request.billing_units, time, request.package_balance_id, request.billing_units, request.billing_units).changes
        if (!changed) throw new Error('SMS_PACKAGE_RESERVATION_BROKEN')
        const pkg = this.db.prepare('SELECT remaining_count,reserved_count FROM sms_package_balances WHERE id=?').get(request.package_balance_id)
        if (pkg && pkg.remaining_count - pkg.reserved_count <= 0) this.notifyPackageEmpty(request.project_id, request.package_balance_id)
        const wallet = this.db.prepare('SELECT balance_cents FROM sms_wallets WHERE project_id=?').get(request.project_id)
        this.db.prepare('INSERT INTO sms_ledger(id,project_id,instance_id,request_id,type,amount_cents,balance_after_cents,package_balance_id,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), request.project_id, request.instance_id, request.id, 'PACKAGE_CHARGE', 0, Number(wallet?.balance_cents || 0), request.package_balance_id, 'system', '短信套餐消耗', time)
      } else if (request.billing_status === 'RESERVED' && request.billing_mode === 'METERED') {
        const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(request.project_id)
        const balance = wallet.balance_cents - request.charge_cents
        const reserved = wallet.reserved_cents - request.charge_cents
        if (balance < 0 || reserved < 0) throw new Error('SMS_WALLET_RESERVATION_BROKEN')
        this.db.prepare('UPDATE sms_wallets SET balance_cents=?,reserved_cents=?,updated_at=? WHERE project_id=?').run(balance, reserved, time, request.project_id)
        this.db.prepare('INSERT INTO sms_ledger(id,project_id,instance_id,request_id,type,amount_cents,balance_after_cents,operator,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), request.project_id, request.instance_id, request.id, 'CHARGE', request.charge_cents, balance, 'system', '短信发送成功', time)
        this.notifyLowBalance(request.project_id, balance, this.ensureAccount(request.project_id))
      }
      this.db.prepare("UPDATE sms_requests SET status='DELIVERED',billing_status=?,provider_message_id=?,completed_at=?,updated_at=? WHERE id=?")
        .run(request.billing_mode === 'FREE' ? 'FREE' : 'CHARGED', bizId, time, time, request.id)
      return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
    })
  }

  release(requestId, errorCode = 'SMS_FAILED') {
    return this.store.transaction(() => {
      const request = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId)
      if (!request || request.billing_status !== 'RESERVED' || !['RESERVED', 'UNKNOWN', 'ACCEPTED'].includes(request.status)) return this.publicRequest(request)
      const time = this.now()
      if (request.package_balance_id) this.db.prepare('UPDATE sms_package_balances SET reserved_count=MAX(0,reserved_count-?),updated_at=? WHERE id=?').run(request.billing_units, time, request.package_balance_id)
      else if (request.billing_mode === 'METERED') this.db.prepare('UPDATE sms_wallets SET reserved_cents=MAX(0,reserved_cents-?),updated_at=? WHERE project_id=?').run(request.charge_cents, time, request.project_id)
      this.db.prepare("UPDATE sms_requests SET status='FAILED',billing_status='RELEASED',error_code=?,completed_at=?,updated_at=? WHERE id=?").run(String(errorCode || 'SMS_FAILED').slice(0, 80), time, time, request.id)
      return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
    })
  }

  markUnknown(requestId, errorCode = 'SMS_DELIVERY_UNKNOWN') {
    this.db.prepare("UPDATE sms_requests SET status='UNKNOWN',error_code=?,updated_at=? WHERE id=? AND status='RESERVED'").run(String(errorCode).slice(0, 80), this.now(), requestId)
    return this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId))
  }

  publicRequest(row) {
    if (!row) return null
    return { requestId: row.id, status: row.status, errorCode: row.error_code || null, providerMessageId: row.provider_message_id || null,
      billing: { mode: row.billing_mode, status: row.billing_status, chargedCents: row.billing_status === 'CHARGED' ? row.charge_cents : 0, packageUnits: row.package_balance_id ? row.billing_units : 0 } }
  }

  clientAccount(instanceId) {
    const instance = this.instanceProject(text(instanceId, '实例编号', 36))
    const account = this.ensureAccount(instance.project_id)
    const wallet = this.db.prepare('SELECT * FROM sms_wallets WHERE project_id=?').get(instance.project_id)
    const packages = this.db.prepare('SELECT b.id,p.name,b.remaining_count-b.reserved_count AS remaining_count,b.valid_until FROM sms_package_balances b JOIN sms_package_products p ON p.id=b.package_product_id WHERE b.project_id=? AND b.status=\'ACTIVE\' AND b.valid_until>? ORDER BY b.valid_until,b.created_at').all(instance.project_id, this.now())
    const templates = this.db.prepare("SELECT template_key,name,scene,min_client_version FROM sms_templates WHERE status='ACTIVE' ORDER BY template_key").all()
    const usage = this.usageSummary(instance.project_id)
    return { instanceId: instance.instance_id, projectId: instance.project_id, billingMode: account.billing_mode, unitPriceCents: account.unit_price_cents,
      balanceCents: wallet?.balance_cents || 0, reservedCents: wallet?.reserved_cents || 0, dailyLimit: account.daily_limit, monthlyLimit: account.monthly_limit,
      ready: account.enabled === 1 && this.settingsRaw().enabled === 1 && Boolean(this.receiptKey && this.masterKey), packages, templates, usage,
      availablePackages: this.availablePackages(instanceId) }
  }

  requestForInstance(instanceId, requestId) {
    const row = this.db.prepare('SELECT * FROM sms_requests WHERE instance_id=? AND id=?').get(text(instanceId, '实例编号', 36), text(requestId, '请求编号', 36))
    if (!row) fail('短信请求不存在', 404)
    return this.publicRequest(row)
  }

  verifyClient(headers, method, path, rawBody, body = {}) {
    const instanceId = optionalText(headers['x-sms-instance'], '短信实例编号', 36)
    const timestamp = optionalText(headers['x-sms-timestamp'], '短信时间戳', 20)
    const nonce = optionalText(headers['x-sms-nonce'], '短信随机数', 128)
    const signature = optionalText(headers['x-sms-signature'], '短信签名', 128)
    const idempotencyKey = optionalText(headers['idempotency-key'] || '', '短信幂等键', 128)
    if (!instanceId || !timestamp || !nonce || !signature) fail('短信请求认证失败', 401)
    if (!/^[0-9]{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) fail('短信请求已过期', 401)
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(nonce)) fail('短信请求认证失败', 401)
    if (body.instanceId && String(body.instanceId) !== instanceId) fail('短信请求实例不一致', 403)
    if (!/^[a-f0-9]{64}$/i.test(signature)) fail('短信请求认证失败', 401)
    const credential = this.db.prepare("SELECT * FROM sms_client_credentials WHERE instance_id=? AND status='ACTIVE'").get(instanceId)
    if (!credential) fail('短信接入凭据不存在', 401)
    const message = [method, path, timestamp, nonce, idempotencyKey, sha256(rawBody || '')].join(String.fromCharCode(10))
    if (!this.masterKey) fail('短信服务密钥未配置', 503)
    let clientSecret
    try { clientSecret = open(credential.secret_cipher, this.masterKey) }
    catch { fail('短信接入凭据无法解密', 503) }
    const expected = createHmac('sha256', clientSecret).update(message).digest('hex')
    const left = Buffer.from(expected, 'hex'), right = Buffer.from(signature.toLowerCase(), 'hex')
    if (left.length !== right.length || !timingSafeEqual(left, right)) fail('短信请求认证失败', 401)
    this.consumeNonce(instanceId, nonce, Number(timestamp) + 300001)
    this.db.prepare('UPDATE sms_client_credentials SET last_used_at=? WHERE instance_id=?').run(this.now(), instanceId)
    return instanceId
  }

  consumeNonce(instanceId, nonce, expiresAt) {
    const now = Date.now()
    this.db.prepare('DELETE FROM sms_request_nonces WHERE expires_at<=?').run(now)
    try {
      this.db.prepare('INSERT INTO sms_request_nonces(instance_id,nonce,expires_at,created_at) VALUES (?,?,?,?)')
        .run(instanceId, nonce, expiresAt, this.now())
    } catch {
      fail('短信请求已使用，请重新发起', 401)
    }
  }

  credentials() {
    return this.db.prepare('SELECT i.id AS instance_id,i.name AS instance_name,i.project_id,c.name AS customer_name,p.name AS project_name,cc.status,cc.rotated_at,cc.last_used_at FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id LEFT JOIN sms_client_credentials cc ON cc.instance_id=i.id ORDER BY c.name,i.name').all()
  }

  rotateCredential(instanceId, actor = 'owner') {
    const id = identifier(instanceId, '实例编号')
    if (!this.db.prepare('SELECT id FROM instances WHERE id=?').get(id)) fail('实例不存在', 404)
    const secret = randomBytes(32).toString('base64url')
    const time = this.now()
    this.store.transaction(() => {
      if (!this.masterKey) fail('未配置 AUTHORITY_SMS_MASTER_KEY，不能生成短信接入凭据', 503)
      this.db.prepare('INSERT INTO sms_client_credentials(instance_id,secret_cipher,status,created_at,rotated_at) VALUES (?,?,\'ACTIVE\',?,?) ON CONFLICT(instance_id) DO UPDATE SET secret_cipher=excluded.secret_cipher,status=\'ACTIVE\',rotated_at=excluded.rotated_at').run(id, seal(secret, this.masterKey), time, time)
      this.store.audit(actor, 'ROTATE_SMS_CREDENTIAL', id)
    })
    return { instanceId: id, secret }
  }

  usageSummary(projectId) {
    return this.db.prepare("SELECT COUNT(*) AS total_count,COUNT(CASE WHEN COALESCE(provider_message_id,'')<>'' OR status='DELIVERED' THEN 1 END) AS provider_accepted_count,COUNT(CASE WHEN status='ACCEPTED' AND billing_status='RESERVED' THEN 1 END) AS waiting_receipt_count,MAX(CASE WHEN status='DELIVERED' OR error_code='SMS_DELIVERY_FAILED' THEN completed_at END) AS last_confirmed_at,COUNT(CASE WHEN status='DELIVERED' THEN 1 END) AS delivered_count,COUNT(CASE WHEN status='FAILED' THEN 1 END) AS failed_count,COUNT(CASE WHEN billing_status='RESERVED' THEN 1 END) AS pending_count,COUNT(CASE WHEN status='ACCEPTED' AND billing_status<>'RESERVED' THEN 1 END) AS legacy_accepted_count,COALESCE(SUM(CASE WHEN billing_status='CHARGED' THEN charge_cents ELSE 0 END),0) AS charged_cents,COALESCE(SUM(CASE WHEN billing_status='CHARGED' AND package_balance_id IS NOT NULL THEN billing_units ELSE 0 END),0) AS package_units FROM sms_requests WHERE (? IS NULL OR project_id=?)").get(projectId || null, projectId || null)
  }

  usage(projectId, limit = 200) {
    const size = Math.max(1, Math.min(number(limit, 200), 500))
    const sql = 'SELECT r.id,r.project_id,r.instance_id,r.scene,r.phone_masked,r.status,r.billing_status,r.charge_cents,r.error_code,r.provider_message_id,r.created_at,r.completed_at,i.name AS instance_name FROM sms_requests r JOIN instances i ON i.id=r.instance_id'
    if (projectId) return this.db.prepare(sql + ' WHERE r.project_id=? ORDER BY r.created_at DESC LIMIT ?').all(projectId, size)
    return this.db.prepare(sql + ' ORDER BY r.created_at DESC LIMIT ?').all(size)
  }

  async reconcileDelivery(requestId, body = {}, actor = 'owner') {
    const row = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId)
    if (!row) fail('短信请求不存在', 404)
    if (row.billing_status !== 'RESERVED' || row.status !== 'ACCEPTED' || !row.provider_message_id)
      fail('仅支持已受理、等待回执的短信对账', 409)
    const phone = optionalText(body.phone, '原接收手机号', 20)
    if (!PHONE.test(phone) || this.phoneHashKey(phone) !== row.phone_hash)
      fail('原接收手机号与记录不匹配', 400)
    const created = Date.parse(row.created_at)
    if (!Number.isFinite(created) || Date.now() - created > 30 * 86400000)
      fail('超出阿里云 30 天查询范围，不能自动补结算', 409)
    const sendDate = new Date(created + 8 * 3600000).toISOString().slice(0,10).replaceAll('-','')
    const provider = this.providerConfig()
    let delivery
    try {
      delivery = await this.provider.queryDelivery({ accessKeyId:provider.access_key_id,
        accessKeySecret:provider.accessKeySecret, phone, sendDate, bizId:row.provider_message_id,
        outId:row.id, timeoutMs:provider.timeout_ms })
    } catch (error) {
      if (error.code === 'SMS_QUERY_PERMISSION_REQUIRED' || error.message === 'SMS_QUERY_PERMISSION_REQUIRED')
        fail('请为授权中心 RAM 账号授予 dysms:QuerySendDetails 权限后重试', 503)
      fail('阿里云查询失败；未改账，请核对查询权限或稍后重试', 503)
    }
    if (delivery !== 'DELIVERED' && delivery !== 'FAILED')
      return { ...this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(row.id)), checked:false }
    const result = this.applyReceipts([{out_id:row.id,biz_id:row.provider_message_id,success:delivery==='DELIVERED'}])
    if (result.processed) this.store.audit(actor,'SMS_RECONCILE_DELIVERY',row.id,{status:delivery})
    return { ...this.publicRequest(this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(row.id)), checked:true }
  }

  releaseUnknown(requestId, actor = 'owner') {
    const request = this.db.prepare('SELECT * FROM sms_requests WHERE id=?').get(requestId)
    if (!request) fail('短信请求不存在', 404)
    const pastReceiptDeadline = Date.now() - Date.parse(request.created_at) >= 24 * 3600000
    if (request.billing_status !== 'RESERVED' || !['ACCEPTED','RESERVED','UNKNOWN'].includes(request.status)
        || (request.status !== 'UNKNOWN' && !pastReceiptDeadline))
      fail('只有未知结果或超过 24 小时未收到回执的预占可以释放', 409)
    const released = this.release(requestId, 'SMS_MANUAL_RELEASE_UNKNOWN')
    this.store.audit(actor, 'SMS_RELEASE_UNKNOWN', requestId)
    return released
  }
}
