import { DatabaseSync } from 'node:sqlite'
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, scryptSync, sign, timingSafeEqual, verify } from 'node:crypto'
import { mkdirSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Management, DEFAULT_PRODUCT, publicReleaseText } from './management.mjs'
import { Releases } from './releases.mjs'

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
export const fail = (message, status = 400) => { throw new HttpError(status, message) }
export function text(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label}不能为空，且最多 ${maximum} 字符`)
  return value.trim()
}
export function identifier(value, label = '编号') { const result = text(value, label, 64); if (!/^[A-Za-z0-9_-]+$/.test(result)) fail(`${label}只能包含字母、数字、下划线和短横线`); return result }
export function integer(value, label, min = 0, max = 100000000) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}须为 ${min} 至 ${max} 的整数`); return value }
export function domainName(value, label = '授权域名') {
  const raw = text(value, label, 253)
  let host = raw
  if (raw.includes('://')) { let url; try { url = new URL(raw) } catch { fail(`${label}格式不正确`) }; if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' && url.pathname !== '') fail(`${label}须为域名或 http/https 地址`) ; host = url.hostname }
  host = host.toLowerCase().replace(/\.$/, '')
  const wildcard = host.startsWith('*.') ? '*.' : ''
  const valueHost = wildcard ? host.slice(2) : host
  if (valueHost.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(valueHost)) fail(`${label}格式不正确，填写例如 jaxapi.kkimg.top`)
  return wildcard + valueHost
}
export function domains(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  const result = [...new Set(values.filter(Boolean).map(item => domainName(item)))]
  if (!result.length || result.length > 20) fail('至少填写一个授权域名，最多 20 个')
  return result
}
export function timestamp(value, label) {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) fail(`${label}须填写带时区的完整时间`)
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) fail(`${label}须包含时区`)
  return new Date(value).toISOString()
}
export function compareVersions(left, right) {
  const parse = value => { const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?$/.exec(String(value)); if (!match) fail('客户端版本号不正确，请按客户后台显示填写'); return [match.slice(1,4).map(Number), match[4]?.split('.')] }
  const [a, ap] = parse(left), [b, bp] = parse(right)
  for (let i=0;i<3;i++) if(a[i]!==b[i])return Math.sign(a[i]-b[i])
  if(!ap||!bp)return ap?-1:bp?1:0
  for(let i=0;i<Math.max(ap.length,bp.length);i++){if(ap[i]==null)return -1;if(bp[i]==null)return 1;if(ap[i]===bp[i])continue;const an=/^\d+$/.test(ap[i]),bn=/^\d+$/.test(bp[i]);if(an&&bn)return Math.sign(Number(ap[i])-Number(bp[i]));if(an!==bn)return an?-1:1;return ap[i]<bp[i]?-1:1}
  return 0
}
export function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
export function checkPassword(password, encoded) {
  const [salt, hash] = encoded.split(':'); const actual = scryptSync(String(password), salt, 64); const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
const digest = value => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const day = 86400000

export class AuthorityStore {
  constructor({ database, privateKey, ownerUsername, ownerPassword }) {
    this.key = createPrivateKey(privateKey)
    if (this.key.asymmetricKeyType !== 'ed25519') throw new Error('授权私钥必须为 Ed25519')
    this.publicKey = createPublicKey(this.key).export({ type: 'spki', format: 'pem' })
    this.dataDirectory = database === ':memory:' ? null : path.dirname(path.resolve(database))
    if (this.dataDirectory) mkdirSync(this.dataDirectory, { recursive: true })
    this.db = new DatabaseSync(database)
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owners (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, username TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instances (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', domains TEXT NOT NULL DEFAULT '[]', maintenance_until TEXT NOT NULL DEFAULT '', client_version TEXT NOT NULL DEFAULT '', last_seen_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER CHECK(price_cents>=0), term_days INTEGER NOT NULL, status TEXT NOT NULL, min_version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL REFERENCES instances(id), module_id TEXT NOT NULL REFERENCES modules(id), amount_cents INTEGER NOT NULL, term_days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'UNPAID', payment_reference TEXT, paid_at TEXT, granted_at TEXT, valid_from TEXT, valid_until TEXT, cancel_reason TEXT, cancelled_at TEXT, refund_reference TEXT, refunded_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entitlements (instance_id TEXT NOT NULL REFERENCES instances(id), module_id TEXT NOT NULL REFERENCES modules(id), valid_from TEXT NOT NULL, valid_until TEXT, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(instance_id,module_id));
      CREATE TABLE IF NOT EXISTS licenses (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), instance_id TEXT NOT NULL REFERENCES instances(id), issued_at TEXT NOT NULL, expires_at TEXT, envelope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases (version TEXT PRIMARY KEY, channel TEXT NOT NULL, notes TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL, published_at TEXT);
      CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, config_schema TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance_plugins (instance_id TEXT NOT NULL REFERENCES instances(id), plugin_id TEXT NOT NULL REFERENCES plugins(id), enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY(instance_id,plugin_id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);`)
    const instanceColumns = new Set(this.db.prepare('PRAGMA table_info(instances)').all().map(column => column.name))
    if (!instanceColumns.has('domains')) this.db.exec("ALTER TABLE instances ADD COLUMN domains TEXT NOT NULL DEFAULT '[]'")
    if (!instanceColumns.has('maintenance_until')) this.db.exec("ALTER TABLE instances ADD COLUMN maintenance_until TEXT NOT NULL DEFAULT ''")
    if (!instanceColumns.has('last_seen_at')) this.db.exec('ALTER TABLE instances ADD COLUMN last_seen_at TEXT')
    const orderColumns = new Set(this.db.prepare('PRAGMA table_info(orders)').all().map(column => column.name))
    if (!orderColumns.has('valid_from')) this.db.exec('ALTER TABLE orders ADD COLUMN valid_from TEXT')
    if (!orderColumns.has('valid_until')) this.db.exec('ALTER TABLE orders ADD COLUMN valid_until TEXT')
    if (!orderColumns.has('cancel_reason')) this.db.exec('ALTER TABLE orders ADD COLUMN cancel_reason TEXT')
    if (!orderColumns.has('cancelled_at')) this.db.exec('ALTER TABLE orders ADD COLUMN cancelled_at TEXT')
    if (!orderColumns.has('refund_reference')) this.db.exec('ALTER TABLE orders ADD COLUMN refund_reference TEXT')
    if (!orderColumns.has('refunded_at')) this.db.exec('ALTER TABLE orders ADD COLUMN refunded_at TEXT')
    const entitlementColumns = new Set(this.db.prepare('PRAGMA table_info(entitlements)').all().map(column => column.name))
    if (!entitlementColumns.has('enabled')) this.db.exec('ALTER TABLE entitlements ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    this.db.exec("UPDATE entitlements SET enabled=1 WHERE enabled IS NULL OR enabled NOT IN (0,1)")
    const fingerprint = digest(this.publicKey)
    const existing = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('signing_key')
    if (existing && existing.value !== fingerprint) throw new Error('签发密钥与数据库不匹配，拒绝自动更换签发身份')
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('signing_key', fingerprint)
    if (!this.db.prepare('SELECT COUNT(*) AS count FROM owners').get().count) {
      if (!ownerUsername || !ownerPassword || ownerPassword.length < 16) throw new Error('首次启动必须配置独立的管理员账号和至少 16 字符密码')
      this.db.prepare('INSERT INTO owners VALUES (?,?)').run(ownerUsername, passwordHash(ownerPassword))
    }
    this.db.prepare('INSERT OR IGNORE INTO modules(id,name,description,price_cents,term_days,status,min_version) VALUES (?,?,?,?,?,?,?)').run('advanced_income_reports', '收益对比分析', '客户侧已实现的等长周期收益对比及汇总导出模块。', null, 365, 'DRAFT', '1.1.0')
    const plugins = [
      ['wechat_pay','微信支付','支付','配置客户实例的微信支付商户参数，由运营后台集中维护。',[
        {key:'appId',label:'支付关联 AppID',type:'text',required:true},
        {key:'paymentMethods',label:'支付方式',type:'multiselect',options:['H5','JSAPI','NATIVE','APP'],required:true},
        {key:'merchantId',label:'商户号',type:'text',required:true},
        {key:'apiV3Key',label:'API v3 密钥',type:'password',required:true},
        {key:'merchantSerialNo',label:'商户证书序列号',type:'text',required:true},
        {key:'privateKeyPath',label:'商户私钥路径',type:'text',required:true},
        {key:'publicKeyId',label:'微信支付公钥 ID',type:'text',required:true},
        {key:'publicKeyPath',label:'微信支付公钥路径',type:'text',required:true},
        {key:'notifyUrl',label:'支付回调地址',type:'text',required:true},
        {key:'h5AppName',label:'H5 支付展示名称',type:'text',required:false},
        {key:'h5Type',label:'H5 客户端类型（WAP/IOS/ANDROID）',type:'text',required:false},
      ]],
      ['wechat_miniapp','微信小程序','渠道','配置小程序 AppID、Secret 和订阅消息模板。',[
        {key:'appId',label:'AppID',type:'text',required:true},
        {key:'secret',label:'AppSecret',type:'password',required:true},
        {key:'orderStatusTemplate',label:'订单状态模板 ID',type:'text',required:false},
        {key:'incomeTemplate',label:'收入模板 ID',type:'text',required:false},
      ]],
      ['aliyun_sms','阿里云短信','通知','配置短信签名、AccessKey 和模板。',[
        {key:'accessKeyId',label:'AccessKey ID',type:'text',required:true},
        {key:'accessKeySecret',label:'AccessKey Secret',type:'password',required:true},
        {key:'signName',label:'短信签名',type:'text',required:true},
        {key:'endpoint',label:'Endpoint',type:'text',required:false},
        {key:'messageTemplate',label:'消息提醒模板 Code',type:'text',required:false},
      ]]
    ]
    const addPlugin = this.db.prepare('INSERT INTO plugins VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description,config_schema=excluded.config_schema')
    for (const [id,name,category,description,schema] of plugins) addPlugin.run(id,name,category,description,JSON.stringify(schema),'ACTIVE',now())
    this.management = new Management(this)
    this.releaseService = new Releases(this)
    if(database!==':memory:')for(const file of [database,database+'-wal',database+'-shm'])if(existsSync(file))chmodSync(file,0o600)
  }
  close() { this.db.close() }
  audit(actor, action, target, detail = {}) { this.db.prepare('INSERT INTO audit(actor,action,target,detail,created_at) VALUES (?,?,?,?,?)').run(actor, action, target, JSON.stringify(detail), now()) }
  transaction(action) { if(this.transactionDepth)return action(); this.db.exec('BEGIN IMMEDIATE');this.transactionDepth=1; try { const value = action(); this.db.exec('COMMIT'); return value } catch (error) { this.db.exec('ROLLBACK'); throw error } finally {this.transactionDepth=0} }
  session(token) {
    if (!token || token.length > 128) return null
    return this.db.prepare('SELECT username,csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) || null
  }
  login(username, password) {
    const account = this.db.prepare('SELECT * FROM owners WHERE username=?').get(String(username || ''))
    // Use the same KDF on unknown accounts to avoid a fast account-existence oracle.
    const valid = checkPassword(String(password || ''), account?.password_hash || 'dummy-salt:' + '0'.repeat(128))
    if (!account || !valid) fail('账号或密码不正确', 401)
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url')
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token), csrf, account.username, Date.now() + 8 * 3600000)
    this.audit(account.username, 'LOGIN', account.username)
    return { token, csrf, username: account.username }
  }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)) }
  lists() {
    return {
      customers: this.db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all(),
      modules: this.db.prepare('SELECT * FROM modules ORDER BY id').all(),
      orders: this.db.prepare('SELECT o.*,i.customer_id,c.name AS customer_name,i.name AS instance_name,m.name AS module_name FROM orders o JOIN instances i ON i.id=o.instance_id JOIN customers c ON c.id=i.customer_id JOIN modules m ON m.id=o.module_id ORDER BY o.created_at DESC').all(),
      entitlements: this.listEntitlements(),
      licenses: this.db.prepare('SELECT l.id,l.order_id,l.instance_id,l.issued_at,l.expires_at,i.customer_id,i.domains FROM licenses l JOIN instances i ON i.id=l.instance_id ORDER BY l.issued_at DESC').all().map(row => ({...row, domains: JSON.parse(row.domains || '[]')})),
      audit: this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all(),
      ...this.management.lists()
    }
  }
  createCustomer(body, actor) {
    const id = identifier(body.id, '客户编号'), name = text(body.name, '客户名称', 80), note = String(body.note || '').slice(0, 500)
    return this.transaction(() => { this.db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run(id, name, 'ACTIVE', note, now()); this.audit(actor, 'CREATE_CUSTOMER', id); return { id } })
  }
  updateCustomer(id, body, actor) {
    id = identifier(id, '客户编号')
    if (!this.db.prepare('SELECT id FROM customers WHERE id=?').get(id)) fail('客户不存在', 404)
    const name = text(body.name, '客户名称', 80), note = String(body.note || '').slice(0, 500), status = body.status || 'ACTIVE'
    if (!['ACTIVE', 'DISABLED'].includes(status)) fail('客户状态不正确')
    return this.transaction(() => {
      this.db.prepare('UPDATE customers SET name=?,status=?,note=? WHERE id=?').run(name,status,note,id)
      this.audit(actor,'UPDATE_CUSTOMER',id,{status});return {id,status}
    })
  }
  deleteCustomer(id, actor) {
    id = identifier(id, '客户编号')
    if (!this.db.prepare('SELECT id FROM customers WHERE id=?').get(id)) fail('客户不存在', 404)
    const projects=this.db.prepare('SELECT COUNT(*) AS count FROM projects WHERE customer_id=?').get(id).count
    const instances=this.db.prepare('SELECT COUNT(*) AS count FROM instances WHERE customer_id=?').get(id).count
    if (projects || instances) fail('该客户仍有关联项目或实例，不能删除；请先停用客户或清理关联项目', 409)
    return this.transaction(() => { this.db.prepare('DELETE FROM customers WHERE id=?').run(id); this.audit(actor,'DELETE_CUSTOMER',id); return {id} })
  }
  createInstance(body, actor) {
    const id = text(body.id, '实例编号', 36)
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/.test(id)) fail('请复制客户后台显示的小写 UUID 实例编号')
    const customer = this.db.prepare('SELECT * FROM customers WHERE id=?').get(identifier(body.customerId, '客户编号'))
    if (!customer || customer.status !== 'ACTIVE') fail('客户不存在或未启用')
    const name = text(body.name, '实例名称', 80)
    let domain = ''
    const project = body.projectId ? this.db.prepare('SELECT * FROM projects WHERE id=? AND customer_id=?').get(body.projectId,customer.id) : null
    if (body.projectId && !project) fail('所属项目与客户不匹配')
    const allowedDomains = domains(body.domains), maintenanceUntil = timestamp(project?.maintenance_until || body.maintenanceUntil, '维护期至')
    if (Date.parse(maintenanceUntil) <= Date.now()) fail('维护期必须晚于当前时间')
    if (body.domain) { const host = domainName(body.domain, '客户后台地址'); domain = 'https://' + host }
    return this.transaction(() => {
      const projectId=project?.id || this.management.saveProject(null,{customerId:customer.id,productId:DEFAULT_PRODUCT,name,maintenanceUntil},actor).id
      this.db.prepare('INSERT INTO instances(id,customer_id,name,domain,domains,maintenance_until,client_version,last_seen_at,created_at,project_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, customer.id, name, domain, JSON.stringify(allowedDomains), maintenanceUntil, '', null, now(),projectId)
      this.audit(actor, 'CREATE_INSTANCE', id, { customerId: customer.id, domains: allowedDomains, maintenanceUntil }); return { id }
    })
  }
  updateInstance(id, body, actor) {
    const instance = this.db.prepare('SELECT * FROM instances WHERE id=?').get(text(id, '实例编号', 36))
    if (!instance) fail('实例不存在', 404)
    const name = text(body.name, '实例名称', 80)
    const allowedDomains = domains(body.domains), maintenanceUntil = timestamp(body.maintenanceUntil, '维护期至')
    if (Date.parse(maintenanceUntil) <= Date.now()) fail('维护期必须晚于当前时间')
    return this.transaction(() => {
      this.db.prepare('UPDATE instances SET name=?,domains=? WHERE id=?').run(name, JSON.stringify(allowedDomains), id)
      this.db.prepare('UPDATE projects SET maintenance_until=? WHERE id=?').run(maintenanceUntil,instance.project_id)
      this.db.prepare('UPDATE instances SET maintenance_until=? WHERE project_id=?').run(maintenanceUntil,instance.project_id)
      for (const row of this.db.prepare('SELECT id FROM instances WHERE project_id=?').all(instance.project_id)) this.management.reconcileLicense(row.id)
      this.audit(actor, 'UPDATE_INSTANCE', id, { domains: allowedDomains, maintenanceUntil }); return { id }
    })
  }
  listEntitlements(at = Date.now()) {
    return this.db.prepare(`SELECT e.instance_id,e.module_id,e.valid_from,e.valid_until,e.enabled,
      i.customer_id,i.name AS instance_name,i.maintenance_until,i.project_id,
      c.name AS customer_name,m.name AS module_name,m.price_cents,m.term_days,m.status AS module_status
      FROM entitlements e JOIN instances i ON i.id=e.instance_id JOIN customers c ON c.id=i.customer_id
      JOIN modules m ON m.id=e.module_id ORDER BY i.created_at DESC,e.module_id`).all()
      .map(row => this.entitlementView(row, at))
  }
  entitlementView(row, at = Date.now()) {
    const validFrom = row.valid_from, maintenanceUntil = row.maintenance_until || null
    const naturalUntil = row.valid_until || maintenanceUntil
    const effectiveUntil = naturalUntil && maintenanceUntil ? new Date(Math.min(Date.parse(naturalUntil), Date.parse(maintenanceUntil))).toISOString() : naturalUntil
    const enabled = Boolean(row.enabled)
    const status = !enabled ? 'DISABLED' : Date.parse(validFrom) > at ? 'PENDING' : !effectiveUntil || Date.parse(effectiveUntil) <= at ? 'EXPIRED' : 'ACTIVE'
    const remaining_days = effectiveUntil ? Math.max(0, Math.ceil((Date.parse(effectiveUntil) - at) / day)) : 0
    return {...row, original_until: naturalUntil, valid_until: effectiveUntil, effective_until: effectiveUntil, enabled, price_cents: row.price_cents ?? null, term_days: row.term_days ?? 0, status, remaining_days}
  }
  currentEntitlements(instanceId, at = Date.now()) {
    const instance = this.db.prepare('SELECT i.maintenance_until,p.maintenance_until AS project_until FROM instances i JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(instanceId)
    if (!instance) return []
    const maintenanceUntil = instance.project_until || instance.maintenance_until
    if (!maintenanceUntil || Date.parse(maintenanceUntil) <= at) return []
    return this.db.prepare(`SELECT e.*,m.name AS module_name,m.price_cents,m.term_days FROM entitlements e
      JOIN modules m ON m.id=e.module_id WHERE e.instance_id=? AND e.valid_from<=?
      AND (e.valid_until IS NULL OR e.valid_until>?) ORDER BY e.module_id`).all(instanceId, new Date(at).toISOString(), new Date(at).toISOString())
      .map(row => {
        const until = row.valid_until ? new Date(Math.min(Date.parse(row.valid_until), Date.parse(maintenanceUntil))).toISOString() : maintenanceUntil
        return {...row, valid_until: until, effectiveUntil: until, maintenance_until: maintenanceUntil}
      }).filter(row => Date.parse(row.valid_until) > at)
  }
  activeEntitlements(instanceId, at = Date.now()) {
    return this.currentEntitlements(instanceId, at).filter(row => Boolean(row.enabled))
  }
  openOrder(instanceId, moduleId) {
    return this.db.prepare("SELECT id FROM orders WHERE instance_id=? AND module_id=? AND status IN ('UNPAID','PAID','MAINTENANCE') AND granted_at IS NULL LIMIT 1").get(instanceId, moduleId)
  }
  createEntitlement(body, actor) {
    const instanceId = text(body.instanceId, '实例编号', 36), moduleId = identifier(body.moduleId, '模块编号')
    const at = Date.now(), validFrom = timestamp(body.validFrom || now(), '生效时间')
    if (Date.parse(validFrom) > at) fail('生效时间不能晚于当前时间')
    const instance = this.db.prepare('SELECT i.*,p.product_id,p.maintenance_until AS project_until,p.status AS project_status,c.status AS customer_status FROM instances i JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=i.customer_id WHERE i.id=?').get(instanceId)
    const module = this.db.prepare('SELECT * FROM modules WHERE id=?').get(moduleId)
    if (!instance || instance.customer_status !== 'ACTIVE' || instance.project_status !== 'ACTIVE') fail('实例、项目或客户不存在/已停用', 404)
    if (!module || module.status !== 'ACTIVE' || module.price_cents == null) fail('模块未上架或尚未定价')
    if (module.product_id !== instance.product_id) fail('该模块不属于此实例的软件')
    const maintenanceUntil = timestamp(instance.project_until || instance.maintenance_until, '维护期至')
    let validUntil = body.validUntil ? timestamp(body.validUntil, '到期时间') : new Date(Math.min(Date.parse(validFrom) + module.term_days * day, Date.parse(maintenanceUntil))).toISOString()
    if (Date.parse(validUntil) > Date.parse(maintenanceUntil)) fail('权益到期时间不能超过项目维护期')
    if (Date.parse(validUntil) <= Date.parse(validFrom)) fail('到期时间必须晚于生效时间')
    if (this.db.prepare('SELECT 1 FROM entitlements WHERE instance_id=? AND module_id=?').get(instanceId, moduleId)) fail('该实例已存在此功能权益', 409)
    const enabled = body.enabled === undefined ? true : body.enabled
    if (typeof enabled !== 'boolean') fail('开通状态须为布尔值')
    return this.transaction(() => {
      this.db.prepare('INSERT INTO entitlements(instance_id,module_id,valid_from,valid_until,enabled) VALUES (?,?,?,?,?)').run(instanceId, moduleId, validFrom, validUntil, enabled ? 1 : 0)
      this.audit(actor, 'CREATE_ENTITLEMENT', `${instanceId}:${moduleId}`, {validFrom, validUntil, enabled})
      const row = this.entitlementView(this.db.prepare(`SELECT e.*,i.customer_id,i.name AS instance_name,i.maintenance_until,i.project_id,c.name AS customer_name,m.name AS module_name,m.price_cents,m.term_days,m.status AS module_status FROM entitlements e JOIN instances i ON i.id=e.instance_id JOIN customers c ON c.id=i.customer_id JOIN modules m ON m.id=e.module_id WHERE e.instance_id=? AND e.module_id=?`).get(instanceId, moduleId))
      return {...row, license: this.management.reconcileLicense(instanceId)}
    })
  }
  updateEntitlement(instanceId, moduleId, body, actor) {
    instanceId = text(instanceId, '实例编号', 36); moduleId = identifier(moduleId, '模块编号')
    const existing = this.db.prepare('SELECT e.*,i.maintenance_until AS instance_until,p.maintenance_until AS project_until FROM entitlements e JOIN instances i ON i.id=e.instance_id JOIN projects p ON p.id=i.project_id WHERE e.instance_id=? AND e.module_id=?').get(instanceId, moduleId)
    if (!existing) fail('功能权益不存在', 404)
    const at = Date.now(), hasValidFrom = body.validFrom !== undefined, hasValidUntil = body.validUntil !== undefined
    const validFrom = timestamp(body.validFrom ?? existing.valid_from, '生效时间')
    if (hasValidFrom && Date.parse(validFrom) > at) fail('生效时间不能晚于当前时间')
    const maintenanceUntil = existing.project_until || existing.instance_until
    const validUntil = timestamp(body.validUntil ?? existing.valid_until, '到期时间')
    const effectiveUntil = new Date(Math.min(Date.parse(validUntil), Date.parse(maintenanceUntil))).toISOString()
    if (Date.parse(validUntil) > Date.parse(maintenanceUntil) && hasValidUntil && validUntil !== existing.valid_until) fail('新的权益到期时间不能超过项目维护期')
    if (Date.parse(effectiveUntil) <= Date.parse(validFrom)) fail('当前有效到期时间必须晚于生效时间')
    const enabled = body.enabled === undefined ? Boolean(existing.enabled) : body.enabled
    if (typeof enabled !== 'boolean') fail('开通状态须为布尔值')
    return this.transaction(() => {
      this.db.prepare('UPDATE entitlements SET valid_from=?,valid_until=?,enabled=? WHERE instance_id=? AND module_id=?').run(validFrom, validUntil, enabled ? 1 : 0, instanceId, moduleId)
      this.audit(actor, 'UPDATE_ENTITLEMENT', `${instanceId}:${moduleId}`, {validFrom, validUntil, enabled})
      const row = this.listEntitlements().find(item => item.instance_id === instanceId && item.module_id === moduleId)
      return {...row, license: this.management.reconcileLicense(instanceId)}
    })
  }
  deleteEntitlement(instanceId, moduleId, actor) {
    instanceId = text(instanceId, '实例编号', 36); moduleId = identifier(moduleId, '模块编号')
    if (!this.db.prepare('SELECT 1 FROM entitlements WHERE instance_id=? AND module_id=?').get(instanceId, moduleId)) fail('功能权益不存在', 404)
    return this.transaction(() => {
      this.db.prepare('DELETE FROM entitlements WHERE instance_id=? AND module_id=?').run(instanceId, moduleId)
      this.audit(actor, 'DELETE_ENTITLEMENT', `${instanceId}:${moduleId}`)
      return {instanceId, moduleId, license: this.management.reconcileLicense(instanceId)}
    })
  }
  orderPreview(instanceIdValue, moduleIdValue, at = Date.now()) {
    const instanceId = text(instanceIdValue, '实例编号', 36), moduleId = identifier(moduleIdValue, '模块编号')
    const instance = this.db.prepare('SELECT i.*,p.product_id,p.maintenance_until AS project_until,p.status AS project_status,c.status AS customer_status FROM instances i JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=i.customer_id WHERE i.id=?').get(instanceId)
    const module = this.db.prepare('SELECT * FROM modules WHERE id=?').get(moduleId)
    if (!instance || instance.customer_status !== 'ACTIVE' || instance.project_status !== 'ACTIVE') fail('实例、项目或客户不存在/已停用', 404)
    if (!module || module.status !== 'ACTIVE' || module.price_cents == null) fail('模块尚未定价上架')
    if (module.product_id !== instance.product_id) fail('该模块不属于此项目的软件')
    const maintenanceUntil = instance.project_until || instance.maintenance_until
    if (!maintenanceUntil || Date.parse(maintenanceUntil) <= at) fail('请先设置有效的项目维护期', 409)
    const openOrder = this.openOrder(instanceId, moduleId)
    if (openOrder) fail('该实例已有此功能的未完成订单（待收款、已收款未签发或维护期接入），请先完成或作废现有订单', 409)
    const entitlement = this.db.prepare('SELECT * FROM entitlements WHERE instance_id=? AND module_id=?').get(instanceId, moduleId)
    const renewal = Boolean(entitlement?.valid_from && Date.parse(entitlement.valid_from) <= at && entitlement.valid_until && Date.parse(entitlement.valid_until) > at)
    if (entitlement && !entitlement.valid_until) fail('该实例已有此模块的永久授权，请先编辑为明确到期时间', 409)
    const base = renewal ? Math.min(Date.parse(entitlement.valid_until), Date.parse(maintenanceUntil)) : at
    const validUntil = new Date(Math.min(base + module.term_days * day, Date.parse(maintenanceUntil))).toISOString()
    const addedDays = Math.max(0, Math.ceil((Date.parse(validUntil) - base) / day))
    if (addedDays <= 0) fail('项目维护期已无可分配的新增权益天数', 409)
    return { priceCents: module.price_cents, termDays: module.term_days, validFrom: renewal ? entitlement.valid_until : new Date(at).toISOString(), validUntil, currentExpiry: renewal ? entitlement.valid_until : null, newExpiry: validUntil, days: addedDays, addDays: addedDays, totalRemainingDays: Math.max(0, Math.ceil((Date.parse(validUntil) - at) / day)), renewal, maintenanceUntil }
  }
  updateModule(id, body, actor) {
    const existing=this.db.prepare('SELECT * FROM modules WHERE id=?').get(id)
    if (!existing) fail('模块不存在', 404)
    const name=text(body.name??existing.name,'模块名称',80),description=text(body.description??existing.description,'模块说明',1000)
    const minVersion=text(body.minVersion??existing.min_version,'最低客户端版本',80);compareVersions(minVersion,minVersion)
    const productId=body.productId==null?existing.product_id:identifier(body.productId,'软件编号')
    if(!this.db.prepare('SELECT id FROM products WHERE id=?').get(productId))fail('软件不存在',404)
    if(productId!==existing.product_id&&(this.db.prepare('SELECT 1 FROM orders WHERE module_id=? LIMIT 1').get(id)||this.db.prepare('SELECT 1 FROM entitlements WHERE module_id=? LIMIT 1').get(id)))fail('已有订单或授权的模块不能更换所属软件',409)
    const price = body.priceCents === undefined ? existing.price_cents : body.priceCents == null ? null : integer(body.priceCents, '价格（分）')
    const days = body.termDays==null?existing.term_days:integer(body.termDays, '授权天数', 0, 3660), status = body.status??existing.status
    if (!['DRAFT', 'ACTIVE'].includes(status) || (status === 'ACTIVE' && price == null)) fail('模块上架前必须配置价格')
    return this.transaction(() => { this.db.prepare('UPDATE modules SET name=?,description=?,price_cents=?,term_days=?,status=?,min_version=?,product_id=? WHERE id=?').run(name,description,price,days,status,minVersion,productId,id); this.audit(actor, 'UPDATE_MODULE', id, { productId,name,priceCents: price, termDays: days, status,minVersion }); return { id } })
  }
  deleteModule(id,actor) {
    if(!this.db.prepare('SELECT id FROM modules WHERE id=?').get(id))fail('模块不存在',404)
    const orders=this.db.prepare('SELECT COUNT(*) AS count FROM orders WHERE module_id=?').get(id).count
    const grants=this.db.prepare('SELECT COUNT(*) AS count FROM entitlements WHERE module_id=?').get(id).count
    if(orders||grants)fail('该模块已有订单或授权记录，不能删除；请改为草稿停用',409)
    return this.transaction(()=>{this.db.prepare('DELETE FROM modules WHERE id=?').run(id);this.audit(actor,'DELETE_MODULE',id);return {id}})
  }
  createOrder(body, actor) {
    const instanceId = text(body.instanceId, '实例编号', 36), moduleId = identifier(body.moduleId, '模块编号')
    const instance = this.db.prepare('SELECT i.*,c.status,p.product_id,p.maintenance_until AS project_until FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(instanceId)
    const module = this.db.prepare('SELECT * FROM modules WHERE id=?').get(moduleId)
    if (!instance || instance.status !== 'ACTIVE') fail('实例或客户不存在/已停用')
    const preview = this.orderPreview(instanceId, moduleId)
    if (instance.client_version && compareVersions(instance.client_version, module.min_version) < 0) fail(`此模块要求客户端 ${module.min_version} 或更新版本，请先升级客户系统`, 409)
    if (this.openOrder(instanceId, moduleId)) fail('该实例已有此功能的未完成订单（待收款、已收款未签发或维护期接入），请先完成或作废现有订单', 409)
    if (preview.days <= 0) fail('项目维护期已没有可分配的权益天数', 409)
    const id = randomUUID()
    const createdAt = now()
    return this.transaction(() => { this.db.prepare('INSERT INTO orders(id,instance_id,module_id,amount_cents,term_days,valid_from,valid_until,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, instanceId, moduleId, preview.priceCents, preview.termDays, preview.validFrom, preview.validUntil, createdAt); this.audit(actor, 'CREATE_ORDER', id, { amountCents: preview.priceCents, validFrom: preview.validFrom, validUntil: preview.validUntil, renewal: preview.renewal }); return { id, ...preview } })
  }
  markPaid(id, body, actor) {
    const reference = text(body.reference, '收款核对凭据', 200)
    return this.transaction(() => {
      const order = this.db.prepare('SELECT o.*,i.maintenance_until AS instance_until,p.maintenance_until AS project_until FROM orders o JOIN instances i ON i.id=o.instance_id JOIN projects p ON p.id=i.project_id WHERE o.id=?').get(id)
      if (!order) fail('订单不存在', 404)
      if (order.status === 'PAID') return { id }
      if (order.status !== 'UNPAID') fail('订单状态不支持确认收款', 409)
      this.validateOrderQuote(order)
      this.db.prepare("UPDATE orders SET status='PAID',payment_reference=?,paid_at=? WHERE id=?").run(reference, now(), id)
      this.audit(actor, 'CONFIRM_MANUAL_PAYMENT', id, { amountCents: order.amount_cents, reference }); return { id }
    })
  }
  validateOrderQuote(order, at = Date.now()) {
    if (!order.valid_from || !order.valid_until) fail('订单缺少有效报价快照，请作废后重新下单', 409)
    const validFrom = timestamp(order.valid_from, '订单生效时间')
    const validUntil = timestamp(order.valid_until, '订单到期时间')
    if (Date.parse(validUntil) <= Date.parse(validFrom)) fail('订单报价区间不正确，请作废后重新下单', 409)
    if (Date.parse(validUntil) <= at) fail('订单报价已超过到期时间，请作废后重新下单', 409)
    const maintenanceUntil = timestamp(order.project_until || order.instance_until, '维护期至')
    if (Date.parse(maintenanceUntil) < Date.parse(validUntil)) fail('项目维护期已早于订单到期时间，请重新报价后再收款或签发', 409)
    return { validFrom, validUntil, maintenanceUntil }
  }
  cancelOrder(id, body, actor) {
    const reason = text(body.reason, '作废原因', 200)
    return this.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(id)
      if (!order) fail('订单不存在', 404)
      if (order.status === 'CANCELLED') return { id, status: 'CANCELLED' }
      if (order.granted_at) fail('已签发授权的订单不能作废', 409)
      if (!['UNPAID','PAID','MAINTENANCE'].includes(order.status)) fail('订单状态不支持作废', 409)
      const refundReference = order.status === 'PAID' ? text(body.refundReference, '退款凭据', 200) : null
      const at = now()
      this.db.prepare("UPDATE orders SET status='CANCELLED',cancel_reason=?,cancelled_at=?,refund_reference=?,refunded_at=? WHERE id=?").run(reason, at, refundReference, refundReference ? at : null, id)
      this.audit(actor, 'CANCEL_ORDER', id, { reason, amountCents: order.amount_cents, previousStatus: order.status, refundReference })
      return { id, status: 'CANCELLED' }
    })
  }
  grantMaintenance(id, body, actor) {
    const note = text(body.note, '维护期接入说明', 200)
    return this.transaction(() => {
      const order = this.db.prepare('SELECT o.*,i.maintenance_until AS instance_until,p.maintenance_until AS project_until FROM orders o JOIN instances i ON i.id=o.instance_id JOIN projects p ON p.id=i.project_id WHERE o.id=?').get(id)
      if (!order) fail('订单不存在', 404)
      if (order.status === 'MAINTENANCE') return { id }
      if (order.status !== 'UNPAID') fail('只有待确认订单可以登记维护期接入', 409)
      this.validateOrderQuote(order)
      this.db.prepare("UPDATE orders SET status='MAINTENANCE',payment_reference=? WHERE id=?").run(note, id)
      this.audit(actor, 'GRANT_MAINTENANCE_ACCESS', id, { amountCents: order.amount_cents, note }); return { id }
    })
  }
  issue(id, actor) {
    return this.transaction(() => {
      const duplicate = this.db.prepare('SELECT id,envelope FROM licenses WHERE order_id=?').get(id)
      if (duplicate) return { id: duplicate.id, envelope: JSON.parse(duplicate.envelope) }
      const order = this.db.prepare('SELECT o.*,i.customer_id,i.domains,i.maintenance_until,p.maintenance_until AS project_until,c.status AS customer_status FROM orders o JOIN instances i ON i.id=o.instance_id JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=i.customer_id WHERE o.id=?').get(id)
      if (!order || !['PAID','MAINTENANCE'].includes(order.status) || order.customer_status !== 'ACTIVE') fail('只能为已收款或维护期接入的有效客户订单签发授权', 409)
      const {validFrom, validUntil: snappedUntil, maintenanceUntil} = this.validateOrderQuote({...order, instance_until: order.maintenance_until})
      const existingUntil = this.db.prepare('SELECT valid_until FROM entitlements WHERE instance_id=? AND module_id=?').get(order.instance_id,order.module_id)?.valid_until
      const protectedUntil = Math.max(Date.parse(snappedUntil), existingUntil ? Date.parse(existingUntil) : 0)
      if (protectedUntil > Date.parse(maintenanceUntil)) fail('现有权益到期时间晚于当前维护期，请联系维护人员核对', 409)
      const until = new Date(protectedUntil).toISOString()
      const last = this.db.prepare('SELECT issued_at FROM licenses WHERE instance_id=? ORDER BY issued_at DESC LIMIT 1').get(order.instance_id)
      const issuedAt = new Date(Math.max(Date.now(), last ? Date.parse(last.issued_at) + 1 : 0)).toISOString()
      this.db.prepare('INSERT INTO entitlements(instance_id,module_id,valid_from,valid_until,enabled) VALUES (?,?,?,?,1) ON CONFLICT(instance_id,module_id) DO UPDATE SET valid_from=CASE WHEN entitlements.valid_from>? THEN ? ELSE entitlements.valid_from END,valid_until=excluded.valid_until,enabled=1').run(order.instance_id, order.module_id, validFrom, until, issuedAt, issuedAt)
      const grants = this.activeEntitlements(order.instance_id, Date.now())
      const licenseId = randomUUID(), expiresAt = maintenanceUntil, allowedDomains = JSON.parse(order.domains)
      const features = grants.length ? grants.map(grant => grant.module_id) : ['core_platform']
      const featureExpiresAt = grants.length ? Object.fromEntries(grants.map(grant => [grant.module_id, grant.valid_until])) : {core_platform: expiresAt}
      const claims = { licenseId, customerId: order.customer_id, instanceId: order.instance_id, issuedAt, notBefore: issuedAt, expiresAt, features, featureExpiresAt, allowedDomains }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const envelope = { format: 'delta-license-v1', payload, signature: sign(null, Buffer.from('delta-license-v1.' + payload), this.key).toString('base64url') }
      this.db.prepare('INSERT INTO licenses VALUES (?,?,?,?,?,?)').run(licenseId, id, order.instance_id, issuedAt, expiresAt, JSON.stringify(envelope))
      this.db.prepare('UPDATE orders SET granted_at=? WHERE id=?').run(issuedAt, id)
      this.management.reconcileLicense(order.instance_id)
      this.audit(actor, 'ISSUE_LICENSE', licenseId, { orderId: id, instanceId: order.instance_id, features: claims.features, expiresAt, allowedDomains })
      return { id: licenseId, envelope }
    })
  }
  license(id) { const row = this.db.prepare('SELECT envelope FROM licenses WHERE id=?').get(id); if (!row) fail('授权不存在', 404); return JSON.parse(row.envelope) }
  updatePlugin(instanceId, pluginId, body, actor) {
    const instance = this.db.prepare('SELECT * FROM instances WHERE id=?').get(text(instanceId, '实例编号', 36))
    const plugin = this.db.prepare('SELECT * FROM plugins WHERE id=?').get(identifier(pluginId, '插件编号'))
    if (!instance || !plugin || plugin.status!=='ACTIVE') fail('实例或插件不存在', 404)
    if (typeof body.enabled !== 'boolean' || !body.config || typeof body.config !== 'object' || Array.isArray(body.config)) fail('插件启用状态或配置格式不正确')
    const schema = JSON.parse(plugin.config_schema), allowed = new Set(schema.map(field => field.key)), clean = {}
    for (const [key,value] of Object.entries(body.config)) {
      if (!allowed.has(key)) fail(`插件配置包含未知字段：${key}`)
      const field=schema.find(field=>field.key===key)
      if (field.type==='multiselect') {
        if (!Array.isArray(value) || value.length>field.options.length || new Set(value).size!==value.length || value.some(item=>!field.options.includes(item))) fail('支付方式选择不正确')
        if (value.length) clean[key]=value
        continue
      }
      if (typeof value !== 'string' || value.length > 5000) fail(`插件配置 ${key} 格式不正确`)
      if (value.trim()) clean[key] = value.trim()
    }
    if (body.enabled) for (const field of schema.filter(field => field.required)) if (!clean[field.key]) fail(`启用前请填写${field.label}`)
    const config = JSON.stringify(clean)
    return this.transaction(() => {
      this.db.prepare('INSERT INTO instance_plugins(instance_id,plugin_id,enabled,config,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(instance_id,plugin_id) DO UPDATE SET enabled=excluded.enabled,config=excluded.config,updated_at=excluded.updated_at').run(instanceId,pluginId,body.enabled?1:0,config,now())
      this.audit(actor, 'UPDATE_PLUGIN', `${instanceId}:${pluginId}`, { enabled: body.enabled, fields: Object.keys(clean) })
      return { instanceId, pluginId, enabled: body.enabled, config: JSON.parse(config) }
    })
  }
  reportVersion(license, version) {
    if (!license || !['delta-license-v1','cangshuo-instance-v1'].includes(license.format) || typeof license.payload !== 'string' || license.payload.length>24000 || typeof license.signature !== 'string' || license.signature.length>128) fail('客户端授权信息无效', 401)
    version = text(version, '客户端版本', 80); compareVersions(version, version)
    if (!verify(null, Buffer.from(license.format+'.' + license.payload), this.publicKey, Buffer.from(license.signature, 'base64url'))) fail('客户端授权签名无效', 401)
    let claims
    try { claims = JSON.parse(Buffer.from(license.payload, 'base64url')) } catch { fail('客户端授权内容无效', 401) }
    // A signed expired identity can still check renewal; it never grants expired business access.
    if (claims.instanceId == null || claims.customerId == null) fail('客户端授权已失效', 401)
    const instance = this.db.prepare('SELECT * FROM instances WHERE id=?').get(claims.instanceId)
    if (!instance || instance.customer_id !== claims.customerId) fail('授权实例不存在或客户不匹配', 403)
    const reportedAt = now()
    this.transaction(() => {
      this.db.prepare('UPDATE instances SET client_version=?,last_seen_at=? WHERE id=?').run(version, reportedAt, instance.id)
      if (instance.client_version !== version) this.audit('client', 'CLIENT_VERSION_REPORT', instance.id, { from: instance.client_version, to: version })
    })
    return { accepted: true, instanceId: instance.id, version, reportedAt, ...this.management.clientResponse(instance.id,version) }
  }
  createRelease(body, actor) { return this.releaseService.create(body,actor) }
  publishRelease(version, actor) { return this.releaseService.publish(DEFAULT_PRODUCT,version,actor) }
  publishedReleases(productId=DEFAULT_PRODUCT) { return this.db.prepare("SELECT version,channel,notes,published_at,items FROM release_catalog WHERE product_id=? AND status='PUBLISHED' AND channel='stable'").all(productId).sort((a,b)=>compareVersions(b.version,a.version)).map(row=>({...row,notes:publicReleaseText(row.notes),items:JSON.parse(row.items).map(item=>({...item,description:publicReleaseText(item.description)})),notesUrl:`/public/release-notes/${encodeURIComponent(productId)}/${encodeURIComponent(row.version)}`})) }
}
