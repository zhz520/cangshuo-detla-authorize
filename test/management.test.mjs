import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID,verify,createHash} from 'node:crypto'
import {AuthorityStore} from '../server/store.mjs'
import {Releases,releaseItems} from '../server/releases.mjs'
import {Mailer} from '../server/mail.mjs'

function setup(){
 const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
 const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Only-a-test-password-2026'})
 store.createCustomer({id:'a',name:'客户A'},'owner');store.createCustomer({id:'b',name:'客户B'},'owner')
 const project=store.management.saveProject(null,{customerId:'a',productId:'detla',name:'项目A',maintenanceUntil:'2028-12-01T00:00:00Z',notificationEmail:'customer@example.com'},'owner').id
 const instance=randomUUID();store.createInstance({id:instance,customerId:'a',projectId:project,name:'实例A',domains:['a.example.com']},'owner')
 return {store,project,instance,close:()=>store.close()}
}
test('projects isolate products, repositories and customer instances',()=>{
 const f=setup(),{store}=f;try{
  store.management.saveProduct(null,{id:'shop',name:'商城',kind:'MINIAPP',repository:'owner/shop'},'owner')
  const project=store.management.saveProject(null,{customerId:'b',productId:'shop',name:'商城项目',maintenanceUntil:'2029-01-01T00:00:00Z'},'owner').id
  assert.throws(()=>store.createInstance({id:randomUUID(),customerId:'a',projectId:project,name:'越权',domains:['a.example.com']},'owner'),/不匹配/)
  assert.throws(()=>store.releaseService.create({productId:'shop',version:'1.0.0',channel:'stable',notes:'说明',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.0.0'},'owner'),/客户端仓库/)
  assert.equal(store.lists().plugins,undefined)
  const identity=store.management.identity(f.instance,'owner');assert.equal(store.reportVersion(identity,'1.0.0').instanceId,f.instance)
 }finally{f.close()}
})
test('maintenance renewal synchronizes all project instances and reissues matching licenses',()=>{
 const f=setup(),{store,project,instance}=f;try{
  store.updateModule('advanced_income_reports',{priceCents:100,termDays:365,status:'ACTIVE'},'owner')
  const order=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner');store.grantMaintenance(order.id,{note:'test'},'owner');const first=store.issue(order.id,'owner').envelope
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',pausePolicy:'STOP_ALL'},'owner')
  const report=store.reportVersion(first,'1.1.0'), claims=JSON.parse(Buffer.from(report.license.payload,'base64url')), projectClaims=JSON.parse(Buffer.from(report.project.payload,'base64url'))
  assert.equal(claims.expiresAt,'2029-01-01T00:00:00.000Z');assert.equal(claims.expiresAt,projectClaims.maintenanceUntil)
  assert(verify(null,Buffer.from(report.license.format+'.'+report.license.payload),store.publicKey,Buffer.from(report.license.signature,'base64url')))
  assert.equal(store.reportVersion(first,'1.1.0').license.payload,report.license.payload)
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2020-01-01T00:00:00Z',pausePolicy:'STOP_ALL'},'owner')
  assert.equal(store.lists().projects[0].effective_status,'EXPIRED')
  assert.equal(JSON.parse(Buffer.from(store.reportVersion(first,'1.1.0').project.payload,'base64url')).maintenanceUntil,'2020-01-01T00:00:00.000Z')
 }finally{f.close()}
})
test('GitHub sync excludes previews and compares every higher semantic version for the correct product',async()=>{
 const f=setup(),{store}=f;try{
  const release=(version,prerelease=false)=>({tag_name:'v'+version,body:'test',html_url:'https://github.com/zhz520/cangshuo-detla/releases/tag/v'+version,published_at:'2026-10-31T00:00:00Z',prerelease,assets:[]})
  const service=new Releases(store,{fetcher:async()=>new Response(JSON.stringify([release('1.1.0'),release('1.10.0'),release('1.2.0'),release('2.0.0-preview.1',true)]))})
  await service.sync('detla',true);const result=store.management.clientUpdates('detla','1.1.0')
  assert.deepEqual(result.releases.map(row=>row.version),['1.2.0','1.10.0']);assert.equal(result.latestVersion,'1.10.0');assert.equal(result.updateAvailable,true)
  const unavailable=new Releases(store,{fetcher:async()=>new Response('{}',{status:503})});await assert.rejects(unavailable.sync('detla',true));assert.equal(store.management.clientUpdates('detla','1.1.0').latestVersion,'1.10.0')
 }finally{f.close()}
})
test('SMTP credentials are masked and failed notification delivery is retried without leaking secrets',async()=>{
 const f=setup(),{store}=f;try{
  store.management.saveMailSettings({enabled:true,host:'smtp.example.com',port:465,security:'TLS',username:'sender@example.com',password:'fake-secret',from:'sender@example.com',operatorEmail:'ops@example.com'},'owner')
  assert(!JSON.stringify(store.lists()).includes('fake-secret'))
  const mailer=new Mailer(store,{transportFactory:()=>({sendMail:async()=>{throw Object.assign(new Error('sensitive fake-secret'),{code:'EAUTH'})}})})
  mailer.test({recipient:'recipient@example.com'},'owner');await mailer.process();let row=store.lists().mailQueue[0];assert.equal(row.status,'RETRY');assert.equal(row.attempts,1);assert.equal(row.last_error,'EAUTH')
  mailer.retry(row.id,'owner');mailer.factory=()=>({sendMail:async()=>({accepted:['recipient@example.com'],rejected:[]})});await mailer.process();row=store.lists().mailQueue[0];assert.equal(row.status,'SENT')
  store.management.saveMailSettings({...store.management.mailSettings(),password:''},'owner');assert.equal(store.management.mailSettings(true).password,'fake-secret')
 }finally{f.close()}
})
test('expiry reminders are deduplicated and do not send to other customers',()=>{
 const f=setup(),{store,project,instance}=f;try{
  const at=Date.parse('2028-11-24T12:00:00Z');store.management.scheduleNotifications(at);store.management.scheduleNotifications(at)
  const rows=store.lists().mailQueue;assert.equal(rows.length,1);assert.equal(rows[0].recipient,'customer@example.com');assert.equal(rows[0].project_id,project)
 }finally{f.close()}
})
test('update plans lock required dependencies, validate packages and reject unpaid modules',()=>{
 const f=setup(),{store,instance}=f;try{
  const identity=store.management.identity(instance,'owner')
  store.releaseService.create({version:'1.2.0',channel:'stable',notes:'test',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.2.0',items:[{id:'security',name:'安全修复',component:'backend',required:true},{id:'admin_ui',name:'后台更新',component:'admin',requires:['security']},{id:'reports',name:'可选报表',component:'admin'}]},'owner')
  store.releaseService.publish('detla','1.2.0','owner')
  assert.throws(()=>store.releaseService.plan({license:identity,version:'1.1.0',selection:['1.2.0:admin_ui']}),/校验值/)
  const assets=['backend','admin'].map(component=>({name:`cangshuo-${component}.zip`,url:`https://github.com/zhz520/cangshuo-detla/releases/download/v1.2.0/cangshuo-${component}.zip`,size:100,digest:'sha256:'+'a'.repeat(64)}))
  store.db.prepare('UPDATE release_catalog SET assets=?').run(JSON.stringify(assets))
  let plan=store.releaseService.plan({license:identity,version:'1.1.0',selection:['1.2.0:admin_ui']});let claims=JSON.parse(Buffer.from(plan.payload,'base64url'));assert.equal(claims.packages.length,2);assert.deepEqual(claims.items.map(item=>item.id),['security','admin_ui']);assert(!claims.items.some(item=>item.id==='reports'))
  store.releaseService.configureItems('detla','1.2.0',{items:[{id:'paid',name:'付费模块',component:'admin',featureId:'advanced_income_reports'}]},'owner')
  assert.throws(()=>store.releaseService.plan({license:identity,version:'1.1.0',selection:['1.2.0:paid']}),/购买/)
  assert.throws(()=>releaseItems([{id:'a',name:'A',component:'backend',requires:['b']},{id:'b',name:'B',component:'backend',requires:['a']}]),/循环/)
 }finally{f.close()}
})
test('private repository token stays in the authority and artifact access requires a valid active plan',async()=>{
 const f=setup(),{store,instance,project}=f;try{
  const token='github_pat_'+ 'test'.repeat(15),bytes=Buffer.from('test-zip-content'),digest='sha256:'+createHash('sha256').update(bytes).digest('hex')
  store.management.saveProduct('detla',{name:'电竞业务系统',kind:'WEB',repository:'zhz520/cangshuo-detla',githubToken:token},'owner')
  assert(!JSON.stringify(store.lists()).includes(token));assert.equal(store.lists().products[0].token_configured,1)
  let downloads=0
  const service=new Releases(store,{fetcher:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer '+token)
    if(url.includes('/releases/assets/')){downloads++;return new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}})}
    return new Response(JSON.stringify([{tag_name:'v1.2.0',html_url:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.2.0',body:'test',published_at:'2026-11-01T00:00:00Z',assets:[{id:17,name:'cangshuo-admin.zip',browser_download_url:'https://github.com/zhz520/cangshuo-detla/releases/download/v1.2.0/cangshuo-admin.zip',size:bytes.length,digest}]}]))
  }})
  await service.sync('detla',true);service.configureItems('detla','1.2.0',{items:[{id:'admin',name:'后台',component:'admin'}]},'owner')
  const plan=service.plan({license:store.management.identity(instance,'owner'),version:'1.1.0',selection:['1.2.0:admin']})
  assert(!JSON.stringify(plan).includes(token));const response=await service.artifact({plan,component:'admin'});assert.deepEqual(Buffer.from(await response.result.arrayBuffer()),bytes);assert.equal(downloads,1)
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2020-01-01T00:00:00Z',pausePolicy:'STOP_ALL'},'owner')
  await assert.rejects(service.artifact({plan,component:'admin'}),/过期或项目暂停/)
 }finally{f.close()}
})
test('payment credentials live in system settings while projects select enabled providers and methods',()=>{
 const f=setup(),{store,project,instance}=f;try{
  let provider=store.management.paymentProviders().find(row=>row.id==='wechat_pay')
  assert.equal(provider.enabled,false);assert.equal(provider.config.apiV3Key,undefined);assert.equal(provider.secretsSet,false)
  assert.throws(()=>store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',paymentProvider:'wechat_pay',paymentMethods:['H5']},'owner'),/先到支付设置启用/)
  const config={appId:'wx-test',merchantId:'1900000109',apiV3Key:'system-secret',merchantSerialNo:'serial',privateKeyPath:'/app/cert/private.pem',publicKeyId:'PUB_KEY_TEST',publicKeyPath:'/app/cert/public.pem',notifyUrl:'https://pay.example.com/api/pay/wx/notify',h5AppName:'Example'}
  store.management.savePaymentProvider('wechat_pay',{enabled:true,methods:['H5','JSAPI'],config},'owner')
  provider=store.management.paymentProviders()[0];assert.equal(provider.enabled,true);assert.equal(provider.config.apiV3Key,'');assert.equal(provider.secretsSet,true);assert(!JSON.stringify(store.lists()).includes('system-secret'))
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',paymentProvider:'wechat_pay',paymentMethods:['H5','JSAPI']},'owner')
  const row=store.lists().projects[0];assert.equal(row.payment_provider,'wechat_pay');assert.deepEqual(row.payment_methods,['H5','JSAPI']);assert.equal(row.payment_provider_name,'微信支付')
  const signedProject=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.2.0').project.payload,'base64url'));assert.deepEqual(signedProject.payment,{provider:'wechat_pay',methods:['H5','JSAPI']})
  store.management.savePaymentProvider('wechat_pay',{enabled:true,methods:['H5','JSAPI'],config:{...provider.config,apiV3Key:''}},'owner');assert.equal(store.management.paymentProviders()[0].config.apiV3Key,'');assert.equal(store.management.paymentProviders()[0].secretsSet,true)
  assert.throws(()=>store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',paymentProvider:'wechat_pay',paymentMethods:['APP']},'owner'),/默认支付方式/)
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',paymentProvider:'',paymentMethods:[]},'owner');assert.equal(store.lists().projects[0].payment_provider,'');assert.deepEqual(store.lists().projects[0].payment_methods,[])
 }finally{f.close()}
})
test('project deposit, balance and collection notes are administrator-only commercial records',()=>{
 const f=setup(),{store,project}=f;try{
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',depositAmountCents:150000,balanceAmountCents:350000,contractNote:'定金已收，尾款验收后支付'},'owner')
  let row=store.lists().projects[0];assert.equal(row.deposit_amount_cents,150000);assert.equal(row.balance_amount_cents,350000);assert.equal(row.contract_total_cents,500000);assert.equal(row.contract_note,'定金已收，尾款验收后支付')
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z'},'owner');row=store.lists().projects[0];assert.equal(row.deposit_amount_cents,150000);assert.equal(row.balance_amount_cents,350000)
  assert.throws(()=>store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',depositAmountCents:-1},'owner'),/项目定金/)
  assert.throws(()=>store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',balanceAmountCents:1.5},'owner'),/项目尾款/)
  store.management.saveProject(project,{name:'项目A',maintenanceUntil:'2029-01-01T00:00:00Z',depositAmountCents:null,balanceAmountCents:null,contractNote:''},'owner');row=store.lists().projects[0];assert.equal(row.deposit_amount_cents,null);assert.equal(row.contract_total_cents,null)
 }finally{f.close()}
})
test('official WeChat notifications are a priced catalog module and module CRUD is guarded by commercial history',()=>{
 const f=setup(),{store,instance}=f;try{
  const item=store.lists().modules.find(row=>row.id==='official_wechat_notifications')
  assert.equal(item.price_cents,10000);assert.equal(item.status,'ACTIVE');assert.equal(item.product_id,'detla')
  const identity=store.lists().modules.find(row=>row.id==='identity_verification')
  assert.equal(identity.price_cents,2000);assert.equal(identity.status,'ACTIVE');assert.equal(identity.min_version,'1.4.0');assert.equal(identity.product_id,'detla')
  store.management.saveModule({id:'temporary_feature',productId:'detla',name:'临时功能',description:'增删改查',minVersion:'1.3.5',priceCents:5000,termDays:365,status:'ACTIVE'},'owner')
  store.updateModule('temporary_feature',{name:'临时功能修改',priceCents:6000,status:'DRAFT'},'owner')
  let row=store.lists().modules.find(item=>item.id==='temporary_feature');assert.equal(row.price_cents,6000);assert.equal(row.name,'临时功能修改')
  store.deleteModule('temporary_feature','owner');assert(!store.lists().modules.some(item=>item.id==='temporary_feature'))
  store.db.prepare("UPDATE instances SET client_version='1.3.5' WHERE id=?").run(instance)
  const order=store.createOrder({instanceId:instance,moduleId:'official_wechat_notifications'},'owner');store.markPaid(order.id,{reference:'official-wechat-test'},'owner');store.issue(order.id,'owner')
  assert.throws(()=>store.deleteModule('official_wechat_notifications','owner'),/订单或授权/)
 }finally{f.close()}
})
test('software registration does not require GitHub while version checks remain optional',async()=>{
 const f=setup(),{store}=f;try{
  store.management.saveProduct(null,{id:'local-tool',name:'本地业务系统',kind:'WEB',repository:''},'owner')
  const product=store.lists().products.find(row=>row.id==='local-tool');assert.equal(product.repository,'');assert.equal(product.check_error,null)
  await assert.rejects(store.releaseService.sync('local-tool',true),/未关联 GitHub/)
  assert.throws(()=>store.management.saveProduct(null,{id:'bad-token',name:'错误配置',kind:'WEB',repository:'',githubToken:'github_pat_'+'a'.repeat(30)},'owner'),/先填写 GitHub 仓库/)
 }finally{f.close()}
})
