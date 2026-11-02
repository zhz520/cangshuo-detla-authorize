import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AuthorityStore, compareVersions } from '../server/store.mjs'
import { createAuthorityServer } from '../server/http.mjs'

const ownerPassword = 'Test-only-operator-password-2026'
function fixture(){const keys=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});const store=new AuthorityStore({database:':memory:',privateKey:keys.privateKey,ownerUsername:'owner',ownerPassword});return {store,keys}}
function instance(store,version='1.1.0'){
  store.createCustomer({id:'interop742',name:'集成测试客户'},'owner')
  const id=randomUUID();store.createInstance({id,customerId:'interop742',name:'隔离测试实例',clientVersion:version,domains:['jaxapi.kkimg.top','jax.kkimg.top'],maintenanceUntil:new Date(Date.now()+400*86400000).toISOString()},'owner');return id
}
function moduleReady(store){store.updateModule('advanced_income_reports',{priceCents:9900,termDays:365,status:'ACTIVE'},'owner')}

test('orders require a configured price, a compatible instance and payment before signing',()=>{
 const {store}=fixture();try{const id=instance(store)
 assert.throws(()=>store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner'),/定价/)
 moduleReady(store);const order=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner')
 assert.throws(()=>store.issue(order.id,'owner'),/已收款或维护期接入/)
 assert.throws(()=>store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner'),/待收款/)
 store.markPaid(order.id,{reference:'仅测试，不涉及真实收款'},'owner');const issued=store.issue(order.id,'owner')
 const claims=JSON.parse(Buffer.from(issued.envelope.payload,'base64url'))
 assert.equal(claims.customerId,'interop742');assert.equal(claims.instanceId,id);assert.deepEqual(claims.features,['advanced_income_reports'])
 assert.deepEqual(claims.allowedDomains,['jaxapi.kkimg.top','jax.kkimg.top'])
 assert.equal(claims.expiresAt,store.lists().instances[0].maintenance_until)
 assert.equal(claims.featureExpiresAt.advanced_income_reports,store.lists().orders.find(row=>row.id===order.id).valid_until)
 assert.equal(claims.featureStartsAt,undefined)
 const response=store.management.clientResponse(id,'1.1.0'),project=JSON.parse(Buffer.from(response.project.payload,'base64url')),responseClaims=JSON.parse(Buffer.from(response.license.payload,'base64url'))
 assert.equal(project.featureStartsAt.advanced_income_reports,store.listEntitlements().find(row=>row.instance_id===id).valid_from)
 assert.equal(project.featureExpiresAt.advanced_income_reports,store.listEntitlements().find(row=>row.instance_id===id).valid_until)
 assert.equal(project.licenseId,responseClaims.licenseId)
 assert(verify(null,Buffer.from('delta-license-v1.'+issued.envelope.payload),store.publicKey,Buffer.from(issued.envelope.signature,'base64url')))
 assert.deepEqual(store.issue(order.id,'owner'),issued);assert.equal(store.lists().licenses.length,1)
 const altered={...claims,customerId:'other'};assert(!verify(null,Buffer.from('delta-license-v1.'+Buffer.from(JSON.stringify(altered)).toString('base64url')),store.publicKey,Buffer.from(issued.envelope.signature,'base64url')))
 if(process.env.AUTHORITY_INTEROP_DIR){const directory=path.resolve(process.env.AUTHORITY_INTEROP_DIR);if(process.platform==='win32')assert(/^D:\\/i.test(directory));mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'authority-interop.json'),JSON.stringify(issued.envelope,null,2));writeFileSync(path.join(directory,'authority-interop.public.txt'),store.publicKey)}
 }finally{store.close()}
})
test('renewals retain price and entitlement expiry snapshots under the maintenance cap',()=>{
 const {store}=fixture();try{const id=instance(store);moduleReady(store);const order=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.updateModule('advanced_income_reports',{priceCents:19900,termDays:30,status:'ACTIVE'},'owner');assert.equal(store.lists().orders[0].amount_cents,9900)
 store.markPaid(order.id,{reference:'test'},'owner');const initial=JSON.parse(Buffer.from(store.issue(order.id,'owner').envelope.payload,'base64url'))
 const next=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.markPaid(next.id,{reference:'renewal-test'},'owner');const renewed=store.issue(next.id,'owner'),claims=JSON.parse(Buffer.from(renewed.envelope.payload,'base64url'))
 assert.equal(claims.expiresAt,initial.expiresAt);assert.equal(claims.featureExpiresAt.advanced_income_reports,store.lists().orders.find(row=>row.id===next.id).valid_until)
 const old=store.lists().instances[0];store.updateInstance(id,{name:old.name,domains:old.domains,clientVersion:old.client_version,maintenanceUntil:new Date(Date.parse(old.maintenance_until)+30*86400000).toISOString()},'owner')
 assert.deepEqual(store.issue(next.id,'owner'),renewed)
 const later=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.markPaid(later.id,{reference:'extension'},'owner');const extended=JSON.parse(Buffer.from(store.issue(later.id,'owner').envelope.payload,'base64url'));assert.equal(Date.parse(extended.expiresAt)-Date.parse(initial.expiresAt),30*86400000);assert.equal(extended.featureExpiresAt.advanced_income_reports,store.lists().orders.find(row=>row.id===later.id).valid_until)
 assert.equal(store.lists().audit.filter(row=>row.action==='ISSUE_LICENSE').length,3)
 }finally{store.close()}
})
test('older client versions, invalid prices and unsafe release links are rejected',()=>{
 const {store}=fixture();try{const id=instance(store);store.db.prepare("UPDATE instances SET client_version='1.0.0' WHERE id=?").run(id);moduleReady(store)
 assert.throws(()=>store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner'),/先升级/)
 assert.throws(()=>store.updateModule('advanced_income_reports',{priceCents:-1,termDays:30,status:'ACTIVE'},'owner'),/价格/)
 assert.throws(()=>store.updateModule('advanced_income_reports',{priceCents:0.1,termDays:30,status:'ACTIVE'},'owner'),/整数/)
 assert.throws(()=>store.createRelease({version:'1.0.0',channel:'stable',notes:'test',sourceUrl:'javascript:alert(1)'},'owner'),/客户端仓库/)
 const body={version:'1.1.0',channel:'stable',notes:'仅发布目录，不执行安装',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.1.0'}
 store.createRelease(body,'owner');assert.equal(store.publishedReleases().length,0);store.publishRelease(body.version,'owner');assert.equal(store.publishedReleases().length,1)
 assert(compareVersions('1.10.0','1.9.0')>0);assert(compareVersions('1.1.0-preview.10','1.1.0-preview.2')>0);assert(compareVersions('1.1.0','1.1.0-preview.2')>0)
 }finally{store.close()}
})
test('licenses are bound to allowed domains and the maintenance expiry',()=>{
 const {store}=fixture();try{const id=instance(store);moduleReady(store)
 const row=store.lists().instances[0];assert.deepEqual(row.domains,['jaxapi.kkimg.top','jax.kkimg.top']);assert(Date.parse(row.maintenance_until)>Date.now())
 assert.throws(()=>store.updateInstance(id,{name:'新版客户端',clientVersion:'1.1.0-preview.2',domains:['https://jaxapi.kkimg.top/path'],maintenanceUntil:row.maintenance_until},'owner'),/域名/)
 store.updateInstance(id,{name:'新版客户端',clientVersion:'1.1.0-preview.3',domains:['*.kkimg.top'],maintenanceUntil:new Date(Date.now()+500*86400000).toISOString()},'owner')
 const order=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.markPaid(order.id,{reference:'test'},'owner');const claims=JSON.parse(Buffer.from(store.issue(order.id,'owner').envelope.payload,'base64url'))
 assert.deepEqual(claims.allowedDomains,['*.kkimg.top']);assert.equal(claims.expiresAt,store.lists().instances[0].maintenance_until)
 }finally{store.close()}
})
test('maintenance activation is recorded without pretending it was an online payment',()=>{
 const {store}=fixture();try{const id=instance(store);moduleReady(store);const order=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.grantMaintenance(order.id,{note:'年度维护已经续签，未走在线收款'},'owner');const row=store.lists().orders.find(item=>item.id===order.id);assert.equal(row.status,'MAINTENANCE');assert.equal(row.paid_at,null);assert.match(row.payment_reference,/未走在线收款/);assert(store.issue(order.id,'owner').envelope.signature)
 }finally{store.close()}
})
test('customers support query, update and guarded delete',()=>{
 const {store}=fixture();try{
  store.createCustomer({id:'crud',name:'原名称',note:'初始备注'},'owner')
  assert.equal(store.lists().customers.find(row=>row.id==='crud').name,'原名称')
  store.updateCustomer('crud',{name:'新名称',status:'DISABLED',note:'暂停合作'},'owner')
  let row=store.lists().customers.find(row=>row.id==='crud');assert.equal(row.name,'新名称');assert.equal(row.status,'DISABLED');assert.equal(row.note,'暂停合作')
  const project=store.management.saveProject(null,{customerId:'crud',productId:'detla',name:'关联项目',maintenanceUntil:'2028-01-01T00:00:00Z'},'owner').id
  assert.throws(()=>store.deleteCustomer('crud','owner'),/关联项目或实例/)
  store.db.prepare('DELETE FROM projects WHERE id=?').run(project);store.deleteCustomer('crud','owner');assert.equal(store.lists().customers.some(row=>row.id==='crud'),false)
 }finally{store.close()}
})
test('a valid signed client report updates its version and last-seen time',()=>{
 const {store}=fixture();try{const id=instance(store);moduleReady(store);const order=store.createOrder({instanceId:id,moduleId:'advanced_income_reports'},'owner');store.grantMaintenance(order.id,{note:'test'},'owner');const license=store.issue(order.id,'owner').envelope
 const report=store.reportVersion(license,'1.1.0-preview.2');assert.equal(report.instanceId,id);let row=store.lists().instances.find(item=>item.id===id);assert.equal(row.client_version,'1.1.0-preview.2');assert(row.last_seen_at)
 assert.throws(()=>store.reportVersion({...license,signature:(license.signature[0]==='A'?'B':'A')+license.signature.slice(1)},'9.9.9'),/签名无效|授权内容无效/)
 }finally{store.close()}
})
test('legacy instance plugin records are not exposed as the payment configuration model',()=>{
 const {store}=fixture();try{instance(store);const data=store.lists();assert.equal(data.plugins,undefined);assert.equal(data.instancePlugins,undefined);assert(data.paymentProviders.some(provider=>provider.id==='wechat_pay'))}
 finally{store.close()}
})
test('sessions are hashed, unauthorized access and CSRF and cross-origin writes are rejected',async()=>{
 const {store}=fixture();const server=createAuthorityServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 try{
  assert.equal((await fetch(base+'/api/data')).status,401)
  let result=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:ownerPassword})});assert.equal(result.status,200)
  const cookie=result.headers.get('set-cookie').split(';')[0],session=await result.json();assert(result.headers.get('set-cookie').includes('HttpOnly'));assert(!JSON.stringify(store.db.prepare('SELECT * FROM sessions').all()).includes(cookie.split('=')[1]))
  result=await fetch(base+'/api/customers',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({id:'742',name:'test'})});assert.equal(result.status,403)
  result=await fetch(base+'/api/customers',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf,Origin:'https://untrusted.example'},body:'{}'});assert.equal(result.status,403)
  result=await fetch(base+'/api/customers',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf},body:JSON.stringify({id:'742',name:'test'})});assert.equal(result.status,201)
  result=await fetch(base+'/api/customers/742',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf},body:JSON.stringify({name:'updated',note:'note',status:'DISABLED'})});assert.equal(result.status,200)
  result=await fetch(base+'/api/customers/742',{method:'DELETE',headers:{Cookie:cookie,'X-CSRF-Token':session.csrf}});assert.equal(result.status,200)
  assert.equal((await fetch(base+'/api/public-key')).status,401)
  result=await fetch(base+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf},body:'{}'});assert.equal(result.status,200)
  assert.equal((await fetch(base+'/api/data',{headers:{Cookie:cookie}})).status,401)
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
})
test('login attempts are limited and internal errors do not disclose signing material',async()=>{
 const {store}=fixture(),server=createAuthorityServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 try{for(let i=0;i<5;i++){const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'unknown'+i,password:'wrong'})});assert.equal(response.status,401)}
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:ownerPassword})})).status,429)
 assert(!JSON.stringify(store.lists()).includes('PRIVATE KEY'))
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
})
test('trusted public origin works behind a reverse proxy that rewrites Host',async()=>{
 const {store}=fixture(),server=createAuthorityServer(store,{allowedOrigins:['https://auth.kk520yy.com']});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 try{
  const body=JSON.stringify({username:'owner',password:ownerPassword})
  let response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Host:'127.0.0.1',Origin:'https://auth.kk520yy.com'},body});assert.equal(response.status,200)
  response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Host:'127.0.0.1',Origin:'https://untrusted.example'},body});assert.equal(response.status,403)
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
})
