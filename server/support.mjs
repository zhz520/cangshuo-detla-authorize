import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { checkPassword, domainName, fail, identifier, passwordHash, text } from './store.mjs'
import { redactSupportExcerpt, supportRisk } from './support-rules.mjs'
import { SupportModeration } from './support-moderation.mjs'

const now = () => new Date().toISOString()
const token = () => randomBytes(32).toString('base64url')
const hash = value => createHash('sha256').update(value).digest('hex')
const MAX_FILE = 10 * 1024 * 1024
const QUOTA = 256 * 1024 * 1024
const VISITOR_AGE = 30 * 86400
const AGENT_AGE = 8 * 3600
const SEED_AGE = 86400
const cookie = (request,name,pattern='[\\w-]{43}') => (request.headers.cookie||'').match(new RegExp('(?:^|;\\s*)'+name+'=('+pattern+')(?:;|$)'))?.[1]
const visitorPattern='[\\w-]{43}(?:\\.\\d{13}\\.[\\w-]{43})?'
const ipAddress=value=>String(value||'').replace(/^::ffff:/i,'')
function requestKey(request){
  const value=request.headers['x-support-request-id']
  if(value!==undefined&&!/^[0-9a-f]{32}$/.test(value))fail('消息编号不正确')
  return value
}
const idNumber = value => {
  if (!/^[1-9]\d{0,14}$/.test(String(value))) fail('编号无效')
  return Number(value)
}
function fileType(name, bytes) {
  const prefix = value => bytes.subarray(0, value.length).equals(Buffer.from(value))
  if (/\.png$/i.test(name) && bytes.length>=45 && prefix([137,80,78,71,13,10,26,10]) && bytes.readUInt32BE(8)===13 && bytes.toString('ascii',12,16)==='IHDR' && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))) return 'image/png'
  if (/\.jpe?g$/i.test(name) && bytes.length>=16 && prefix([255,216,255]) && bytes.at(-2)===255 && bytes.at(-1)===217) return 'image/jpeg'
  if (/\.webp$/i.test(name) && bytes.length>=20 && prefix('RIFF') && bytes.readUInt32LE(4)===bytes.length-8 && /^WEBP(?:VP8 |VP8L|VP8X)$/.test(bytes.toString('ascii',8,16))) return 'image/webp'
  if (/\.pdf$/i.test(name) && /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.toString('ascii',0,12)) && /%%EOF[\s\x00]*$/.test(bytes.subarray(-1024).toString('ascii'))) return 'application/pdf'
  fail('仅支持 PNG、JPEG、WebP 和 PDF，文件内容须与扩展名一致',415)
}
function privacyLink(value) {
  try {
    const url = new URL(text(value,'隐私说明链接',500))
    if (url.protocol==='https:' && !url.username && !url.password) return url.href
  } catch {}
  fail('请填写 HTTPS 隐私说明链接')
}

