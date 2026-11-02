import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID} from 'node:crypto'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

test('operations HTTP routes support a complete isolated customer/project/license workflow',async()=>{
 const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
 const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'HTTP-test-only-password-2026'})
 const server=createAuthorityServer(store,{staticDirectory:new URL('../dist/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base='http://127.0.0.1:'+server.address().port;let cookie='',csrf='';const checked=[]
 async function call(route,method='GET',body,expected=200){const response=await fetch(base+route,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,expected,method+' '+route+': '+JSON.stringify(result));checked.push(method+' '+route);return {result,response}}
 try{
  await call('/health');await call('/api/session');await call('/api/data','GET',undefined,401)
  const login=await call('/api/login','POST',{username:'owner',password:'HTTP-test-only-password-2026'});cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=login.result.csrf
  await call('/api/data');await call('/api/public-key')
  await call('/api/customers','POST',{id:'http-customer',name:'接口测试'},201)
  await call('/api/customers/http-customer','PUT',{name:'更新名称',note:'隔离测试',status:'ACTIVE'})
  await call('/api/products','POST',{id:'other',name:'其他网站',kind:'WEB'},201)
  await call('/api/products/other','PUT',{name:'其他网站',kind:'WEB',repository:'owner/other'})
  const project=(await call('/api/projects','POST',{customerId:'http-customer',productId:'other',name:'独立项目',maintenanceUntil:'2030-12-01T00:00:00Z'},201)).result.id
  await call('/api/projects/'+project,'PUT',{name:'独立项目',maintenanceUntil:'2031-12-01T00:00:00Z',depositAmountCents:10000,balanceAmountCents:20000})
  const id=randomUUID();await call('/api/instances','POST',{id,customerId:'http-customer',projectId:project,name:'接口实例',domains:['http.example.com']},201)
  await call('/api/instances/'+id,'PUT',{name:'接口实例',domains:['http.example.com'],maintenanceUntil:'2031-12-01T00:00:00Z'})
  const identity=(await call('/api/instances/'+id+'/identity')).result
  await call('/api/client/report','POST',{license:identity,version:'1.2.0'})
  await call('/api/modules','POST',{id:'http_module',productId:'other',name:'测试功能',description:'接口测试',minVersion:'1.2.0'},201)
  await call('/api/modules/http_module','PUT',{priceCents:100,termDays:365,status:'ACTIVE'})
  const order=(await call('/api/orders','POST',{instanceId:id,moduleId:'http_module'},201)).result
  await call('/api/orders/'+order.id+'/paid','POST',{reference:'isolated-test'})
  const license=(await call('/api/orders/'+order.id+'/issue','POST',{})).result
  await call('/api/licenses/'+license.id)
  await call('/api/payments/wechat_pay','PUT',{enabled:false,methods:['H5'],config:{}})
  await call('/api/mail/settings','PUT',{enabled:true,host:'smtp.example.com',port:465,security:'TLS',username:'operator@example.com',password:'TEST-ONLY-NOT-REAL',from:'operator@example.com',operatorEmail:'operator@example.com'})
  await call('/api/mail/test','POST',{recipient:'recipient@example.com'})
  const mail=store.lists().mailQueue.find(row=>row.event==='TEST');store.db.prepare("UPDATE mail_queue SET status='FAILED' WHERE id=?").run(mail.id)
  await call('/api/mail/'+mail.id+'/retry','POST',{})
  await call('/api/releases','POST',{productId:'other',version:'2.0.0',channel:'stable',notes:'其他软件更新',sourceUrl:'https://github.com/owner/other/releases/tag/v2.0.0'},201)
  await call('/api/products/other/releases/2.0.0/items','PUT',{items:[{id:'other_backend',name:'修复接口',component:'backend',required:true}]})
  await call('/api/releases/2.0.0/publish','POST',{productId:'other'})
  assert.equal(store.db.prepare("SELECT status FROM release_catalog WHERE product_id='other' AND version='2.0.0'").get().status,'PUBLISHED')
  await call('/public/releases')
  await call('/api/releases','POST',{version:'2.0.0',channel:'stable',notes:'invalid link',sourceUrl:'not-url'},400)
  await call('/api/customers/http-customer','DELETE',undefined,409)
  await call('/api/no-such-route','GET',undefined,404)
  await call('/api/client/update-plan','POST',{license:identity,version:'1.2.0',selection:[]},400)
  await call('/api/client/artifact','POST',{},401)
  await call('/api/logout','POST',{});await call('/api/data','GET',undefined,401)
  assert(checked.length>=30)
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
})
