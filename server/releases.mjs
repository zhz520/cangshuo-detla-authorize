import { compareVersions, fail, text } from './store.mjs'
import { DEFAULT_PRODUCT, stamp, publicReleaseText } from './management.mjs'
import { randomUUID,verify } from 'node:crypto'

export function releaseItems(value) {
  if (!Array.isArray(value) || value.length>100) fail('版本更新项格式不正确')
  const ids=new Set()
  const items=value.map(item=>{
    if (!item || !/^[a-z][a-z0-9_-]{0,63}$/.test(item.id) || ids.has(item.id)) fail('更新项编号重复或格式不正确')
    ids.add(item.id)
    if (!['backend','admin','h5'].includes(item.component)) fail('更新组件不正确')
    if (!Array.isArray(item.requires||[]) || (item.requires||[]).some(id=>typeof id!=='string')) fail('更新依赖格式不正确')
    if (item.featureId && !/^[a-z][a-z0-9_]{0,63}$/.test(item.featureId)) fail('付费模块编号不正确')
    return {id:item.id,name:text(item.name,'更新项名称',100),description:String(item.description||'').slice(0,1000),component:item.component,required:item.required===true,requires:item.requires||[],featureId:item.featureId||null}
  })
  const visited=new Set(), visiting=new Set()
  function visit(id) { if (visiting.has(id)) fail('更新项依赖存在循环'); if (visited.has(id)) return; const item=items.find(item=>item.id===id); if (!item) fail('更新项依赖不存在'); visiting.add(id); item.requires.forEach(visit); visiting.delete(id);visited.add(id) }
  items.forEach(item=>visit(item.id))
  return items
}
export class Releases {
  constructor(store,{fetcher=fetch,token=process.env.GITHUB_TOKEN}={}) { this.store=store;this.db=store.db;this.fetcher=fetcher;this.token=token;this.running=new Map();this.failedAt=new Map() }
  validateFeatures(productId,items) {
    for(const item of items)if(item.featureId&&!this.db.prepare('SELECT 1 FROM modules WHERE id=? AND product_id=?').get(item.featureId,productId))fail('更新项引用的付费模块不存在或不属于当前软件')
    return items
  }
  product(id=DEFAULT_PRODUCT) { const row=this.db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!row)fail('软件不存在',404);return row }
  create(body,actor) {
    const product=this.product(body.productId),version=text(body.version,'版本号',80);compareVersions(version,version)
    if (body.channel!=='stable' || version.includes('-')) fail('只允许发布 GitHub 正式版')
    if(!product.repository)fail('请先为该软件关联 GitHub 仓库')
    const notes=text(body.notes,'更新说明',20000);let url
    try{url=new URL(body.sourceUrl)}catch{fail('请填写有效的 GitHub Release 地址')}
    if (url.origin!=='https://github.com'||url.pathname!==`/${product.repository}/releases/tag/v${version}`||url.username||url.password||url.search||url.hash) fail('请选择当前软件客户端仓库中的 GitHub Release 地址')
    const items=this.validateFeatures(product.id,releaseItems(body.items||[]))
    this.db.prepare('INSERT INTO release_catalog(product_id,version,channel,notes,source_url,status,created_at,items) VALUES (?,?,?,?,?,?,?,?)').run(product.id,version,'stable',notes,url.href,'DRAFT',stamp(),JSON.stringify(items))
    this.store.audit(actor,'CREATE_RELEASE_DRAFT',product.id+':'+version);return {version,productId:product.id}
  }
  publish(productId,version,actor) {
    const row=this.db.prepare('SELECT * FROM release_catalog WHERE product_id=? AND version=?').get(productId,version)
    if (!row) fail('版本不存在',404)
    if (row.channel!=='stable'||version.includes('-')) fail('请选择正式版本')
    if (row.status!=='PUBLISHED') {
      this.db.prepare("UPDATE release_catalog SET status='PUBLISHED',published_at=? WHERE product_id=? AND version=?").run(stamp(),productId,version)
      this.notify(productId,version);this.store.audit(actor,'PUBLISH_RELEASE_METADATA',productId+':'+version)
    }
    return {productId,version}
  }
  notify(productId,version) {
    const operatorKey=`release:${productId}:${version}`
    for (const project of this.db.prepare('SELECT id FROM projects WHERE product_id=?').all(productId)) this.store.management.queueProjectMail(project.id,'RELEASE',`release:${productId}:${version}:${project.id}`,'软件正式版本发布',`软件已发布正式版 ${version}。请在客户端系统更新页面比较版本并选择更新内容。`,{operatorKey})
  }
  async sync(productId=DEFAULT_PRODUCT,force=false) {
    if (this.running.has(productId)) return this.running.get(productId)
    const product=this.product(productId)
    if (!product.repository) fail('该软件未关联 GitHub 仓库，无需检查正式版',409)
    if (!force && Date.now()-(this.failedAt.get(productId)||0)<60000) return {cached:true,...this.store.management.clientUpdates(productId,'0.0.0')}
    if (!force && product.checked_at && Date.now()-Date.parse(product.checked_at)<15*60000) return {cached:true,...this.store.management.clientUpdates(productId,'0.0.0')}
    const task=this.fetchReleases(product).then(result=>{this.failedAt.delete(productId);return result},error=>{this.failedAt.set(productId,Date.now());throw error}).finally(()=>this.running.delete(productId));this.running.set(productId,task);return task
  }
  async fetchReleases(product) {
    try {
      const collected=[]
      const signal=AbortSignal.timeout(25000)
      for(let page=1;page<=20;page++) {
        const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Cangshuo-Authority'}
        const token=this.db.prepare('SELECT token FROM github_tokens WHERE product_id=?').get(product.id)?.token || this.token
        if(token)headers.Authorization='Bearer '+token
        const response=await this.fetcher(`https://api.github.com/repos/${product.repository}/releases?per_page=100&page=${page}`,{headers,signal,redirect:'error'})
        if(!response.ok)fail(response.status===404?'GitHub 仓库不可读取：私有仓库请在“软件与仓库”配置只读令牌。':`GitHub 版本检查失败（HTTP ${response.status}）`,502)
        const rows=await response.json();if(!Array.isArray(rows))fail('GitHub 返回的版本目录无效',502)
        for(const row of rows) {
          const version=String(row.tag_name||'').replace(/^v/,'')
          if(row.draft||row.prerelease||!/^\d+\.\d+\.\d+$/.test(version))continue
          compareVersions(version,version)
          if (row.html_url!==`https://github.com/${product.repository}/releases/tag/${row.tag_name}`) continue
          const assets=(row.assets||[]).filter(asset=>asset.browser_download_url?.startsWith(`https://github.com/${product.repository}/releases/download/`)).map(asset=>({id:asset.id,name:asset.name,url:asset.browser_download_url,size:asset.size,digest:asset.digest||null}))
          collected.push({version,notes:String(row.body||row.name||version).slice(0,20000),url:row.html_url,publishedAt:row.published_at,assets})
        }
        if(rows.length<100)break
        if(page===20)fail('版本目录超过 2000 条，请联系维护人员归档',502)
      }
      this.store.transaction(()=>{
        for(const row of collected) {
          const previous=this.db.prepare('SELECT status FROM release_catalog WHERE product_id=? AND version=?').get(product.id,row.version)
          this.db.prepare("INSERT INTO release_catalog(product_id,version,channel,notes,source_url,status,created_at,published_at,assets,origin) VALUES (?,?,'stable',?,?,'PUBLISHED',?,?,?,'GITHUB') ON CONFLICT(product_id,version) DO UPDATE SET notes=excluded.notes,source_url=excluded.source_url,status='PUBLISHED',published_at=excluded.published_at,assets=excluded.assets,origin='GITHUB'").run(product.id,row.version,row.notes,row.url,stamp(),row.publishedAt,JSON.stringify(row.assets))
          if(previous?.status!=='PUBLISHED')this.notify(product.id,row.version)
        }
        this.db.prepare('UPDATE products SET checked_at=?,check_error=NULL WHERE id=?').run(stamp(),product.id)
      })
      return {count:collected.length,...this.store.management.clientUpdates(product.id,'0.0.0')}
    } catch(error) { this.db.prepare('UPDATE products SET check_error=? WHERE id=?').run(error.status?error.message:'GitHub 连接暂不可用，保留上次成功检查结果',product.id);throw error }
  }
  configureItems(productId,version,body,actor) {
    const items=this.validateFeatures(productId,releaseItems(body.items))
    const result=this.db.prepare('UPDATE release_catalog SET items=? WHERE product_id=? AND version=?').run(JSON.stringify(items),productId,version)
    if(!result.changes)fail('版本不存在',404)
    this.store.audit(actor,'UPDATE_RELEASE_ITEMS',productId+':'+version,{items:items.map(item=>item.id)})
    return {items}
  }
  publicNotes(productId,version) {
    const row=this.db.prepare("SELECT version,notes,published_at,items FROM release_catalog WHERE product_id=? AND version=? AND status='PUBLISHED' AND channel='stable'").get(productId,version)
    if(!row)fail('发布说明不存在',404)
    return {...row,notes:publicReleaseText(row.notes),items:JSON.parse(row.items).map(item=>({...item,description:publicReleaseText(item.description)}))}
  }
  plan(body) {
    const report=this.store.reportVersion(body.license,body.version), claims=JSON.parse(Buffer.from(report.project.payload,'base64url'))
    if(claims.status!=='ACTIVE'||Date.parse(claims.maintenanceUntil)<=Date.now())fail('项目维护期已到期或已暂停，请先续期',403)
    const selection=body.selection
    if(!Array.isArray(selection)||!selection.length||selection.length>500||selection.some(key=>typeof key!=='string'))fail('请选择更新内容')
    const available=report.updates.releases, chosen=new Set(selection)
    const entries=available.flatMap(release=>release.items.map(item=>({...item,version:release.version,key:release.version+':'+item.id})))
    if(selection.some(key=>!entries.some(item=>item.key===key)))fail('包含未知或不适用于当前版本的更新内容')
    const target=entries.filter(item=>chosen.has(item.key)).sort((a,b)=>compareVersions(b.version,a.version))[0].version
    for(const item of entries)if(item.required&&compareVersions(item.version,target)<=0)chosen.add(item.key)
    let changed=true
    while(changed) {
      changed=false
      for(const item of entries.filter(item=>chosen.has(item.key))) {
        for(const dependency of item.requires) {const key=item.version+':'+dependency;if(!chosen.has(key)){chosen.add(key);changed=true}}
      }
    }
    const final=entries.filter(item=>chosen.has(item.key)), packages=[]
    for(const component of new Set(final.map(item=>item.component))) {
      const version=final.filter(item=>item.component===component).sort((a,b)=>compareVersions(b.version,a.version))[0].version
      if(body.componentVersions?.[component] && compareVersions(body.componentVersions[component],version)>=0)continue
      const catalog=this.db.prepare('SELECT assets FROM release_catalog WHERE product_id=? AND version=?').get(claims.productId,version)
      if(!catalog)fail(`${version} 的正式版本目录不存在`,409)
      const asset=JSON.parse(catalog.assets||'[]').find(asset=>asset.name===`cangshuo-${component}.zip`)
      if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))fail(`${version} 的 ${component} 尚未提供带校验值的正式更新包`,409)
      if(asset.size<=0||asset.size>500_000_000)fail('更新包大小不正确')
      packages.push({component,version,url:asset.url,downloadPath:'/api/client/artifact',sha256:asset.digest.slice(7),size:asset.size})
    }
    const entitlements=this.store.activeEntitlements(claims.instanceId).map(row=>row.module_id)
    for(const item of final)if(item.featureId&&!entitlements.includes(item.featureId))fail(`更新内容「${item.name}」需要先购买相应功能`,403)
    if(!packages.length)fail('所选内容已安装，无需重复更新',409)
    const plan={id:randomUUID(),customerId:claims.customerId,projectId:claims.projectId,instanceId:claims.instanceId,productId:claims.productId,issuedAt:stamp(),expiresAt:new Date(Math.min(Date.now()+15*60000,Date.parse(claims.maintenanceUntil))).toISOString(),fromVersion:body.version,targetVersion:target,schemaVersion:1,items:final,packages}
    if(Buffer.byteLength(JSON.stringify(plan))>30000)fail('一次选择的更新内容过多，请分批更新',413)
    this.store.audit('client','CREATE_UPDATE_PLAN',plan.id,{instanceId:claims.instanceId,targetVersion:target,selection:[...chosen]})
    return this.store.management.signed('cangshuo-update-v1',plan)
  }
  async artifact(body) {
    const envelope=body.plan
    if(envelope?.format!=='cangshuo-update-v1'||typeof envelope.payload!=='string'||envelope.payload.length>1_500_000||typeof envelope.signature!=='string'||envelope.signature.length>128)fail('更新计划无效',401)
    if(!verify(null,Buffer.from(envelope.format+'.'+envelope.payload),this.store.publicKey,Buffer.from(envelope.signature,'base64url')))fail('更新计划签名无效',401)
    let plan;try{plan=JSON.parse(Buffer.from(envelope.payload,'base64url'))}catch{fail('更新计划格式无效',401)}
    const instance=this.db.prepare('SELECT i.customer_id,i.project_id,p.product_id,p.status,p.maintenance_until FROM instances i JOIN projects p ON p.id=i.project_id WHERE i.id=?').get(plan.instanceId)
    if(!instance||instance.customer_id!==plan.customerId||instance.project_id!==plan.projectId||instance.product_id!==plan.productId||instance.status!=='ACTIVE'||Date.parse(instance.maintenance_until)<=Date.now()||Date.parse(plan.expiresAt)<=Date.now())fail('更新计划已过期或项目暂停',403)
    const packageInfo=plan.packages?.find(item=>item.component===body.component);if(!packageInfo)fail('更新组件不存在')
    const product=this.product(plan.productId),release=this.db.prepare('SELECT assets FROM release_catalog WHERE product_id=? AND version=?').get(product.id,packageInfo.version)
    const asset=JSON.parse(release?.assets||'[]').find(item=>item.url===packageInfo.url&&item.digest==='sha256:'+packageInfo.sha256)
    if(!asset?.id||!Number.isSafeInteger(asset.id))fail('正式更新包元数据不完整，请重新同步 GitHub',409)
    const token=this.db.prepare('SELECT token FROM github_tokens WHERE product_id=?').get(product.id)?.token||this.token
    const headers={Accept:'application/octet-stream','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Cangshuo-Authority'};if(token)headers.Authorization='Bearer '+token
    const result=await this.fetcher(`https://api.github.com/repos/${product.repository}/releases/assets/${asset.id}`,{headers,signal:AbortSignal.timeout(300000)})
    if(!result.ok||!['application/octet-stream','application/zip','application/x-zip-compressed'].some(type=>result.headers.get('content-type')?.startsWith(type)))fail('GitHub 更新包无法下载，请检查只读令牌权限',502)
    return {result,size:packageInfo.size}
  }
}
