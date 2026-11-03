import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID,createHash,verify} from 'node:crypto'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'
import {Releases} from '../server/releases.mjs'

const decode=envelope=>JSON.parse(Buffer.from(envelope.payload,'base64url'))
function setup(){
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Isolated-regression-password-2026'})
  store.createCustomer({id:'test',name:'隔离客户'},'test')
  const project=store.management.saveProject(null,{customerId:'test',productId:'detla',name:'回归项目',maintenanceUntil:'2032-01-01T00:00:00Z'},'test').id
  const instance=randomUUID();store.createInstance({id:instance,customerId:'test',projectId:project,name:'隔离实例',domains:['client.example.com','*.client.example.com']},'test')
  return {store,project,instance,identity:store.management.identity(instance,'test')}
}

test('client reports use the local catalog without invoking external release checks',async()=>{
  const f=setup();let external=0
  f.store.releaseService.sync=()=>{external++;return new Promise(()=>{})}
  const server=createAuthorityServer(f.store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/client/report`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({license:f.identity,version:'1.4.0'}),signal:AbortSignal.timeout(1000)})
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.accepted,true);assert.equal(external,0)
    assert(verify(null,Buffer.from(result.project.format+'.'+result.project.payload),f.store.publicKey,Buffer.from(result.project.signature,'base64url')))
    assert.deepEqual(decode(result.project).allowedDomains,['client.example.com','*.client.example.com'])
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.store.close()}
})

test('failed GitHub checks back off while manual checks can retry immediately',async()=>{
  const f=setup();let calls=0
  const service=new Releases(f.store,{fetcher:async()=>{calls++;return new Response('{}',{status:503})}})
  try{await assert.rejects(service.sync('detla'));assert.equal((await service.sync('detla')).cached,true);assert.equal(calls,1);await assert.rejects(service.sync('detla',true));assert.equal(calls,2)}finally{f.store.close()}
})

test('project renewal retains disabled payment configuration while signed claims exclude disabled methods',()=>{
  const {store,project,instance}=setup()
  try{
    // Disposable fixture configuration: no payment adapter or real credentials.
    const fields=JSON.parse(store.db.prepare("SELECT config_schema FROM payment_providers WHERE id='wechat_pay'").get().config_schema)
    const config=Object.fromEntries(fields.filter(field=>field.required||field.requiredFor?.includes('H5')).map(field=>[field.key,field.key==='notifyUrl'?'https://client.example.com/notify':field.key==='apiV3Key'?'12345678901234567890123456789012':'fixture-only']))
    store.management.savePaymentProvider('wechat_pay',{enabled:true,config,methods:['H5','JSAPI']},'test')
    store.management.saveProject(project,{name:'回归项目',maintenanceUntil:'2032-01-01T00:00:00Z',paymentProvider:'wechat_pay',paymentMethods:['H5','JSAPI']},'test')
    store.management.savePaymentProvider('wechat_pay',{enabled:true,config:{},methods:['H5']},'test')
    assert.deepEqual(decode(store.management.clientResponse(instance,'1.4.0').project).payment,{provider:'wechat_pay',methods:['H5']})
    store.management.savePaymentProvider('wechat_pay',{enabled:false,config:{},methods:['H5']},'test')
    store.management.saveProject(project,{name:'已续期',maintenanceUntil:'2033-01-01T00:00:00Z',paymentProvider:'wechat_pay',paymentMethods:['H5','JSAPI']},'test')
    const claims=decode(store.management.clientResponse(instance,'1.4.0').project)
    assert.equal(claims.maintenanceUntil,'2033-01-01T00:00:00.000Z');assert.equal(claims.payment,null)
    assert.deepEqual(JSON.parse(store.db.prepare('SELECT payment_methods FROM projects WHERE id=?').get(project).payment_methods),['H5','JSAPI'])
  }finally{store.close()}
})

test('commercial history prevents modules moving between products and update items reject foreign modules',()=>{
  const {store,instance}=setup()
  try{
    store.management.saveProduct(null,{id:'other',name:'其他软件',kind:'WEB',repository:'fixture/other'},'test')
    store.updateModule('advanced_income_reports',{priceCents:100,status:'ACTIVE'},'test')
    store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'test')
    assert.throws(()=>store.updateModule('advanced_income_reports',{productId:'other'},'test'),/不能更换/)
    assert.throws(()=>store.releaseService.create({productId:'other',version:'1.4.1',channel:'stable',notes:'fixture',sourceUrl:'https://github.com/fixture/other/releases/tag/v1.4.1',items:[{id:'foreign',name:'跨软件',component:'admin',featureId:'advanced_income_reports'}]},'test'),/不属于当前软件/)
  }finally{store.close()}
})

test('HTTP update selection, reverse-proxy public notes, CSRF and artifact download form one isolated workflow',async()=>{
  const f=setup(),{store,identity}=f,bytes=Buffer.from('isolated-update-package'),digest=createHash('sha256').update(bytes).digest('hex')
  const release=store.releaseService
  release.create({version:'1.4.1',channel:'stable',notes:'正式发布 https://github.com/fixture/private',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.4.1',items:[{id:'security',name:'安全修复',component:'backend',required:true},{id:'admin',name:'管理界面',component:'admin',requires:['security']},{id:'optional',name:'可选内容',component:'h5'}]},'test')
  release.publish('detla','1.4.1','test')
  store.db.prepare('UPDATE release_catalog SET assets=?').run(JSON.stringify(['backend','admin','h5'].map((component,index)=>({id:index+1,name:`cangshuo-${component}.zip`,url:`https://github.com/zhz520/cangshuo-detla/releases/download/v1.4.1/cangshuo-${component}.zip`,size:bytes.length,digest:'sha256:'+digest}))))
  let downloads=0;release.fetcher=async()=>{downloads++;return new Response(bytes,{headers:{'Content-Type':'application/zip'}})}
  const server=createAuthorityServer(store,{allowedOrigins:['https://authority.example.com']});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
  try{
    assert.equal((await fetch(base+'/api/data')).status,401)
    assert.equal((await post('/api/client/report',{license:{...identity,signature:'invalid'},version:'1.4.0'})).status,401)
    assert.equal(downloads,0)
    const login=await post('/api/login',{username:'owner',password:'Isolated-regression-password-2026'},{Origin:'https://authority.example.com'})
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],session=await login.json()
    assert.equal((await post('/api/customers',{id:'denied',name:'denied'},{Cookie:cookie,Origin:'https://authority.example.com'})).status,403)
    assert.equal((await post('/api/customers',{id:'denied',name:'denied'},{Cookie:cookie,'X-CSRF-Token':session.csrf,Origin:'https://evil.example.com'})).status,403)
    const reportResponse=await post('/api/client/report',{license:identity,version:'1.4.0'},{'X-Forwarded-Host':'authority.example.com','X-Forwarded-Proto':'https'})
    const report=await reportResponse.json();assert.equal(reportResponse.status,200)
    assert.equal(report.updates.releases[0].sourceUrl,'https://authority.example.com/public/release-notes/detla/1.4.1')
    assert.doesNotMatch(JSON.stringify(report.updates),/github\.com/i)
    const notes=await fetch(base+'/public/release-notes/detla/1.4.1');assert.equal(notes.status,200);assert.doesNotMatch(await notes.text(),/github\.com/i)
    const response=await post('/api/client/update-plan',{license:identity,version:'1.4.0',selection:['1.4.1:admin']});assert.equal(response.status,200)
    const plan=await response.json(),claims=decode(plan);assert.deepEqual(claims.items.map(item=>item.id),['security','admin']);assert.equal(claims.packages.length,2)
    assert.equal((await post('/api/client/update-plan',{license:identity,version:'1.4.0',selection:['1.4.1:missing']})).status,400)
    assert.equal((await post('/api/client/artifact',{plan:{...plan,signature:'invalid'},component:'admin'})).status,401);assert.equal(downloads,0)
    const artifact=await post('/api/client/artifact',{plan,component:'admin'});assert.equal(artifact.status,200);assert.deepEqual(Buffer.from(await artifact.arrayBuffer()),bytes);assert.equal(downloads,1)
    store.management.saveProject(f.project,{name:'过期项目',maintenanceUntil:'2020-01-01T00:00:00Z'},'test')
    assert.equal((await post('/api/client/update-plan',{license:identity,version:'1.4.0',selection:['1.4.1:admin']})).status,403)
    assert.equal((await post('/api/client/artifact',{plan,component:'admin'})).status,403);assert.equal(downloads,1)
    assert.equal((await post('/api/client/report',{license:identity,version:'1.4.0'})).status,200)
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close()}
})
