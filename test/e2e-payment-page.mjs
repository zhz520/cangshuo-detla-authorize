import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID} from 'node:crypto'
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {chromium,devices} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'
import {PaymentService} from '../server/payments.mjs'

const output=path.resolve(process.env.QA_OUTPUT||'D:/CodexData/outputs/client-feature-payment/preview')
mkdirSync(output,{recursive:true})
const base=process.platform==='win32'?path.resolve('D:/CodexData/temp'):os.tmpdir();mkdirSync(base,{recursive:true})
const directory=mkdtempSync(path.join(base,'payment-page-e2e-'))
const {privateKey:signingKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const merchant=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
const wechat=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey:signingKey,ownerUsername:'owner',ownerPassword:'Payment-page-browser-2026'});store.dataDirectory=directory
store.createCustomer({id:'742',name:'见高山电竞'},'owner')
const project=store.management.saveProject(null,{customerId:'742',productId:'detla',name:'见高山电竞 742',maintenanceUntil:'2027-12-01T15:59:59.000Z'},'owner').id
const instance='4aa1ade5-cd37-4d25-bd31-5f4f0fba391d'
store.createInstance({id:instance,customerId:'742',projectId:project,name:'见高山电竞 742',domains:['jgsapi.kk520yy.com','jgs.kk520yy.com'],clientVersion:'1.5.10'},'owner')
store.updateModule('advanced_income_reports',{priceCents:9900,termDays:365,status:'ACTIVE'},'owner')
const privateKey=store.management.uploadPaymentKey({kind:'private',filename:'apiclient_key.pem',contentBase64:Buffer.from(merchant.privateKey).toString('base64')},'owner')
const publicKey=store.management.uploadPaymentKey({kind:'public',filename:'pub_key.pem',contentBase64:Buffer.from(wechat.publicKey).toString('base64')},'owner')
store.management.savePaymentProvider('wechat_pay',{enabled:true,methods:['OFFICIAL'],config:{appId:'',officialAppId:'wx-official-test',officialAppSecret:'official-secret',officialReturnOrigin:'https://auth.kk520yy.com',merchantId:'1900000109',apiV3Key:'12345678901234567890123456789012',merchantSerialNo:'SERIAL',privateKeyPath:privateKey.path,publicKeyId:'PUB_KEY_TEST',publicKeyPath:publicKey.path,notifyUrl:'https://auth.kk520yy.com/api/pay/wx/notify'}},'owner')
store.management.saveProject(project,{name:'见高山电竞 742',maintenanceUntil:'2027-12-01T15:59:59.000Z',paymentProvider:'wechat_pay',paymentMethods:['OFFICIAL']},'owner')
const payments=new PaymentService(store)
process.env.AUTHORITY_PUBLIC_URL='https://auth.kk520yy.com'
const server=createAuthorityServer(store,{staticDirectory:path.resolve('dist'),payments});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
try{
  const checkoutResponse=await fetch(origin+'/api/client/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({license:store.management.identity(instance,'owner'),version:'1.5.10',moduleId:'advanced_income_reports'})})
  if(checkoutResponse.status!==201)throw new Error(await checkoutResponse.text())
  const checkout=await checkoutResponse.json()
  const token=JSON.parse(Buffer.from(checkout.checkout.payload,'base64url')).checkoutUrl.split('/').pop()
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
  try{
    for(const item of [
      {name:'Desktop',options:{viewport:{width:1024,height:900}}},
      {name:'Desktop-WeChat',options:{viewport:{width:1024,height:900},userAgent:'Mozilla/5.0 (Windows NT 10.0) MicroMessenger/8.0 WindowsWechat'}},
      {name:'Mobile-Browser',options:devices['iPhone 13']},
      {name:'Mobile-WeChat',direct:true,options:{...devices['iPhone 13'],userAgent:devices['iPhone 13'].userAgent+' MicroMessenger/8.0.60'}}
    ]){
      const context=await browser.newContext(item.options);const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
      let oauthRequest
      await context.route('**/api/pay/wx/oauth?*',async route=>{
        const redirected = await route.fetch({maxRedirects:0})
        assert.equal(redirected.status(),302)
        oauthRequest = new URL(redirected.headers().location)
        assert.equal(oauthRequest.hostname,'open.weixin.qq.com')
        await route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>模拟微信网页授权</h1>'})
      })
      await page.goto(`${origin}/pay/${token}`)
      if(item.direct){
        await expect(page.getByRole('heading',{name:'模拟微信网页授权'})).toBeVisible()
        assert.equal(oauthRequest?.searchParams.get('scope'),'snsapi_base')
      }else{
        await expect(page.getByRole('heading',{name:'功能授权收款'})).toBeVisible()
        await expect(page.getByText('¥99.00')).toBeVisible()
        await expect(page.locator('.scan svg')).toBeVisible()
        await expect(page.locator('#official-pay')).toHaveCount(0)
        assert.equal(oauthRequest,undefined)
      }
      assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,`payment-checkout-${item.name}.png`),fullPage:true,animations:'disabled'});await context.close()
      console.log(item.name+': PASS')
    }
  }finally{await browser.close()}
}finally{await new Promise(resolve=>server.close(resolve));store.close();if(path.dirname(path.resolve(directory))===path.resolve(base))rmSync(directory,{recursive:true,force:true})}
