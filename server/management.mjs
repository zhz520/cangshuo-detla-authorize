import { randomUUID, sign } from 'node:crypto'
import { fail, identifier, text, timestamp, compareVersions } from './store.mjs'

export const DEFAULT_PRODUCT = 'detla'
export const stamp = () => new Date().toISOString()
export function emailAddress(value) {
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(String(value || '')) || value.length > 254) fail('邮箱地址格式不正确')
  return value
}
export function repositoryName(value) {
  const repository = String(value || '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) fail('填写 GitHub owner/repository 仓库名称')
  return repository
}
export class Management {
  constructor(store) {
    this.store = store; this.db = store.db
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, repository TEXT NOT NULL, checked_at TEXT, check_error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, maintenance_until TEXT NOT NULL, pause_policy TEXT NOT NULL DEFAULT 'PENDING', status TEXT NOT NULL DEFAULT 'ACTIVE', notification_email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS release_catalog (product_id TEXT NOT NULL REFERENCES products(id), version TEXT NOT NULL, channel TEXT NOT NULL, notes TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT, items TEXT NOT NULL DEFAULT '[]', assets TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL DEFAULT 'MANUAL', PRIMARY KEY(product_id,version));
      CREATE TABLE IF NOT EXISTS maintenance_licenses (instance_id TEXT PRIMARY KEY REFERENCES instances(id), envelope TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_settings (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_queue (id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, project_id TEXT, event TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT);
      CREATE TABLE IF NOT EXISTS project_status_history (project_id TEXT PRIMARY KEY REFERENCES projects(id), status TEXT NOT NULL);
    `)
    for (const [table, column, definition] of [['instances','project_id','TEXT REFERENCES projects(id)'], ['modules','product_id',"TEXT NOT NULL DEFAULT 'detla'"]]) {
      if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
    store.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO products(id,name,kind,repository,created_at) VALUES (?,?,?,?,?)').run(DEFAULT_PRODUCT,'电竞业务系统','WEB','zhz520/cangshuo-detla',stamp())
      for (const instance of this.db.prepare('SELECT * FROM instances WHERE project_id IS NULL').all()) {
        const projectId = randomUUID()
        this.db.prepare('INSERT INTO projects(id,customer_id,product_id,name,maintenance_until,created_at) VALUES (?,?,?,?,?,?)').run(projectId,instance.customer_id,DEFAULT_PRODUCT,instance.name,instance.maintenance_until,stamp())
        this.db.prepare('UPDATE instances SET project_id=? WHERE id=?').run(projectId,instance.id)
      }
      if (!this.db.prepare("SELECT value FROM metadata WHERE key='release_catalog_migrated'").get()) {
        this.db.exec("INSERT OR IGNORE INTO release_catalog(product_id,version,channel,notes,source_url,status,created_at,published_at) SELECT 'detla',version,channel,notes,source_url,status,created_at,published_at FROM releases")
        this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('release_catalog_migrated','1')
      }
      this.db.prepare("UPDATE plugins SET status='RETIRED' WHERE id IN ('aliyun_sms','wechat_miniapp')").run()
    })
  }
  signed(format, claims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return {format,payload,signature:sign(null,Buffer.from(format+'.'+payload),this.store.key).toString('base64url')}
  }
  projectStatus(project, at = Date.now()) {
    return project.status !== 'ACTIVE' ? 'PAUSED' : Date.parse(project.maintenance_until) <= at ? 'EXPIRED' : 'ACTIVE'
  }
  lists() {
    const products = this.db.prepare('SELECT * FROM products ORDER BY created_at').all()
    const projects = this.db.prepare('SELECT p.*,c.name AS customer_name,s.name AS product_name,s.kind,s.repository FROM projects p JOIN customers c ON c.id=p.customer_id JOIN products s ON s.id=p.product_id ORDER BY p.created_at DESC').all().map(row => ({...row,effective_status:this.projectStatus(row)}))
    const releases = this.db.prepare('SELECT r.*,p.name AS product_name FROM release_catalog r JOIN products p ON p.id=r.product_id ORDER BY r.published_at DESC,r.created_at DESC').all().map(row => ({...row,items:JSON.parse(row.items),assets:JSON.parse(row.assets)}))
    const instances = this.db.prepare('SELECT i.*,c.name AS customer_name,p.name AS project_name,p.product_id,p.pause_policy,p.status AS project_status,p.maintenance_until AS project_maintenance_until FROM instances i JOIN customers c ON c.id=i.customer_id JOIN projects p ON p.id=i.project_id ORDER BY i.created_at DESC').all().map(row => {
      const latest = releases.filter(release => release.product_id===row.product_id && release.channel==='stable' && release.status==='PUBLISHED').sort((a,b)=>compareVersions(b.version,a.version))[0]?.version || null
      return {...row,maintenance_until:row.project_maintenance_until,domains:JSON.parse(row.domains),latest_version:latest,update_available:!!(latest && row.client_version && compareVersions(latest,row.client_version)>0)}
    })
    return {products,projects,releases,instances,mailSettings:this.mailSettings(),mailQueue:this.db.prepare('SELECT id,project_id,event,recipient,subject,status,attempts,next_attempt_at,last_error,created_at,sent_at FROM mail_queue ORDER BY created_at DESC LIMIT 200').all()}
  }
  saveProduct(id, body, actor) {
    id = identifier(id || body.id,'软件编号'); const name = text(body.name,'软件名称',80), repository = repositoryName(body.repository)
    if (!['WEB','H5','MINIAPP','OTHER'].includes(body.kind)) fail('项目类型不正确')
    return this.store.transaction(() => {
      const previous = this.db.prepare('SELECT repository FROM products WHERE id=?').get(id)
      if (previous && previous.repository!==repository && this.db.prepare('SELECT 1 FROM release_catalog WHERE product_id=? LIMIT 1').get(id)) fail('已有版本的软件不能直接更换仓库，请登记新软件')
      this.db.prepare('INSERT INTO products(id,name,kind,repository,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,repository=excluded.repository').run(id,name,body.kind,repository,stamp())
      this.store.audit(actor,'SAVE_PRODUCT',id); return {id}
    })
  }
  saveProject(id, body, actor) {
    const previous = id ? this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) : null
    if (id && !previous) fail('项目不存在',404)
    id ||= randomUUID()
    const customerId = identifier(body.customerId || previous?.customer_id,'客户编号'), productId = identifier(body.productId || previous?.product_id,'软件编号'), name = text(body.name,'项目名称',80)
    const maintenanceUntil = timestamp(body.maintenanceUntil,'维护期至'), policy = body.pausePolicy || previous?.pause_policy || 'PENDING'
    const status = body.status || previous?.status || 'ACTIVE', email = body.notificationEmail ? emailAddress(body.notificationEmail.trim()) : ''
    if (!['PENDING','STOP_ALL','FINISH_EXISTING'].includes(policy) || !['ACTIVE','PAUSED'].includes(status)) fail('暂停策略或状态不正确')
    if (previous && (previous.customer_id!==customerId || previous.product_id!==productId)) fail('项目所属客户和软件不可更改，请新建项目')
    return this.store.transaction(() => {
      this.db.prepare('INSERT INTO projects(id,customer_id,product_id,name,maintenance_until,pause_policy,status,notification_email,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,maintenance_until=excluded.maintenance_until,pause_policy=excluded.pause_policy,status=excluded.status,notification_email=excluded.notification_email').run(id,customerId,productId,name,maintenanceUntil,policy,status,email,stamp())
      this.db.prepare('UPDATE instances SET maintenance_until=? WHERE project_id=?').run(maintenanceUntil,id)
      for (const instance of this.db.prepare('SELECT id FROM instances WHERE project_id=?').all()) this.reconcileLicense(instance.id)
      this.store.audit(actor,previous?'UPDATE_PROJECT':'CREATE_PROJECT',id,{maintenanceUntil,pausePolicy:policy,status})
      if (previous && Date.parse(maintenanceUntil)>Date.parse(previous.maintenance_until)) this.queueProjectMail(id,'RENEWED',`renewed:${id}:${maintenanceUntil}`,'项目维护期已续期',`项目 ${name} 的维护期至 ${maintenanceUntil}，授权将自动同步。`)
      return {id}
    })
  }
  reconcileLicense(instanceId) {
    const instance = this.db.prepare('SELECT i.*,p.maintenance_until AS until_at FROM instances i JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(instanceId)
    if (!instance || !Number.isFinite(Date.parse(instance.until_at)) || Date.parse(instance.until_at)<=Date.now()) return null
    const entitlements = this.db.prepare('SELECT * FROM entitlements WHERE instance_id=? ORDER BY module_id').all(instanceId)
    if (!entitlements.length) return null
    const latest = this.db.prepare('SELECT envelope FROM maintenance_licenses WHERE instance_id=?').get(instanceId)?.envelope || this.db.prepare('SELECT envelope FROM licenses WHERE instance_id=? ORDER BY issued_at DESC LIMIT 1').get(instanceId)?.envelope
    const oldClaims = latest ? JSON.parse(Buffer.from(JSON.parse(latest).payload,'base64url')) : null
    const allowedDomains = JSON.parse(instance.domains)
    if (oldClaims?.expiresAt===instance.until_at && JSON.stringify(oldClaims.allowedDomains)===JSON.stringify(allowedDomains) && JSON.stringify(oldClaims.features)===JSON.stringify(entitlements.map(item=>item.module_id))) return JSON.parse(latest)
    const issuedAt = new Date(Math.max(Date.now(), oldClaims ? Date.parse(oldClaims.issuedAt)+1 : 0)).toISOString()
    const envelope = this.signed('delta-license-v1',{licenseId:randomUUID(),customerId:instance.customer_id,instanceId,issuedAt,notBefore:issuedAt,expiresAt:instance.until_at,features:entitlements.map(row=>row.module_id),featureExpiresAt:Object.fromEntries(entitlements.map(row=>[row.module_id,instance.until_at])),allowedDomains})
    this.db.prepare('UPDATE entitlements SET valid_until=? WHERE instance_id=?').run(instance.until_at,instanceId)
    this.db.prepare('INSERT INTO maintenance_licenses VALUES (?,?,?) ON CONFLICT(instance_id) DO UPDATE SET envelope=excluded.envelope,updated_at=excluded.updated_at').run(instanceId,JSON.stringify(envelope),stamp())
    this.store.audit('system','REISSUE_MAINTENANCE_LICENSE',instanceId,{expiresAt:instance.until_at})
    return envelope
  }
  clientResponse(instanceId, version) {
    const instance = this.db.prepare('SELECT i.*,p.product_id,p.maintenance_until AS until_at,p.pause_policy,p.status FROM instances i JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(instanceId)
    const project = this.signed('cangshuo-project-v1',{customerId:instance.customer_id,projectId:instance.project_id,productId:instance.product_id,instanceId,issuedAt:stamp(),maintenanceUntil:instance.until_at,status:instance.status,pausePolicy:instance.pause_policy,allowedDomains:JSON.parse(instance.domains)})
    return {project,license:this.reconcileLicense(instanceId),updates:this.clientUpdates(instance.product_id,version)}
  }
  identity(instanceId,actor) {
    const row=this.db.prepare('SELECT * FROM instances WHERE id=?').get(instanceId);if(!row)fail('实例不存在',404)
    this.store.audit(actor,'EXPORT_INSTANCE_IDENTITY',instanceId)
    return this.signed('cangshuo-instance-v1',{customerId:row.customer_id,instanceId:row.id,projectId:row.project_id,issuedAt:stamp()})
  }
  updateNotification(instanceId,result) {
    if(!result||!['SUCCEEDED','FAILED','ROLLED_BACK'].includes(result.status)||typeof result.id!=='string'||!/^[a-f0-9-]{36}$/.test(result.id))return
    const row=this.db.prepare('SELECT project_id FROM instances WHERE id=?').get(instanceId)
    this.queueProjectMail(row.project_id,'UPDATE_RESULT',`update:${result.id}:${result.status}`,result.status==='SUCCEEDED'?'客户端更新成功':'客户端更新失败',`实例 ${instanceId} 更新任务 ${result.id}：${result.status==='SUCCEEDED'?'更新成功':result.status==='ROLLED_BACK'?'安装失败，程序已回退':'更新失败，请检查客户端更新记录'}。`)
  }
  saveModule(body,actor) {
    const id=identifier(body.id,'模块编号'),productId=identifier(body.productId,'软件编号'),name=text(body.name,'模块名称',80),description=text(body.description,'模块说明',1000)
    const minVersion=text(body.minVersion,'最低客户端版本',80);compareVersions(minVersion,minVersion)
    this.db.prepare("INSERT INTO modules(id,name,description,price_cents,term_days,status,min_version,product_id) VALUES (?,?,?,NULL,365,'DRAFT',?,?)").run(id,name,description,minVersion,productId)
    this.store.audit(actor,'CREATE_MODULE',id,{productId});return {id}
  }
  clientUpdates(productId, version) {
    compareVersions(version,version)
    const product = this.db.prepare('SELECT * FROM products WHERE id=?').get(productId)
    if (!product) fail('软件不存在',404)
    const releases = this.db.prepare("SELECT * FROM release_catalog WHERE product_id=? AND status='PUBLISHED' AND channel='stable'").all(productId).filter(row=>compareVersions(row.version,version)>0).sort((a,b)=>compareVersions(a.version,b.version)).map(row=>({version:row.version,notes:row.notes,sourceUrl:row.source_url,publishedAt:row.published_at,items:JSON.parse(row.items),assets:JSON.parse(row.assets)}))
    const all = this.db.prepare("SELECT version FROM release_catalog WHERE product_id=? AND status='PUBLISHED' AND channel='stable'").all(productId).sort((a,b)=>compareVersions(b.version,a.version))
    return {currentVersion:version,latestVersion:all[0]?.version || null,updateAvailable:releases.length>0,checkedAt:product.checked_at,checkError:product.check_error,releases,repository:product.repository}
  }
  mailSettings(raw=false) {
    const config = JSON.parse(this.db.prepare('SELECT config FROM mail_settings WHERE id=1').get()?.config || '{}')
    if (raw) return config
    const {password,...rest} = config
    return {...rest,hasPassword:!!password}
  }
  saveMailSettings(body, actor) {
    const previous = this.mailSettings(true)
    const config = {enabled:body.enabled===true,host:String(body.host||'').trim(),port:Number(body.port||465),security:body.security||'TLS',username:String(body.username||'').trim(),password:body.password || previous.password || '',from:String(body.from||'').trim(),senderName:String(body.senderName||'沧烁授权中心').trim(),operatorEmail:String(body.operatorEmail||'').trim()}
    if (!['TLS','STARTTLS'].includes(config.security) || !Number.isSafeInteger(config.port) || config.port<1 || config.port>65535) fail('SMTP 端口或加密方式不正确')
    if (config.host.length>253 || /[\s/]/.test(config.host) || Object.values(config).some(value=>typeof value==='string'&&(value.length>1000 || /[\r\n]/.test(value)))) fail('SMTP 配置格式不正确')
    if (config.enabled) { text(config.host,'SMTP 服务器'); text(config.username,'邮箱账号'); text(config.password,'邮箱密码/授权码',1000); emailAddress(config.from); emailAddress(config.operatorEmail) }
    this.db.prepare('INSERT INTO mail_settings VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at').run(JSON.stringify(config),stamp())
    this.store.audit(actor,'UPDATE_MAIL_SETTINGS','SMTP',{enabled:config.enabled})
    return this.mailSettings()
  }
  queueMail({key,projectId=null,event,recipient,subject,body}) {
    this.db.prepare('INSERT OR IGNORE INTO mail_queue(id,dedupe_key,project_id,event,recipient,subject,body,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),key,projectId,event,emailAddress(recipient),subject,body,stamp(),stamp())
  }
  queueProjectMail(id,event,key,subject,body) {
    const project = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id), settings=this.mailSettings(true)
    for (const recipient of new Set([project.notification_email,settings.operatorEmail].filter(Boolean))) this.queueMail({key:key+':'+recipient,projectId:id,event,recipient,subject,body})
  }
  scheduleNotifications(at=Date.now()) {
    for (const project of this.db.prepare('SELECT * FROM projects').all()) {
      const current = this.projectStatus(project,at), previous=this.db.prepare('SELECT status FROM project_status_history WHERE project_id=?').get(project.id)?.status
      if (previous && previous!==current) this.queueProjectMail(project.id,current,`status:${project.id}:${project.maintenance_until}:${current}`,'项目状态变更',`项目 ${project.name} 状态：${current==='ACTIVE'?'维护期内':current==='EXPIRED'?'维护期已过期':'已暂停'}。维护期至 ${project.maintenance_until}。`)
      this.db.prepare('INSERT INTO project_status_history VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET status=excluded.status').run(project.id,current)
      const remaining = Date.parse(project.maintenance_until)-at
      for (const days of [30,7,1,0]) {
        const due = days===0 ? remaining<=0&&remaining> -86400000 : remaining>0&&remaining<=days*86400000&&remaining>(days-1)*86400000
        if (due) this.queueProjectMail(project.id,'MAINTENANCE_REMINDER',`expiry:${project.id}:${project.maintenance_until}:${days}`,days?'项目维护期即将到期':'项目维护期已到期',`项目 ${project.name} 维护期至 ${project.maintenance_until}。${days?`距到期不足 ${days} 天，请及时续期。`:'项目业务将按暂停策略处理，请及时续期。'}`)
      }
    }
  }
}
