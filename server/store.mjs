import { DatabaseSync } from 'node:sqlite'
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, scryptSync, sign, timingSafeEqual, verify } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Management, DEFAULT_PRODUCT } from './management.mjs'
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

export class AuthorityStore {
  constructor({ database, privateKey, ownerUsername, ownerPassword }) {
    this.key = createPrivateKey(privateKey)
    if (this.key.asymmetricKeyType !== 'ed25519') throw new Error('授权私钥必须为 Ed25519')
    this.publicKey = createPublicKey(this.key).export({ type: 'spki', format: 'pem' })
    if (database !== ':memory:') mkdirSync(path.dirname(path.resolve(database)), { recursive: true })
    this.db = new DatabaseSync(database)
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owners (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, username TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instances (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', domains TEXT NOT NULL DEFAULT '[]', maintenance_until TEXT NOT NULL DEFAULT '', client_version TEXT NOT NULL DEFAULT '', last_seen_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER CHECK(price_cents>=0), term_days INTEGER NOT NULL, status TEXT NOT NULL, min_version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL REFERENCES instances(id), module_id TEXT NOT NULL REFERENCES modules(id), amount_cents INTEGER NOT NULL, term_days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'UNPAID', payment_reference TEXT, paid_at TEXT, granted_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entitlements (instance_id TEXT NOT NULL REFERENCES instances(id), module_id TEXT NOT NULL REFERENCES modules(id), valid_from TEXT NOT NULL, valid_until TEXT, PRIMARY KEY(instance_id,module_id));
      CREATE TABLE IF NOT EXISTS licenses (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), instance_id TEXT NOT NULL REFERENCES instances(id), issued_at TEXT NOT NULL, expires_at TEXT, envelope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases (version TEXT PRIMARY KEY, channel TEXT NOT NULL, notes TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL, published_at TEXT);
      CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, config_schema TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance_plugins (instance_id TEXT NOT NULL REFERENCES instances(id), plugin_id TEXT NOT NULL REFERENCES plugins(id), enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY(instance_id,plugin_id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);`)
    const instanceColumns = new Set(this.db.prepare('PRAGMA table_info(instances)').all().map(column => column.name))
    if (!instanceColumns.has('domains')) this.db.exec("ALTER TABLE instances ADD COLUMN domains TEXT NOT NULL DEFAULT '[]'")
    if (!instanceColumns.has('maintenance_until')) this.db.exec("ALTER TABLE instances ADD COLUMN maintenance_until TEXT NOT NULL DEFAULT ''")
    if (!instanceColumns.has('last_seen_at')) this.db.exec('ALTER TABLE instances ADD COLUMN last_seen_at TEXT')
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
    const latestStable = this.db.prepare("SELECT version FROM releases WHERE status='PUBLISHED' AND channel='stable' ORDER BY published_at DESC LIMIT 1").get()?.version || null
    const instances = this.db.prepare('SELECT i.*,c.name AS customer_name FROM instances i JOIN customers c ON c.id=i.customer_id ORDER BY i.created_at DESC').all().map(row => {
      let updateAvailable = false
      if (row.client_version && latestStable) try { updateAvailable = compareVersions(row.client_version, latestStable) < 0 } catch {}
      return {...row, domains: JSON.parse(row.domains || '[]'), latest_version: latestStable, update_available: updateAvailable}
    })
    return {
      customers: this.db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all(),
      instances,
      modules: this.db.prepare('SELECT * FROM modules ORDER BY id').all(),
      orders: this.db.prepare('SELECT o.*,i.customer_id,c.name AS customer_name,m.name AS module_name FROM orders o JOIN instances i ON i.id=o.instance_id JOIN customers c ON c.id=i.customer_id JOIN modules m ON m.id=o.module_id ORDER BY o.created_at DESC').all(),
      licenses: this.db.prepare('SELECT l.id,l.order_id,l.instance_id,l.issued_at,l.expires_at,i.customer_id,i.domains FROM licenses l JOIN instances i ON i.id=l.instance_id ORDER BY l.issued_at DESC').all().map(row => ({...row, domains: JSON.parse(row.domains || '[]')})),
      releases: this.db.prepare('SELECT * FROM releases ORDER BY created_at DESC').all(),
      plugins: this.db.prepare("SELECT * FROM plugins WHERE status='ACTIVE' ORDER BY category,id").all().map(row => ({...row, config_schema: JSON.parse(row.config_schema)})),
      instancePlugins: this.db.prepare("SELECT ip.* FROM instance_plugins ip JOIN plugins p ON p.id=ip.plugin_id WHERE p.status='ACTIVE' ORDER BY instance_id,plugin_id").all().map(row => ({...row, enabled: row.enabled === 1, config: JSON.parse(row.config || '{}')})),
      audit: this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all(),
      ...this.management.lists()
    }
  }
  createCustomer(body, actor) {
    const id = identifier(body.id, '客户编号'), name = text(body.name, '客户名称', 80), note = String(body.note || '').slice(0, 500)
    return this.transaction(() => { this.db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run(id, name, 'ACTIVE', note, now()); this.audit(actor, 'CREATE_CUSTOMER', id); return { id } })
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
  updateModule(id, body, actor) {
    if (!this.db.prepare('SELECT id FROM modules WHERE id=?').get(id)) fail('模块不存在', 404)
    const price = body.priceCents == null ? null : integer(body.priceCents, '价格（分）')
    const days = integer(body.termDays, '授权天数', 0, 3660), status = body.status
    if (!['DRAFT', 'ACTIVE'].includes(status) || (status === 'ACTIVE' && price == null)) fail('模块上架前必须配置价格')
    return this.transaction(() => { this.db.prepare('UPDATE modules SET price_cents=?,term_days=?,status=? WHERE id=?').run(price, days, status, id); this.audit(actor, 'UPDATE_MODULE', id, { priceCents: price, termDays: days, status }); return { id } })
  }
  createOrder(body, actor) {
    const instanceId = text(body.instanceId, '实例编号', 36), moduleId = identifier(body.moduleId, '模块编号')
    const instance = this.db.prepare('SELECT i.*,c.status,p.product_id FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(instanceId)
    const module = this.db.prepare('SELECT * FROM modules WHERE id=?').get(moduleId)
    if (!instance || instance.status !== 'ACTIVE') fail('实例或客户不存在/已停用')
    if (!module || module.status !== 'ACTIVE' || module.price_cents == null) fail('模块尚未定价上架')
    if (module.product_id !== instance.product_id) fail('该模块不属于此项目的软件')
    if (instance.client_version && compareVersions(instance.client_version, module.min_version) < 0) fail(`此模块要求客户端 ${module.min_version} 或更新版本，请先升级客户系统`, 409)
    if (!instance.maintenance_until || Date.parse(instance.maintenance_until) <= Date.now()) fail('请先设置有效的维护期，维护期是授权到期时间', 409)
    if (this.db.prepare("SELECT id FROM orders WHERE instance_id=? AND module_id=? AND status='UNPAID'").get(instanceId, moduleId)) fail('该实例已有此模块的待收款订单', 409)
    const entitlement = this.db.prepare('SELECT valid_until FROM entitlements WHERE instance_id=? AND module_id=?').get(instanceId, moduleId)
    if (entitlement && entitlement.valid_until == null) fail('该实例已有此模块的永久授权，无需重复购买', 409)
    const id = randomUUID()
    return this.transaction(() => { this.db.prepare('INSERT INTO orders(id,instance_id,module_id,amount_cents,term_days,created_at) VALUES (?,?,?,?,?,?)').run(id, instanceId, moduleId, module.price_cents, module.term_days, now()); this.audit(actor, 'CREATE_ORDER', id, { amountCents: module.price_cents }); return { id } })
  }
  markPaid(id, body, actor) {
    const reference = text(body.reference, '收款核对凭据', 200)
    return this.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(id)
      if (!order) fail('订单不存在', 404)
      if (order.status === 'PAID') return { id }
      if (order.status !== 'UNPAID') fail('订单状态不支持确认收款', 409)
      this.db.prepare("UPDATE orders SET status='PAID',payment_reference=?,paid_at=? WHERE id=?").run(reference, now(), id)
      this.audit(actor, 'CONFIRM_MANUAL_PAYMENT', id, { amountCents: order.amount_cents, reference }); return { id }
    })
  }
  grantMaintenance(id, body, actor) {
    const note = text(body.note, '维护期接入说明', 200)
    return this.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(id)
      if (!order) fail('订单不存在', 404)
      if (order.status === 'MAINTENANCE') return { id }
      if (order.status !== 'UNPAID') fail('只有待确认订单可以登记维护期接入', 409)
      this.db.prepare("UPDATE orders SET status='MAINTENANCE',payment_reference=? WHERE id=?").run(note, id)
      this.audit(actor, 'GRANT_MAINTENANCE_ACCESS', id, { amountCents: order.amount_cents, note }); return { id }
    })
  }
  issue(id, actor) {
    return this.transaction(() => {
      const duplicate = this.db.prepare('SELECT id,envelope FROM licenses WHERE order_id=?').get(id)
      if (duplicate) return { id: duplicate.id, envelope: JSON.parse(duplicate.envelope) }
      const order = this.db.prepare('SELECT o.*,i.customer_id,i.domains,i.maintenance_until,c.status AS customer_status FROM orders o JOIN instances i ON i.id=o.instance_id JOIN customers c ON c.id=i.customer_id WHERE o.id=?').get(id)
      if (!order || !['PAID','MAINTENANCE'].includes(order.status) || order.customer_status !== 'ACTIVE') fail('只能为已收款或维护期接入的有效客户订单签发授权', 409)
      const maintenanceUntil = timestamp(order.maintenance_until, '维护期至')
      if (Date.parse(maintenanceUntil) <= Date.now()) fail('维护期已经结束，请先延长维护期并重新签发', 409)
      const last = this.db.prepare('SELECT issued_at FROM licenses WHERE instance_id=? ORDER BY issued_at DESC LIMIT 1').get(order.instance_id)
      const issuedAt = new Date(Math.max(Date.now(), last ? Date.parse(last.issued_at) + 1 : 0)).toISOString()
      // Commercial authorization follows the customer's maintenance period exactly.
      const until = maintenanceUntil
      this.db.prepare('INSERT INTO entitlements VALUES (?,?,?,?) ON CONFLICT(instance_id,module_id) DO UPDATE SET valid_until=excluded.valid_until').run(order.instance_id, order.module_id, issuedAt, until)
      const grants = this.db.prepare('SELECT * FROM entitlements WHERE instance_id=? AND (valid_until IS NULL OR valid_until>?) ORDER BY module_id').all(order.instance_id, issuedAt)
      const licenseId = randomUUID(), expiresAt = maintenanceUntil, allowedDomains = JSON.parse(order.domains)
      const claims = { licenseId, customerId: order.customer_id, instanceId: order.instance_id, issuedAt, notBefore: issuedAt, expiresAt, features: grants.map(grant => grant.module_id), featureExpiresAt: Object.fromEntries(grants.map(grant => [grant.module_id, grant.valid_until])), allowedDomains }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const envelope = { format: 'delta-license-v1', payload, signature: sign(null, Buffer.from('delta-license-v1.' + payload), this.key).toString('base64url') }
      this.db.prepare('INSERT INTO licenses VALUES (?,?,?,?,?,?)').run(licenseId, id, order.instance_id, issuedAt, expiresAt, JSON.stringify(envelope))
      this.db.prepare('UPDATE orders SET granted_at=? WHERE id=?').run(issuedAt, id)
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
  publishedReleases(productId=DEFAULT_PRODUCT) { return this.db.prepare("SELECT version,channel,notes,source_url,published_at,items FROM release_catalog WHERE product_id=? AND status='PUBLISHED' AND channel='stable'").all(productId).sort((a,b)=>compareVersions(b.version,a.version)) }
}
