import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs'
import path from 'node:path'
import {AuthorityStore} from '../server/store.mjs'

const day=86400000
function fixture(days=100){
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Entitlement-test-password-2026'})
  store.createCustomer({id:'customer',name:'客户'},'owner')
  const maintenanceUntil=new Date(Date.now()+days*day).toISOString()
  const instance=randomUUID()
  store.createInstance({id:instance,customerId:'customer',name:'实例',domains:['entitlement.example.com'],maintenanceUntil},'owner')
  store.updateModule('advanced_income_reports',{priceCents:9900,termDays:30,status:'ACTIVE'},'owner')
  return {store,instance,maintenanceUntil}
}

test('order preview caps added days at maintenance and stores a purchase snapshot',()=>{
  const f=fixture(10),{store,instance,maintenanceUntil}=f
  try{
    const quote=store.orderPreview(instance,'advanced_income_reports')
    assert.equal(quote.priceCents,9900);assert.equal(quote.termDays,30);assert.equal(quote.days,10);assert.equal(quote.addDays,10);assert.equal(quote.totalRemainingDays,10);assert.equal(quote.validUntil,maintenanceUntil);assert.equal(quote.renewal,false);assert(Date.parse(quote.validFrom)<=Date.now())
    const order=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    const row=store.lists().orders.find(item=>item.id===order.id)
    assert.equal(row.valid_until,maintenanceUntil);assert(Date.parse(row.valid_from)<=Date.now())
    store.markPaid(order.id,{reference:'test'},'owner');store.issue(order.id,'owner')
    const grant=store.listEntitlements().find(item=>item.instance_id===instance&&item.module_id==='advanced_income_reports')
    assert.equal(grant.enabled,true);assert.equal(grant.valid_until,maintenanceUntil);assert.equal(grant.status,'ACTIVE')
    assert.throws(()=>store.orderPreview(instance,'advanced_income_reports'),/无可分配的新增权益天数/)
  }finally{store.close()}
})

test('disabled current entitlements are revoked from the license but remain visible in signed project maps',()=>{
  const f=fixture(400),{store,instance}=f
  try{
    for(const moduleId of ['advanced_income_reports','email_notifications']){
      const order=store.createOrder({instanceId:instance,moduleId},'owner');store.markPaid(order.id,{reference:'test'},'owner');store.issue(order.id,'owner')
    }
    const rows=Object.fromEntries(store.listEntitlements().map(row=>[row.module_id,row]))
    store.updateEntitlement(instance,'advanced_income_reports',{enabled:false},'owner')
    const current=store.currentEntitlements(instance)
    assert.deepEqual(current.map(row=>row.module_id),['advanced_income_reports','email_notifications'])
    assert.deepEqual(store.activeEntitlements(instance).map(row=>row.module_id),['email_notifications'])
    const response=store.management.clientResponse(instance,'1.0.0')
    const license=JSON.parse(Buffer.from(response.license.payload,'base64url')),project=JSON.parse(Buffer.from(response.project.payload,'base64url'))
    assert.deepEqual(license.features,['email_notifications']);assert.equal(license.featureExpiresAt.advanced_income_reports,undefined)
    assert.equal(project.featureEnabled.advanced_income_reports,false);assert.equal(project.featureEnabled.email_notifications,true)
    assert.deepEqual(Object.keys(project.featureStartsAt).sort(),['advanced_income_reports','email_notifications'])
    assert.deepEqual(Object.keys(project.featureExpiresAt).sort(),['advanced_income_reports','email_notifications'])
    assert.equal(project.featureStartsAt.advanced_income_reports,rows.advanced_income_reports.valid_from)
    assert.equal(project.featureExpiresAt.advanced_income_reports,rows.advanced_income_reports.valid_until)
    assert.equal(project.license,undefined)
    const priced=store.lists().modules.filter(row=>row.product_id==='detla'&&row.price_cents!=null).map(row=>row.id)
    assert.deepEqual(Object.keys(project.featureEnabled).sort(),priced.sort())
    assert.deepEqual(Object.keys(license).sort(),['allowedDomains','customerId','expiresAt','featureExpiresAt','features','instanceId','issuedAt','licenseId','notBefore'].sort())
    store.updateEntitlement(instance,'advanced_income_reports',{validFrom:new Date(Date.now()-2*day).toISOString(),validUntil:new Date(Date.now()-day).toISOString()},'owner')
    const expiredProject=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'))
    assert.equal(expiredProject.featureStartsAt.advanced_income_reports,undefined);assert.equal(expiredProject.featureExpiresAt.advanced_income_reports,undefined)
  }finally{store.close()}
})