export class Support {
  constructor(store, options) {
    this.store = store
    this.db = store.db
    this.buckets = new Map()
    this.uploads = 0
    this.proxyIps=new Set(String(options?.trustedProxyIps??process.env.SUPPORT_TRUSTED_PROXY_IPS??'').split(',').map(value=>ipAddress(value.trim())).filter(isIP))
    this.seedKey=hkdfSync('sha256',store.key.export({type:'pkcs8',format:'der'}),'cangshuo-support','visitor-boot-v1',32)
    store.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS support_sites (
        slug TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), title TEXT NOT NULL,
        privacy_url TEXT NOT NULL, agent_username TEXT NOT NULL, password_hash TEXT NOT NULL,
        blocked_domains TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS support_agent_sessions (
        token_hash TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES support_sites(slug), expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS support_agent_sessions_site ON support_agent_sessions(slug);
      CREATE TABLE IF NOT EXISTS support_conversations (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL REFERENCES support_sites(slug), visitor_hash TEXT NOT NULL UNIQUE,
        visitor_expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, last_message INTEGER NOT NULL DEFAULT 0, last_visitor_message INTEGER NOT NULL DEFAULT 0,
        agent_read INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS support_conversations_site ON support_conversations(slug,status,updated_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES support_conversations(id), sender TEXT NOT NULL,
        content TEXT NOT NULL, file_name TEXT, file_size INTEGER, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS support_messages_conversation ON support_messages(conversation_id,id);
      CREATE TABLE IF NOT EXISTS support_message_requests (
        conversation_id INTEGER NOT NULL REFERENCES support_conversations(id), sender TEXT NOT NULL,
        request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, message_id INTEGER NOT NULL REFERENCES support_messages(id),
        PRIMARY KEY(conversation_id,sender,request_key)
      );
      CREATE TABLE IF NOT EXISTS support_files (
        message_id INTEGER PRIMARY KEY REFERENCES support_messages(id), slug TEXT NOT NULL REFERENCES support_sites(slug),
        size INTEGER NOT NULL, content BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS support_files_site ON support_files(slug,size);
      CREATE TABLE IF NOT EXISTS support_alerts (
        id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES support_conversations(id),
        message_id INTEGER REFERENCES support_messages(id), code TEXT NOT NULL, reason TEXT NOT NULL, excerpt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL, resolution TEXT, resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS support_alerts_status ON support_alerts(status,id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS support_single_report ON support_alerts(conversation_id) WHERE code='visitor_report';
    `))
    this.moderation = new SupportModeration(store,options)
  }
  rate(key, max) {
    const time = Date.now()
    if (this.buckets.size >= 4096) {
      for (const [entry,value] of this.buckets) if (value.end <= time) this.buckets.delete(entry)
      if (this.buckets.size >= 4096 && !this.buckets.has(key)) fail('请求过多，请稍后重试',429)
    }
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.end <= time) { bucket={ count:0,end:time+60000 }; this.buckets.set(key,bucket) }
    if (++bucket.count > max) fail('请求过多，请稍后重试',429)
  }
  ip(request){
    const peer=ipAddress(request.socket.remoteAddress)
    const real=ipAddress(request.headers['x-real-ip'])
    return this.proxyIps.has(peer)&&isIP(real)?real:peer||'unknown'
  }
  seedMac(slug,value){return createHmac('sha256',this.seedKey).update(slug+':'+value).digest('base64url')}
  seed(slug){const value=token()+'.'+(Date.now()+SEED_AGE*1000);return value+'.'+this.seedMac(slug,value)}
  verifySeed(slug,value){
    const [key,expiry,signature]=String(value||'').split('.')
    if(!signature||Number(expiry)<=Date.now())return null
    return timingSafeEqual(Buffer.from(signature),Buffer.from(this.seedMac(slug,key+'.'+expiry)))?key:null
  }
  site(slug) {
    const site = this.db.prepare("SELECT s.* FROM support_sites s JOIN customers c ON c.id=s.customer_id WHERE s.slug=? AND s.enabled=1 AND c.status='ACTIVE'").get(slug)
    if (!site) fail('该客服入口暂未开放',404)
    return site
  }
  listSites() {
    return this.db.prepare(`SELECT s.slug,s.customer_id,s.title,s.privacy_url,s.agent_username,s.blocked_domains,s.enabled,c.name AS customer_name,c.status AS customer_status
      FROM support_sites s JOIN customers c ON c.id=s.customer_id ORDER BY s.created_at DESC,s.slug`).all()
      .map(site => ({ ...site, blocked_domains:JSON.parse(site.blocked_domains), enabled:Boolean(site.enabled), aiCheck:this.moderation.siteEnabled(site.slug), aiRawInput:false }))
  }
  saveSite(slug,input,actor) {
    const current = slug && this.db.prepare('SELECT * FROM support_sites WHERE slug=?').get(slug)
    if (slug && !current) fail('客服站点不存在',404)
    slug ||= identifier(input.slug,'站点编号').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)) fail('站点编号须为 2–48 位小写字母、数字或短横线')
    const title = text(input.title,'客服站点名称',60)
    const customerId = current?.customer_id || identifier(input.customerId,'客户编号')
    const customer = this.db.prepare('SELECT status FROM customers WHERE id=?').get(customerId)
    if (!customer) fail('客户不存在',404)
    if (typeof input.enabled!=='boolean') fail('请指定站点状态')
    if (input.enabled && customer.status!=='ACTIVE') fail('客户未启用，不能开放客服站点',409)
    const url = privacyLink(input.privacyUrl)
    const username = identifier(input.agentUsername,'客服账号')
    const password = input.password ?? ''
    if ((!current || password!=='') && (typeof password!=='string' || password.length<16 || password.length>128 || !password.trim())) fail('客服密码须为 16–128 个字符')
    const encoded = password ? passwordHash(password) : current.password_hash
    const domains = input.blockedDomains ?? ''
    if (typeof domains!=='string' || domains.length>4000) fail('拦截域名格式不正确')
    const denied = [...new Set(domains.split(/[\s,，]+/u).filter(Boolean).map(value=>domainName(value,'拦截域名').replace(/^\*\./,'')))]
    if (denied.length>30) fail('最多配置 30 个拦截域名')
    if (input.aiCheck!==undefined&&typeof input.aiCheck!=='boolean')fail('站点 AI 开关无效')
    if (input.aiRawInput!==undefined&&input.aiRawInput!==false)fail('AI 检查仅支持脱敏文本')
    return this.store.transaction(() => {
      if (current) {
        this.db.prepare('UPDATE support_sites SET title=?,privacy_url=?,agent_username=?,password_hash=?,blocked_domains=?,enabled=? WHERE slug=?').run(title,url,username,encoded,JSON.stringify(denied),Number(input.enabled),slug)
        if (password || username!==current.agent_username || !input.enabled) this.db.prepare('DELETE FROM support_agent_sessions WHERE slug=?').run(slug)
      } else this.db.prepare('INSERT INTO support_sites VALUES (?,?,?,?,?,?,?,?,?)').run(slug,customerId,title,url,username,encoded,JSON.stringify(denied),Number(input.enabled),now())
      if(input.aiCheck!==undefined)this.moderation.setSite(slug,input.aiCheck)
      if(!input.enabled)this.db.prepare('DELETE FROM support_ai_jobs WHERE slug=?').run(slug)
      this.store.audit(actor,current?'UPDATE_SUPPORT_SITE':'CREATE_SUPPORT_SITE',slug,{ customerId,enabled:input.enabled })
      return { slug }
    })
  }
  owner(route,method,body,query,actor,json,response) {
    if (route==='/api/support-admin/moderation' && method==='GET') return json(this.moderation.summary())
    if (route==='/api/support-admin/moderation' && method==='PUT') return json(this.moderation.save(body,actor))
    if (route==='/api/support-admin/moderation/test' && method==='POST') {
      this.rate('support-ai-test:'+actor,4)
      return this.moderation.test().then(json)
    }
    if (route==='/api/support-admin/sites' && method==='GET') return json({ sites:this.listSites() })
    if (route==='/api/support-admin/sites' && method==='POST') return json(this.saveSite(null,body,actor),201)
    let match = /^\/api\/support-admin\/sites\/([a-z0-9-]+)$/.exec(route)
    if (match && method==='PUT') return json(this.saveSite(match[1],body,actor))
    match=/^\/api\/support-admin\/sites\/([a-z0-9-]+)\/conversations(?:\/(\d+)(?:\/files\/(\d+))?)?$/.exec(route)
    if(match&&method==='GET'){
      const [,slug,conversationId,fileId]=match
      if(!conversationId)return json(this.history(slug,query))
      const row=this.conversation(slug,idNumber(conversationId))
      if(fileId){
        const id=idNumber(fileId)
        return this.download(response,slug,id,row.id,()=>this.store.audit(actor,'DOWNLOAD_SUPPORT_ATTACHMENT',String(row.id),{slug,messageId:id}))
      }
      const messages=this.messages(row.id,query)
      const hasOlder=messages.length>0&&Boolean(this.db.prepare('SELECT 1 FROM support_messages WHERE conversation_id=? AND id<? LIMIT 1').get(row.id,messages[0].id))
      this.store.audit(actor,'VIEW_SUPPORT_CONVERSATION',String(row.id),{slug})
      return json({id:row.id,status:row.status,created_at:row.created_at,updated_at:row.updated_at,messages,hasOlder})
    }
    if (route==='/api/support-admin/alerts' && method==='GET') {
      const status = query.get('status') || 'OPEN'
      if (!['OPEN','CONFIRMED','DISMISSED'].includes(status)) fail('告警状态无效')
      const before = query.has('before') ? idNumber(query.get('before')) : Number.MAX_SAFE_INTEGER
      const alerts = this.db.prepare(`SELECT a.id,c.slug,s.title AS site_title,c.id AS conversation_id,a.code,a.reason,a.status,a.created_at,a.resolved_at
        FROM support_alerts a JOIN support_conversations c ON c.id=a.conversation_id JOIN support_sites s ON s.slug=c.slug
        WHERE a.status=? AND a.id<? ORDER BY a.id DESC LIMIT 51`).all(status,before)
      return json({ alerts:alerts.slice(0,50),hasMore:alerts.length>50 })
    }
    match = /^\/api\/support-admin\/alerts\/(\d+)$/.exec(route)
    if (match && method==='GET') return json(this.store.transaction(()=>{
      const alert = this.db.prepare('SELECT id,excerpt,resolution,status FROM support_alerts WHERE id=?').get(idNumber(match[1]))
      if (!alert) fail('告警不存在',404)
      this.store.audit(actor,'VIEW_SUPPORT_ALERT',String(alert.id))
      return alert
    }))
    if (match && method==='PUT') return json(this.store.transaction(()=>{
      const id = idNumber(match[1])
      if (!['CONFIRMED','DISMISSED'].includes(body.status)) fail('处置结果无效')
      const note = text(body.resolution,'复核说明',300)
      const result = this.db.prepare("UPDATE support_alerts SET status=?,resolution=?,resolved_at=? WHERE id=? AND status='OPEN'").run(body.status,note,now(),id)
      if (!result.changes) fail('告警已处置或不存在',409)
      this.store.audit(actor,'RESOLVE_SUPPORT_ALERT',String(id),{ status:body.status })
      return { ok:true }
    }))
    fail('接口不存在',404)
  }
  visitor(slug,value) {
    return value ? this.db.prepare('SELECT * FROM support_conversations WHERE slug=? AND visitor_hash=? AND visitor_expires>?').get(slug,hash(value),Date.now()) : null
  }
  agent(slug,value) {
    return value && this.db.prepare('SELECT 1 FROM support_agent_sessions WHERE slug=? AND token_hash=? AND expires_at>?').get(slug,hash(value),Date.now())
  }
  conversation(slug,id) {
    const row = this.db.prepare('SELECT * FROM support_conversations WHERE slug=? AND id=?').get(slug,id)
    if (!row) fail('会话不存在',404)
    return row
  }
  history(slug,query){
    if(!this.db.prepare('SELECT 1 FROM support_sites WHERE slug=?').get(slug))fail('客服站点不存在',404)
    const status=query.get('status')||'CLOSED'
    if(!['OPEN','CLOSED','ALL'].includes(status))fail('会话状态无效')
    const before=query.has('before')?idNumber(query.get('before')):Number.MAX_SAFE_INTEGER
    const id=query.has('id')?idNumber(query.get('id')):null
    const filters=['slug=?','id<?'], params=[slug,before]
    if(status!=='ALL'){filters.push('status=?');params.push(status)}
    if(id!==null){filters.push('id=?');params.push(id)}
    const rows=this.db.prepare('SELECT id,status,created_at,updated_at FROM support_conversations WHERE '+filters.join(' AND ')+' ORDER BY id DESC LIMIT 51').all(...params)
    return {conversations:rows.slice(0,50),hasMore:rows.length>50}
  }
  messages(id,query) {
    const columns = 'id,sender,content,file_name,file_size,created_at'
    if (query.has('after')) {
      const after = query.get('after')
      return this.db.prepare('SELECT '+columns+' FROM support_messages WHERE conversation_id=? AND id>? ORDER BY id LIMIT 100').all(id,after==='0'?0:idNumber(after))
    }
    const before = query.has('before') ? idNumber(query.get('before')) : Number.MAX_SAFE_INTEGER
    return this.db.prepare('SELECT '+columns+' FROM support_messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT 100').all(id,before).reverse()
  }
  alert(id,message,code,reason,excerpt) {
    const result=this.db.prepare('INSERT OR IGNORE INTO support_alerts(conversation_id,message_id,code,reason,excerpt,created_at) VALUES(?,?,?,?,?,?)')
      .run(id,message,code,reason,redactSupportExcerpt(excerpt),now())
    if(result.changes)this.moderation.notice(Number(result.lastInsertRowid),code)
  }
  append(site,conversation,role,content,attachment,key,seed) {
    const fingerprint=key?hash(JSON.stringify(attachment?[attachment.name,hash(attachment.bytes)]:[content])):null
    if(key&&conversation){
      const previous=this.db.prepare('SELECT fingerprint,message_id FROM support_message_requests WHERE conversation_id=? AND sender=? AND request_key=?').get(conversation.id,role,key)
      if(previous){
        if(previous.fingerprint!==fingerprint)fail('此发送编号已用于其他内容',409)
        return {conversationId:conversation.id,id:previous.message_id}
      }
    }
    if (conversation?.status==='CLOSED') fail('该会话已结束',409)
    const risk = role==='agent' && !attachment && supportRisk(content,JSON.parse(site.blocked_domains))
    if (risk?.blocked) {
      const cutoff = new Date(Date.now()-60000).toISOString()
      const exists = this.db.prepare('SELECT 1 FROM support_alerts WHERE conversation_id=? AND code=? AND created_at>?').get(conversation.id,risk.code,cutoff)
      if (!exists) this.alert(conversation.id,null,risk.code,risk.reason,content)
      fail('链接域名不符合本站规则，消息未发送',422)
    }
    return this.store.transaction(()=>{
      const at = now()
      let credential
      if (!conversation) {
        credential=seed||token()
        const result=this.db.prepare('INSERT INTO support_conversations(slug,visitor_hash,visitor_expires,created_at,updated_at) VALUES(?,?,?,?,?)')
          .run(site.slug,hash(credential),Date.now()+VISITOR_AGE*1000,at,at)
        conversation={ id:Number(result.lastInsertRowid) }
      }
      if (attachment) {
        const used=this.db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM support_files WHERE slug=?').get(site.slug).bytes
        if (used+attachment.bytes.length>QUOTA) fail('本站附件容量已满，请联系管理员',507)
      }
      const result=this.db.prepare('INSERT INTO support_messages(conversation_id,sender,content,file_name,file_size,created_at) VALUES(?,?,?,?,?,?)')
        .run(conversation.id,role,content,attachment?.name ?? null,attachment?.bytes.length ?? null,at)
      const id=Number(result.lastInsertRowid)
      if (attachment) this.db.prepare('INSERT INTO support_files VALUES (?,?,?,?)').run(id,site.slug,attachment.bytes.length,attachment.bytes)
      if(key)this.db.prepare('INSERT INTO support_message_requests VALUES (?,?,?,?,?)').run(conversation.id,role,key,fingerprint,id)
      this.db.prepare('UPDATE support_conversations SET updated_at=?,last_message=?,last_visitor_message=CASE WHEN ? THEN ? ELSE last_visitor_message END WHERE id=?')
        .run(at,id,role==='visitor'?1:0,id,conversation.id)
      if (risk) this.alert(conversation.id,id,risk.code,risk.reason,content)
      if (role==='agent'&&!attachment) this.moderation.enqueue(id,site.slug)
      return { credential,conversationId:conversation.id,id }
    })
  }
  async readAttachment(request) {
    if (Number(request.headers['content-length'])>MAX_FILE) fail('附件最多 10 MB',413)
    if (request.headers['content-type']!=='application/octet-stream') fail('附件请求格式无效',415)
    let name
    try { name=decodeURIComponent(String(request.headers['x-support-filename']||'')) } catch { fail('文件名无效') }
    name=text(name,'文件名',150).replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g,'_')
    if (this.uploads>=3) fail('上传任务较多，请稍后重试',429)
    this.uploads++
    const deadline=setTimeout(()=>request.destroy(),30000)
    try {
      const chunks=[]
      let size=0
      for await (const chunk of request.iterator({destroyOnReturn:false})) {
        size+=chunk.length
        if (size>MAX_FILE) { request.resume(); fail('附件最多 10 MB',413) }
        chunks.push(chunk)
      }
      if (!size) fail('附件不能为空')
      const bytes=Buffer.concat(chunks,size)
      fileType(name,bytes)
      return {name,bytes}
    } finally { clearTimeout(deadline);this.uploads-- }
  }
  download(response,slug,id,conversationId,beforeSend) {
    const row=this.db.prepare(`SELECT m.file_name,m.file_size,f.content FROM support_files f
      JOIN support_messages m ON m.id=f.message_id WHERE f.slug=? AND f.message_id=? AND m.conversation_id=?`).get(slug,id,conversationId)
    if (!row) fail('附件不存在',404)
    const name=encodeURIComponent(row.file_name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))
    beforeSend?.()
    response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':String(row.file_size),
      'Content-Disposition':"attachment; filename=\"attachment"+(/\.[a-z0-9]{1,5}$/i.exec(row.file_name)?.[0]||'')+"\"; filename*=UTF-8''"+name,
      'Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"sandbox; default-src 'none'"})
    response.end(row.content)
  }
  async handle(request,response,url,body,json,secureCookie) {
    const parts=/^\/api\/support\/([a-z0-9][a-z0-9-]{1,47})\/(.+)$/.exec(url.pathname)
    if (!parts) fail('接口不存在',404)
    const [,slug,action]=parts
    const method=request.method
    const site=this.site(slug)
    const ip=this.ip(request)
    const rawVisitor=cookie(request,'support_visitor',visitorPattern)
    const seed=this.verifySeed(slug,rawVisitor)
    const visitorToken=seed||(rawVisitor?.length===43?rawVisitor:null)
    const agentToken=cookie(request,'support_agent')
    const setCookie=(name,value,maxAge)=>response.setHeader('Set-Cookie',name+'='+value+'; Path=/api/support/'+slug+'/; Max-Age='+maxAge+'; HttpOnly; SameSite=Strict'+(secureCookie?'; Secure':''))
    if (method!=='GET' && request.headers['x-support-request']!=='1') fail('请求校验失败',403)
    if (action==='site' && method==='GET') {
      const aiCheck=Boolean(this.moderation.config().enabled&&this.moderation.siteEnabled(slug))
      return json({title:site.title,privacyUrl:site.privacy_url,attachmentLimit:MAX_FILE,aiCheck,aiRawInput:false})
    }
    if (action==='agent/login' && method==='POST') {
      this.rate('login-ip:'+ip,8)
      this.rate('login-site:'+slug,40)
      if (typeof body.password!=='string' || body.password.length>128 || body.username!==site.agent_username || !checkPassword(body.password,site.password_hash)) fail('账号或密码不正确',401)
      const value=token()
      this.db.prepare('DELETE FROM support_agent_sessions WHERE expires_at<=?').run(Date.now())
      if (agentToken) this.db.prepare('DELETE FROM support_agent_sessions WHERE slug=? AND token_hash=?').run(slug,hash(agentToken))
      this.db.prepare('INSERT INTO support_agent_sessions VALUES (?,?,?)').run(hash(value),slug,Date.now()+AGENT_AGE*1000)
      setCookie('support_agent',value,AGENT_AGE)
      return json({authenticated:true})
    }
    if (action==='agent/session' && method==='GET') return json({authenticated:Boolean(this.agent(slug,agentToken))})
    if (action.startsWith('agent/')) {
      if (!this.agent(slug,agentToken)) fail('请先登录客服工作台',401)
      if (method==='POST') this.rate('agent-write:'+slug,120)
      if (action==='agent/logout' && method==='POST') {
        this.db.prepare('DELETE FROM support_agent_sessions WHERE slug=? AND token_hash=?').run(slug,hash(agentToken))
        setCookie('support_agent','',0)
        return json({ok:true})
      }
      if (action==='agent/conversations' && method==='GET') {
        const status=url.searchParams.get('status')||'OPEN'
        if (!['OPEN','CLOSED'].includes(status)) fail('会话状态无效')
        const page=url.searchParams.has('page')?idNumber(url.searchParams.get('page')):1
        if (page>10000) fail('页码超出范围')
        const rows=this.db.prepare(`SELECT id,status,created_at,updated_at,last_message,last_visitor_message>agent_read AS unread
          FROM support_conversations WHERE slug=? AND status=? ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?`).all(slug,status,(page-1)*50)
        return json({conversations:rows.slice(0,50),hasMore:rows.length>50})
      }
      const match=/^agent\/conversations\/(\d+)\/(messages|attachment|close|read|files\/(\d+))$/.exec(action)
      if (!match) fail('接口不存在',404)
      const conversation=this.conversation(slug,idNumber(match[1]))
      if (match[2]==='messages' && method==='GET') return json({status:conversation.status,messages:this.messages(conversation.id,url.searchParams)})
      if (match[2]==='messages' && method==='POST') return json(this.append(site,conversation,'agent',text(body.content,'消息',4000),null,requestKey(request)),201)
      if (match[2]==='attachment' && method==='POST') {
        const key=requestKey(request)
        const attachment=await this.readAttachment(request)
        const current=this.site(slug)
        if (!this.agent(slug,agentToken)) fail('客服登录已失效',401)
        return json(this.append(current,this.conversation(slug,conversation.id),'agent','',attachment,key),201)
      }
      if (match[2]==='close' && method==='POST') {
        this.db.prepare("UPDATE support_conversations SET status='CLOSED',updated_at=? WHERE id=? AND status='OPEN'").run(now(),conversation.id)
        return json({status:'CLOSED'})
      }
      if (match[2]==='read' && method==='POST') {
        const through=Math.min(idNumber(body.through),conversation.last_visitor_message)
        this.db.prepare('UPDATE support_conversations SET agent_read=MAX(agent_read,?) WHERE id=?').run(through,conversation.id)
        return json({ok:true})
      }
      if (match[3] && method==='GET') return this.download(response,slug,idNumber(match[3]),conversation.id)
      fail('接口不存在',404)
    }
    const visitor=this.visitor(slug,visitorToken)
    if (action==='messages' && method==='GET') {
      if(url.searchParams.get('prepare')==='1'&&!visitor&&(!seed||this.db.prepare('SELECT 1 FROM support_conversations WHERE visitor_hash=?').get(hash(seed))))setCookie('support_visitor',this.seed(slug),SEED_AGE)
      const reported=visitor&&this.db.prepare("SELECT 1 FROM support_alerts WHERE conversation_id=? AND code='visitor_report'").get(visitor.id)
      return json(visitor ? {id:visitor.id,status:visitor.status,reported:Boolean(reported),messages:this.messages(visitor.id,url.searchParams)} : {id:null,status:null,messages:[]})
    }
    if (method==='POST') this.rate(visitor?'visitor:'+visitor.id:'start:'+slug+':'+ip,35)
    if (action==='reset' && method==='POST') {
      if (visitor && visitor.status!=='CLOSED') fail('当前会话仍在进行中',409)
      setCookie('support_visitor',this.seed(slug),SEED_AGE)
      return json({ok:true})
    }
    if (action==='report' && method==='POST') {
      if (!visitor) fail('会话不存在',404)
      this.store.transaction(()=>this.alert(visitor.id,null,'visitor_report','访客举报该会话',text(body.reason,'举报原因',300)))
      return json({ok:true})
    }
    if ((action==='messages'||action==='attachment') && method==='POST') {
      const key=requestKey(request)
      if (!visitor&&rawVisitor&&(!seed||this.db.prepare('SELECT 1 FROM support_conversations WHERE visitor_hash=?').get(hash(seed)))) {
        setCookie('support_visitor',this.seed(slug),SEED_AGE)
        fail('原会话已过期，请重试以开启新会话',409)
      }
      if(key&&!visitorToken)fail('请刷新页面后重试',409)
      const attachment=action==='attachment'?await this.readAttachment(request):null
      const latest=this.visitor(slug,visitorToken)
      if (visitor && !latest) fail('原会话已过期',409)
      const result=this.append(this.site(slug),latest,'visitor',attachment?'':text(body.content,'消息',4000),attachment,key,seed)
      if (result.credential||seed) setCookie('support_visitor',result.credential||seed,VISITOR_AGE)
      return json({conversationId:result.conversationId,id:result.id},201)
    }
    const file=/^files\/(\d+)$/.exec(action)
    if (file && method==='GET' && visitor) return this.download(response,slug,idNumber(file[1]),visitor.id)
    fail('接口不存在',404)
  }
}
