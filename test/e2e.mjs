import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {chromium,webkit,devices} from 'playwright'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const output=path.resolve(process.env.E2E_OUTPUT||'D:/CodexData/outputs/detla-1.3-audit/authority-browser')
if(process.platform==='win32')assert(/^D:[\\/]/i.test(output),'Artifacts must remain on D:');mkdirSync(output,{recursive:true})
const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Browser-test-only-2026'})
store.createCustomer({id:'demo',name:'浏览器测试客户',note:'独立内存数据，不访问生产环境'},'test')
const server=createAuthorityServer(store,{staticDirectory:path.resolve('dist')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
const cases=[
 {name:'PC-Chrome',engine:chromium,options:{viewport:{width:1440,height:900}}},
 {name:'Android-Chrome',engine:chromium,options:devices['Pixel 7']},
 {name:'Android-WeChat',engine:chromium,options:{...devices['Pixel 7'],userAgent:devices['Pixel 7'].userAgent+' MicroMessenger/8.0.60'}},
 {name:'Android-QQ',engine:chromium,options:{...devices['Pixel 7'],userAgent:devices['Pixel 7'].userAgent+' QQ/9.1.0'}},
 {name:'iOS-Safari',engine:webkit,options:devices['iPhone 13']},
 {name:'iOS-WeChat',engine:webkit,options:{...devices['iPhone 13'],userAgent:devices['iPhone 13'].userAgent+' MicroMessenger/8.0.60'}},
 {name:'iOS-QQ',engine:webkit,options:{...devices['iPhone 13'],userAgent:devices['iPhone 13'].userAgent+' QQ/9.1.0'}},
 {name:'Small-320px',engine:webkit,options:{...devices['iPhone SE'],viewport:{width:320,height:568}}}
]
const results=[]
try{
 for(const item of cases){const browser=await item.engine.launch({headless:true});const context=await browser.newContext(item.options);if(item.name==='Android-WeChat')await context.addInitScript(()=>{AbortSignal.timeout=undefined});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(base);await page.getByRole('heading',{name:'授权运营中心'}).waitFor();
   await page.getByRole('textbox').first().fill('owner');await page.locator('input[type=password]').fill('Browser-test-only-2026');await page.getByRole('button',{name:'登录运营后台'}).click();await page.getByRole('heading',{name:'运营概览',exact:true}).waitFor()
   async function navigate(name){if(item.options.viewport?.width<901||item.options.isMobile){const toggle=page.getByRole('button',{name:'打开菜单',exact:true});if(await toggle.isVisible())await toggle.click()}await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,item.name+' '+name+' horizontal overflow')}
   await navigate('客户管理');await page.getByRole('button',{name:'编辑',exact:true}).first().click();await page.getByRole('dialog').waitFor();const dialog=await page.getByRole('dialog').boundingBox();assert(dialog.x>=0&&dialog.x+dialog.width<=(await page.evaluate(()=>innerWidth))+2,item.name+' dialog overflow');await page.screenshot({path:path.join(output,item.name+'-customer.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'取消',exact:true}).click()
   for(const name of ['软件中心','项目管理','实例接入','邮件通知','功能与定价','购买订单','授权管理','版本发布','支付设置','操作记录'])await navigate(name)
   await navigate('客户管理');await page.getByRole('button',{name:'新增客户',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(errors.length,0,errors.join('\n'));await page.getByRole('button',{name:'取消',exact:true}).click()
   results.push({name:item.name,passed:true,pages:12,consoleErrors:errors});console.log(item.name+' passed')
  }catch(error){results.push({name:item.name,passed:false,error:error.message,consoleErrors:errors});throw error}finally{await context.close();await browser.close()}
 }
}finally{writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));await new Promise(resolve=>server.close(resolve));store.close()}