test('renewal is ordered from the current expiry and only extends after payment and issuance',()=>{
  const f=fixture(100),{store,instance}=f
  try{
    const first=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner');store.markPaid(first.id,{reference:'first'},'owner');store.issue(first.id,'owner')
    const original=store.listEntitlements().find(row=>row.instance_id===instance).valid_until
    store.updateEntitlement(instance,'advanced_income_reports',{enabled:false},'owner')
    const quote=store.orderPreview(instance,'advanced_income_reports')
    assert.equal(quote.renewal,true);assert.equal(quote.currentExpiry,original);assert.equal(quote.validFrom,original);assert.equal(quote.days,30);assert.equal(Date.parse(quote.validUntil)-Date.parse(original),30*day)
    const second=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    assert.equal(store.listEntitlements().find(row=>row.instance_id===instance).valid_until,original)
    assert.throws(()=>store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner'),/未完成订单/)
    store.markPaid(second.id,{reference:'second'},'owner');store.issue(second.id,'owner')
    assert.throws(()=>store.cancelOrder(second.id,{reason:'too-late',refundReference:'REF-1'},'owner'),/已签发/)
    const issued=store.listEntitlements().find(row=>row.instance_id===instance)
    assert.equal(Date.parse(issued.valid_until)-Date.parse(original),30*day);assert.equal(issued.enabled,true)
    const project=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'))
    assert.equal(project.featureStartsAt.advanced_income_reports,issued.valid_from);assert.equal(project.featureExpiresAt.advanced_income_reports,issued.valid_until)
  }finally{store.close()}
})

test('unpaid, paid-unissued and maintenance orders all block another order',()=>{
  for(const status of ['UNPAID','PAID','MAINTENANCE']){
    const {store,instance}=fixture(400)
    try{
      const order=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
      if(status==='PAID')store.markPaid(order.id,{reference:'paid'},'owner')
      if(status==='MAINTENANCE')store.grantMaintenance(order.id,{note:'maintenance'},'owner')
      assert.equal(store.lists().orders.find(row=>row.id===order.id).status,status)
      assert.throws(()=>store.orderPreview(instance,'advanced_income_reports'),/未完成订单/)
      assert.throws(()=>store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner'),/未完成订单/)
      assert.equal(store.lists().orders.length,1)
    }finally{store.close()}
  }
})

test('an unpaid order can be cancelled with an audit reason and reordered',()=>{
  const f=fixture(100),{store,instance}=f
  try{
    const first=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    const cancelled=store.cancelOrder(first.id,{reason:'客户取消'},'owner')
    assert.equal(cancelled.status,'CANCELLED')
    const row=store.lists().orders.find(item=>item.id===first.id)
    assert.equal(row.status,'CANCELLED');assert.equal(row.cancel_reason,'客户取消');assert(row.cancelled_at)
    assert.equal(store.lists().audit.find(item=>item.action==='CANCEL_ORDER').target,first.id)
    assert.throws(()=>store.markPaid(first.id,{reference:'should-not-pay'},'owner'),/订单状态不支持确认收款/)
    const second=store.createOrder({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    assert.notEqual(second.id,first.id)
  }finally{store.close()}
})

test('paid and maintenance orders can be cancelled only before issuance with the required evidence',()=>{
  const paid=fixture(20)
  try{
    const order=paid.store.createOrder({instanceId:paid.instance,moduleId:'advanced_income_reports'},'owner')
    paid.store.markPaid(order.id,{reference:'actual-payment'},'owner')
    assert.throws(()=>paid.store.cancelOrder(order.id,{reason:'refund'},'owner'),/退款凭据/)
    const cancelled=paid.store.cancelOrder(order.id,{reason:'报价失效，已原路退款',refundReference:'REFUND-2026-001'},'owner')
    assert.equal(cancelled.status,'CANCELLED')
    const row=paid.store.lists().orders.find(item=>item.id===order.id)
    assert.equal(row.refund_reference,'REFUND-2026-001');assert(row.refunded_at);assert.equal(row.payment_reference,'actual-payment')
    assert.equal(paid.store.lists().audit.find(item=>item.action==='CANCEL_ORDER').detail.includes('PAID'),true)
    paid.store.createOrder({instanceId:paid.instance,moduleId:'advanced_income_reports'},'owner')
  }finally{paid.store.close()}
  const maintenance=fixture(20)
  try{
    const order=maintenance.store.createOrder({instanceId:maintenance.instance,moduleId:'advanced_income_reports'},'owner')
    maintenance.store.grantMaintenance(order.id,{note:'manual-access'},'owner')
    maintenance.store.cancelOrder(order.id,{reason:'接入依据作废'},'owner')
    assert.equal(maintenance.store.lists().orders.find(item=>item.id===order.id).status,'CANCELLED')
  }finally{maintenance.store.close()}
})

test('payment and issuance reject maintenance shrink and expired quotes without shortening',()=>{
  const paid=fixture(20)
  try{
    const order=paid.store.createOrder({instanceId:paid.instance,moduleId:'advanced_income_reports'},'owner')
    paid.store.markPaid(order.id,{reference:'paid'},'owner')
    paid.store.updateInstance(paid.instance,{name:'实例',domains:['entitlement.example.com'],maintenanceUntil:new Date(Date.now()+10*day).toISOString()},'owner')
    assert.throws(()=>paid.store.issue(order.id,'owner'),/维护期已早于订单到期时间/)
    assert.equal(paid.store.listEntitlements().length,0);assert.equal(paid.store.lists().licenses.length,0)
  }finally{paid.store.close()}
  const unpaid=fixture(20)
  try{
    const order=unpaid.store.createOrder({instanceId:unpaid.instance,moduleId:'advanced_income_reports'},'owner')
    unpaid.store.updateInstance(unpaid.instance,{name:'实例',domains:['entitlement.example.com'],maintenanceUntil:new Date(Date.now()+10*day).toISOString()},'owner')
    assert.throws(()=>unpaid.store.markPaid(order.id,{reference:'too-late'},'owner'),/维护期已早于订单到期时间/)
    assert.throws(()=>unpaid.store.grantMaintenance(order.id,{note:'must-not-skip-quote'},'owner'),/维护期已早于订单到期时间/)
    assert.equal(unpaid.store.lists().orders.find(row=>row.id===order.id).status,'UNPAID')
  }finally{unpaid.store.close()}
  const expired=fixture(20)
  try{
    const order=expired.store.createOrder({instanceId:expired.instance,moduleId:'advanced_income_reports'},'owner')
    expired.store.db.prepare('UPDATE orders SET valid_from=?,valid_until=? WHERE id=?').run(new Date(Date.now()-2*day).toISOString(),new Date(Date.now()-day).toISOString(),order.id)
    assert.throws(()=>expired.store.markPaid(order.id,{reference:'expired'},'owner'),/超过到期时间/)
  }finally{expired.store.close()}
})

test('shrinking then restoring maintenance temporarily caps entitlement without losing original expiry',()=>{
  const f=fixture(90),{store,instance}=f
  try{
    const created=store.createEntitlement({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    const original=created.valid_until
    const shorter=new Date(Date.now()+20*day).toISOString()
    store.updateInstance(instance,{name:'实例',domains:['entitlement.example.com'],maintenanceUntil:shorter},'owner')
    const capped=store.listEntitlements().find(row=>row.instance_id===instance)
    assert.equal(capped.original_until,original);assert.equal(capped.valid_until,shorter);assert.equal(capped.effective_until,shorter)
    const toggled=store.updateEntitlement(instance,'advanced_income_reports',{enabled:false},'owner')
    assert.equal(toggled.enabled,false);assert.equal(toggled.original_until,original);assert.equal(toggled.valid_until,shorter)
    const edited=store.updateEntitlement(instance,'advanced_income_reports',{enabled:true,validFrom:created.valid_from,validUntil:original},'owner')
    assert.equal(edited.enabled,true);assert.equal(edited.original_until,original);assert.equal(edited.valid_until,shorter)
    const projectCapped=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'))
    assert.equal(projectCapped.featureExpiresAt.advanced_income_reports,shorter)
    store.updateInstance(instance,{name:'实例',domains:['entitlement.example.com'],maintenanceUntil:original},'owner')
    const restored=store.listEntitlements().find(row=>row.instance_id===instance)
    assert.equal(restored.original_until,original);assert.equal(restored.valid_until,original);assert.equal(restored.effective_until,original)
    const projectRestored=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'))
    assert.equal(projectRestored.featureExpiresAt.advanced_income_reports,original)
  }finally{store.close()}
})

test('entitlement create, update and delete enforce maintenance and expose complete list enrichment',()=>{
  const f=fixture(20),{store,instance,maintenanceUntil}=f
  try{
    const created=store.createEntitlement({instanceId:instance,moduleId:'advanced_income_reports'},'owner')
    assert.equal(created.valid_until,maintenanceUntil);assert.equal(created.customer_name,'客户');assert.equal(created.instance_name,'实例');assert.equal(created.module_name,'收益对比分析');assert.equal(created.term_days,30);assert.equal(typeof created.remaining_days,'number')
    const createdClaims=JSON.parse(Buffer.from(created.license.payload,'base64url'));assert.deepEqual(createdClaims.features,['advanced_income_reports']);assert.equal(createdClaims.featureStartsAt,undefined)
    const createdProject=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'));assert.equal(createdProject.featureStartsAt.advanced_income_reports,created.valid_from);assert.equal(createdProject.featureExpiresAt.advanced_income_reports,created.valid_until)
    assert.throws(()=>store.createEntitlement({instanceId:instance,moduleId:'email_notifications',validFrom:new Date(Date.now()+day).toISOString()},'owner'),/不能晚于当前时间/)
    assert.throws(()=>store.updateEntitlement(instance,'advanced_income_reports',{validUntil:new Date(Date.parse(maintenanceUntil)+day).toISOString()},'owner'),/不能超过项目维护期/)
    const disabled=store.updateEntitlement(instance,'advanced_income_reports',{enabled:false},'owner');assert.equal(disabled.enabled,false);assert.equal(disabled.status,'DISABLED')
    const deleted=store.deleteEntitlement(instance,'advanced_income_reports','owner');assert(deleted.license)
    const emptyClaims=JSON.parse(Buffer.from(deleted.license.payload,'base64url'));assert.deepEqual(emptyClaims.features,['core_platform']);assert.equal(emptyClaims.featureExpiresAt.core_platform,maintenanceUntil)
    const project=JSON.parse(Buffer.from(store.management.clientResponse(instance,'1.0.0').project.payload,'base64url'))
    assert.equal(project.featureEnabled.advanced_income_reports,false)
    assert.deepEqual(project.featureStartsAt,{});assert.deepEqual(project.featureExpiresAt,{})
  }finally{store.close()}
})

test('legacy database migration adds enabled and order snapshots with enabled defaulting to one',()=>{
  const root='D:\\CodexData\\temp\\detla-entitlement\\migrations';mkdirSync(root,{recursive:true})
  const directory=mkdtempSync(path.join(root,'legacy-')),database=path.join(directory,'authority.sqlite')
  const legacy=new DatabaseSync(database)
  legacy.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, module_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, term_days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'UNPAID', payment_reference TEXT, paid_at TEXT, granted_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE entitlements (instance_id TEXT NOT NULL, module_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_until TEXT, PRIMARY KEY(instance_id,module_id));`)
  legacy.close()
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database,privateKey,ownerUsername:'owner',ownerPassword:'Migration-test-password-2026'})
  try{
    const orderColumns=new Set(store.db.prepare('PRAGMA table_info(orders)').all().map(row=>row.name))
    const entitlementColumns=new Set(store.db.prepare('PRAGMA table_info(entitlements)').all().map(row=>row.name))
    assert(orderColumns.has('valid_from'));assert(orderColumns.has('valid_until'));assert(orderColumns.has('cancel_reason'));assert(orderColumns.has('cancelled_at'));assert(orderColumns.has('refund_reference'));assert(orderColumns.has('refunded_at'));assert(entitlementColumns.has('enabled'))
    store.createCustomer({id:'legacy',name:'旧数据客户'},'owner')
    const instance=randomUUID(),validUntil=new Date(Date.now()+20*day).toISOString()
    store.createInstance({id:instance,customerId:'legacy',name:'旧数据实例',domains:['legacy.example.com'],maintenanceUntil:validUntil},'owner')
    store.db.prepare('INSERT INTO entitlements(instance_id,module_id,valid_from,valid_until) VALUES (?,?,?,?)').run(instance,'advanced_income_reports',new Date().toISOString(),validUntil)
    const row=store.listEntitlements().find(item=>item.instance_id===instance)
    assert.equal(row.enabled,true);assert.equal(row.status,'ACTIVE')
  }finally{store.close();rmSync(directory,{recursive:true,force:true})}
})
