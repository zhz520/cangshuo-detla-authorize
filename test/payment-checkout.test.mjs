import test from 'node:test'
import assert from 'node:assert/strict'
import {createCipheriv,createHash,generateKeyPairSync,randomBytes,randomUUID,sign,verify} from 'node:crypto'
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {AuthorityStore} from '../server/store.mjs'
import {PaymentService} from '../server/payments.mjs'

function fixture(){
  const base=process.platform==='win32'?path.resolve('D:/CodexData/temp'):os.tmpdir();mkdirSync(base,{recursive:true})
  const directory=mkdtempSync(path.join(base,'payment-checkout-test-'))
  const {privateKey:signingKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const merchant=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
  const wechat=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey:signingKey,ownerUsername:'owner',ownerPassword:'Payment-checkout-test-2026'});store.dataDirectory=directory
  store.createCustomer({id:'742',name:'见高山电竞'},'owner')
  const project=store.management.saveProject(null,{customerId:'742',productId:'detla',name:'见高山电竞 742',maintenanceUntil:'2027-12-01T15:59:59.000Z'},'owner').id
  const instance='4aa1ade5-cd37-4d25-bd31-5f4f0fba391d'
  store.createInstance({id:instance,customerId:'742',projectId:project,name:'见高山电竞 742',domains:['jgsapi.kk520yy.com','jgs.kk520yy.com'],clientVersion:'1.5.9'},'owner')
  store.updateModule('advanced_income_reports',{priceCents:9900,termDays:365,status:'ACTIVE'},'owner')
  const merchantKey=store.management.uploadPaymentKey({kind:'private',filename:'apiclient_key.pem',contentBase64:Buffer.from(merchant.privateKey).toString('base64')},'owner')
  const wechatKey=store.management.uploadPaymentKey({kind:'public',filename:'pub_key.pem',contentBase64:Buffer.from(wechat.publicKey).toString('base64')},'owner')
  store.management.savePaymentProvider('wechat_pay',{enabled:true,methods:['OFFICIAL'],config:{appId:'',officialAppId:'wx-official-test',officialAppSecret:'official-secret',officialReturnOrigin:'https://auth.example.com',merchantId:'1900000109',apiV3Key:'12345678901234567890123456789012',merchantSerialNo:'SERIAL',privateKeyPath:merchantKey.path,publicKeyId:'PUB_KEY_TEST',publicKeyPath:wechatKey.path,notifyUrl:'https://auth.example.com/api/pay/wx/notify'}},'owner')
  store.management.saveProject(project,{name:'见高山电竞 742',maintenanceUntil:'2027-12-01T15:59:59.000Z',paymentProvider:'wechat_pay',paymentMethods:['OFFICIAL']},'owner')
  return {store,project,instance,wechat,merchant,cleanup(){store.close();if(path.dirname(path.resolve(directory))===path.resolve(base))rmSync(directory,{recursive:true,force:true})}}
}

function signedWechatBody(body,privateKey){
  const timestamp=Math.floor(Date.now()/1000).toString(),nonce=randomBytes(16).toString('hex')
  const signature=sign('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),privateKey).toString('base64')
  return {'wechatpay-signature':signature,'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':'PUB_KEY_TEST','content-type':'application/json'}
}

test('hosted checkout creates a central order and paid notification issues the license',async()=>{
  const f=fixture();try{
    const apiV3Key='12345678901234567890123456789012'
    const requests=[]
    const fetcher=async(url,options={})=>{
      requests.push({url:String(url),options})
      if(String(url).includes('/v3/pay/transactions/jsapi')){
        const body=JSON.stringify({prepay_id:'wx-prepay-test'})
        return new Response(body,{status:200,headers:signedWechatBody(body,f.wechat.privateKey)})
      }
      if(String(url).includes('open.weixin.qq.com'))return new Response(JSON.stringify({errcode:0,openid:'openid-test'}),{status:200})
      throw new Error('unexpected fetch '+url)
    }
    const payments=new PaymentService(f.store,{fetcher})
    const license=f.store.management.identity(f.instance,'owner')
    const created=await payments.createCheckout({license,version:'1.5.9',moduleId:'advanced_income_reports'},'https://auth.example.com')
    assert.equal(created.checkout.format,'cangshuo-checkout-v1')
    assert(verify(null,Buffer.from(created.checkout.format+'.'+created.checkout.payload),f.store.publicKey,Buffer.from(created.checkout.signature,'base64url')))
    const claims=JSON.parse(Buffer.from(created.checkout.payload,'base64url'))
    assert.equal(claims.amountCents,9900);assert.match(claims.checkoutUrl,/^https:\/\/auth\.example\.com\/pay\/[A-Za-z0-9_-]{43}$/)
    const token=claims.checkoutUrl.split('/').pop(),summary=payments.summary(token)
    assert.equal(summary.moduleName,'收益对比分析');assert.equal(summary.amountCents,9900);assert.equal(summary.status,'UNPAID');assert.deepEqual(summary.methods,['OFFICIAL'])

    const payParams=await payments.prepayOfficial(token,'openid-test')
    assert.equal(payParams.appId,'wx-official-test');assert.equal(payParams.package,'prepay_id=wx-prepay-test')
    const payment=f.store.db.prepare('SELECT * FROM online_payments WHERE order_id=?').get(claims.orderId)
    assert.equal(payment.method,'OFFICIAL');assert.equal(payment.openid,'openid-test')

    const transaction={mchid:'1900000109',appid:'wx-official-test',out_trade_no:payment.out_trade_no,transaction_id:'420000TEST',trade_state:'SUCCESS',amount:{total:9900,currency:'CNY'}}
    const nonce='abcdefghijkl',associated='transaction';const cipher=createCipheriv('aes-256-gcm',Buffer.from(apiV3Key),Buffer.from(nonce));cipher.setAAD(Buffer.from(associated));const encrypted=Buffer.concat([cipher.update(JSON.stringify(transaction)),cipher.final(),cipher.getAuthTag()])
    const notification=JSON.stringify({id:'evt-test',event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',ciphertext:encrypted.toString('base64'),nonce,associated_data:associated}})
    const result=await payments.notification(signedWechatBody(notification,f.wechat.privateKey),notification)
    assert.equal(result.paid,true)
    assert.equal(f.store.db.prepare('SELECT status FROM orders WHERE id=?').get(claims.orderId).status,'PAID')
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM licenses WHERE order_id=?').get(claims.orderId).count,1)
    const replay=await payments.notification(signedWechatBody(notification,f.wechat.privateKey),notification)
    assert.equal(replay.paid,true);assert.equal(replay.idempotent,true)
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM licenses WHERE order_id=?').get(claims.orderId).count,1)
    assert.equal(requests.length,1)
  }finally{f.cleanup()}
})

test('client checkout refuses an unsigned or foreign license without creating an order',async()=>{
  const f=fixture();try{
    const payments=new PaymentService(f.store,{fetcher:async()=>{throw new Error('must not call')}})
    await assert.rejects(()=>payments.createCheckout({license:{format:'delta-license-v1',payload:'bad',signature:'bad'},version:'1.5.9',moduleId:'advanced_income_reports'},'https://auth.example.com'),/授权|签名/)
    assert.equal(f.store.lists().orders.length,0)
  }finally{f.cleanup()}
})
