import assert from 'node:assert/strict'
import {generateKeyPairSync,randomUUID} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {chromium,webkit,devices} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const output=path.resolve(process.env.E2E_OUTPUT||'D:/CodexData/temp/detla-entitlement/authority-browser')
if(process.platform==='win32')assert(/^D:[\\/]/i.test(output),'Artifacts must remain on D:');mkdirSync(output,{recursive:true})
const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const {privateKey:paymentPrivateKey,publicKey:paymentPublicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Browser-test-only-2026'})
const paymentKeyDirectory=path.join(output,'payment-key-upload-data');mkdirSync(paymentKeyDirectory,{recursive:true});store.dataDirectory=paymentKeyDirectory
store.createCustomer({id:'demo',name:'浏览器测试客户',note:'独立内存数据，不访问生产环境'},'test')
for(let index=0;index<60;index++)store.createCustomer({id:'fixture-'+String(index).padStart(3,'0'),name:'分页测试客户 '+index},'test')
const browserInstance=randomUUID()
store.createInstance({id:browserInstance,customerId:'demo',name:'权益测试实例',domains:['entitlement.example.com'],maintenanceUntil:new Date(Date.now()+500*86400000).toISOString()},'test')
store.updateModule('advanced_income_reports',{priceCents:9900,termDays:365,status:'ACTIVE'},'test')
store.createEntitlement({instanceId:browserInstance,moduleId:'advanced_income_reports',validFrom:new Date().toISOString(),validUntil:new Date(Date.now()+30*86400000).toISOString(),enabled:true},'test')
store.releaseService.create({version:'1.4.1',channel:'stable',notes:'隔离正式版说明 https://github.com/fixture/private',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.4.1',items:[{id:'security',name:'安全更新',component:'backend',required:true},{id:'admin',name:'管理端',component:'admin',requires:['security']}]},'test')
store.releaseService.create({version:'1.4.0',channel:'stable',notes:'跨端公开说明 https://github.com/fixture/private',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.4.0',items:[{id:'security',name:'安全更新',component:'backend',required:true},{id:'admin',name:'管理端',component:'admin',requires:['security']}]},'test');store.releaseService.publish('detla','1.4.0','test')
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
const requestedCase=process.env.E2E_CASE
const selectedCases=requestedCase?cases.filter(item=>item.name===requestedCase):cases
if(!selectedCases.length)throw new Error('Unknown E2E_CASE: '+requestedCase)
const results=[]
try{
 for(const item of selectedCases){const browser=await item.engine.launch({headless:true,...(item.engine===chromium&&process.env.E2E_CHROMIUM_EXECUTABLE?{executablePath:process.env.E2E_CHROMIUM_EXECUTABLE}:{})});const context=await browser.newContext(item.options);if(item.name==='Android-WeChat')await context.addInitScript(()=>{AbortSignal.timeout=undefined});const page=await context.newPage();const mobileLayout=item.options.viewport?.width<=760;const dataRows=()=>page.locator(mobileLayout?'.mobile-data-card':'.el-table__body tr');const errors=[],external=[];let dataRequests=0
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort()}if(new URL(route.request().url()).pathname==='/api/data')dataRequests++;return route.continue()})
  page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(base);await page.getByRole('heading',{name:'欢迎登录'}).waitFor();
   assert.equal(dataRequests,0,item.name+' must not request operator data before authentication')
   await page.getByRole('textbox').first().fill('owner');await page.locator('input[type=password]').fill('Browser-test-only-2026');await page.getByRole('button',{name:'登录运营后台'}).click();await page.getByRole('heading',{name:'运营概览',exact:true}).waitFor()
   if(item.name==='PC-Chrome'){const icons=await page.locator('.stat-icon').evaluateAll(nodes=>nodes.map(node=>{const outer=node.getBoundingClientRect(),svg=node.querySelector('svg')?.getBoundingClientRect();return !!svg&&svg.left>=outer.left-.5&&svg.top>=outer.top-.5&&svg.right<=outer.right+.5&&svg.bottom<=outer.bottom+.5}));assert.equal(icons.length,4);assert.equal(icons.every(Boolean),true);const motion=await page.evaluate(()=>({card:getComputedStyle(document.querySelector('.stats article')).animationName,line:getComputedStyle(document.querySelector('.trend-line')).animationName,donut:getComputedStyle(document.querySelector('.donut-chart')).animationName}));assert.equal(motion.card,'sx-overview-in');assert.equal(motion.line,'sx-line-draw');assert.equal(motion.donut,'sx-donut-in');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.getByRole('button',{name:/立即开通/}).click();await page.getByRole('heading',{name:'项目管理',exact:true,level:1}).waitFor();const projectDialog=page.getByRole('dialog');await projectDialog.waitFor();assert.match(await projectDialog.textContent(),/项目设置与续期/);await projectDialog.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'运营概览',exact:true}).click();await page.getByRole('heading',{name:'运营概览',exact:true,level:1}).waitFor()}
   if(item.name==='PC-Chrome'){const expected=['运营概览','客户管理','项目管理','实例接入','软件中心','功能与定价','客户功能','实名用量账户','购买订单','授权管理','版本发布','服务组发布','支付设置','短信服务','邮件通知','操作记录','在线客服'];const labels=(await page.locator('.nav-scroll button').allTextContents()).map(value=>value.trim());labels.push((await page.locator('.aside-quick button').textContent()).trim());assert.deepEqual(labels,expected);const sidebar=page.locator('.shell > aside');await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect.poll(async()=>Math.round((await sidebar.boundingBox()).width)).toBe(76);await page.getByRole('button',{name:'展开侧栏',exact:true}).click();await expect.poll(async()=>Math.round((await sidebar.boundingBox()).width)).toBe(228)}
   async function navigate(name){if(item.options.viewport?.width<901||item.options.isMobile){const toggle=page.getByRole('button',{name:'打开菜单',exact:true});if(await toggle.isVisible())await toggle.click()}const target=page.getByRole('button',{name,exact:true});await target.click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,item.name+' '+name+' horizontal overflow')}
   await navigate('客户管理');await dataRows().first().getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('dialog').waitFor();const dialog=await page.getByRole('dialog').boundingBox();assert(dialog.x>=0&&dialog.x+dialog.width<=(await page.evaluate(()=>innerWidth))+2,item.name+' dialog overflow');await page.screenshot({path:path.join(output,item.name+'-customer.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'取消',exact:true}).click()
   for(const name of ['软件中心','项目管理','实例接入','在线客服','服务组发布','实名用量账户','短信服务','邮件通知','功能与定价','客户功能','购买订单','授权管理','版本发布','支付设置','操作记录'])await navigate(name)
   if(item.name==='PC-Chrome'){
    await navigate('短信服务')
    await page.getByRole('tab',{name:'业务通知模板'}).click()
    const customerNotice=page.getByRole('row').filter({hasText:'客户'}).filter({hasText:'新订单'})
    await customerNotice.getByRole('button',{name:'配置模板',exact:true}).click()
    const notice=page.getByRole('dialog',{name:'新增短信模板'})
    await expect(notice.getByLabel('模板键')).toHaveValue('notice_user_new_order')
    await expect(notice.getByLabel('模板键')).toBeDisabled()
    await notice.getByLabel('阿里云模板 Code').fill('SMS_12345678')
    await notice.getByRole('button',{name:'保存模板',exact:true}).click()
    await expect(customerNotice).toContainText('SMS_12345678')
    await expect(customerNotice).toContainText('草稿')
    await page.screenshot({path:path.join(output,'PC-Chrome-sms-notice-templates.png'),animations:'disabled'})
    await page.getByRole('tab',{name:'接入配置'}).click()
    await expect(page.getByText('让送达结果和扣费回写')).toBeVisible()
    await page.getByRole('tab',{name:'用量账单'}).click()
    await expect(page.getByText('阿里云已受理',{exact:false})).toBeVisible()
    await expect(page.getByText('确认送达',{exact:false})).toBeVisible()
   }
   await navigate('客户功能');const entitlementRow=dataRows().filter({hasText:'收益对比分析'});await expect(entitlementRow).toContainText('浏览器测试客户');await expect(entitlementRow).toContainText('权益测试实例');await entitlementRow.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('付费功能')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
   if(item.name==='PC-Chrome'){
    const switchResponse=page.waitForResponse(response=>response.url().includes('/api/entitlements/'+browserInstance)&&response.request().method()==='PUT')
    await entitlementRow.locator('.el-switch').click();const switchResult=await switchResponse;assert.equal(switchResult.status(),200,await switchResult.text());assert.deepEqual(JSON.parse(switchResult.request().postData()),{enabled:false})
    assert.equal(store.listEntitlements().find(row=>row.instance_id===browserInstance).enabled,false)
    const restoreResponse=page.waitForResponse(response=>response.url().includes('/api/entitlements/'+browserInstance)&&response.request().method()==='PUT')
    await entitlementRow.locator('.el-switch').click();const restoreResult=await restoreResponse;assert.equal(restoreResult.status(),200,await restoreResult.text());assert.deepEqual(JSON.parse(restoreResult.request().postData()),{enabled:true})
    assert.equal(store.listEntitlements().find(row=>row.instance_id===browserInstance).enabled,true)
    await entitlementRow.getByRole('button',{name:'续费',exact:true}).click();const renewDialog=page.getByRole('dialog');await expect(renewDialog.getByText('创建续费订单',{exact:true})).toBeVisible();await expect(renewDialog.locator('.order-preview')).toContainText('续费起算');await expect(renewDialog.locator('.order-preview')).toContainText('本次新增');await renewDialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(store.lists().orders.length,0)
    await navigate('购买订单');await page.getByRole('button',{name:'创建订单',exact:true}).click();const orderDialog=page.getByRole('dialog');await orderDialog.locator('.el-form-item').filter({hasText:'客户实例'}).locator('.el-select').click();await page.getByRole('option',{name:/浏览器测试客户 \/ 权益测试实例/}).click();await orderDialog.locator('.el-form-item').filter({hasText:'功能模块'}).locator('.el-select').click();await page.getByRole('option',{name:/收益对比分析/}).click();await expect(orderDialog.locator('.order-preview')).toContainText('¥99.00');await expect(orderDialog.locator('.order-preview')).toContainText('本次新增');await expect(orderDialog.locator('.order-preview')).toContainText('剩余总计');await orderDialog.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();const orderRow=page.locator('.el-table__body tr').filter({hasText:'浏览器测试客户'}).filter({hasText:'收益对比分析'});await expect(orderRow).toContainText('实际新增 365 天')
   }
   await navigate('功能与定价');const moduleRow=dataRows().filter({hasText:'实名认证'});await moduleRow.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('最低客户端版本')).toHaveValue('1.4.0');await page.getByRole('dialog').getByLabel('最低客户端版本').fill('1.4.0');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();assert.equal(store.db.prepare("SELECT min_version FROM modules WHERE id='identity_verification'").get().min_version,'1.4.0');await expect(dataRows().filter({hasText:'邮件通知'})).toContainText('¥50.00')
   await navigate('邮件通知');await page.getByLabel('SMTP 服务器').fill('draft.example.com');await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByLabel('SMTP 服务器')).toHaveValue('draft.example.com');await navigate('客户管理');await navigate('邮件通知');await expect(page.getByLabel('SMTP 服务器')).toHaveValue('draft.example.com')
    await navigate('支付设置');await expect(page.getByText(/支付方式彼此独立/)).toBeVisible();await expect(page.getByText(/不依据浏览器或 User-Agent 自动切换/)).toBeVisible();await expect(page.getByText(/固定路径为 \/api\/pay\/wx\/notify/)).toBeVisible();await page.getByLabel('微信应用 AppID（H5 / 小程序 / Native）').fill('draft-app-id');await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByLabel('微信应用 AppID（H5 / 小程序 / Native）')).toHaveValue('draft-app-id')
    if(item.name==='PC-Chrome'){
      const uploadRequests=[];page.on('request',request=>{if(request.url().endsWith('/api/payment-keys/upload'))uploadRequests.push(request)})
      const privateItem=page.locator('.el-form-item').filter({hasText:'商户私钥文件'}),privateUploadButton=privateItem.locator('button.el-button');await expect(privateUploadButton).toBeEnabled();const [privateChooser]=await Promise.all([page.waitForEvent('filechooser'),privateUploadButton.click()]);await privateChooser.setFiles({name:'apiclient_key.pem',mimeType:'application/x-pem-file',buffer:Buffer.from(paymentPrivateKey)});await expect.poll(()=>uploadRequests.length,{timeout:5000}).toBe(1);assert.equal((await uploadRequests[0].response()).status(),201);await expect(privateItem.getByRole('textbox')).toHaveValue(path.join(paymentKeyDirectory,'payment-keys','wechat','merchant-private-key.pem'));assert.equal(readFileSync(path.join(paymentKeyDirectory,'payment-keys','wechat','merchant-private-key.pem'),'utf8'),paymentPrivateKey.trim()+'\n')
      const publicItem=page.locator('.el-form-item').filter({hasText:'微信支付公钥文件'});const [publicChooser]=await Promise.all([page.waitForEvent('filechooser'),publicItem.locator('button.el-button').click()]);await publicChooser.setFiles({name:'pub_key.pem',mimeType:'application/x-pem-file',buffer:Buffer.from(paymentPublicKey)});await expect.poll(()=>uploadRequests.length,{timeout:5000}).toBe(2);assert.equal((await uploadRequests[1].response()).status(),201);await expect(publicItem.getByRole('textbox')).toHaveValue(path.join(paymentKeyDirectory,'payment-keys','wechat','wechat-pay-public-key.pem'))
      await privateItem.scrollIntoViewIfNeeded();await page.waitForTimeout(3500);await page.screenshot({path:path.join(output,'PC-Chrome-payment-keys-callbacks.png'),fullPage:false,animations:'disabled'})
    }
    await page.screenshot({path:path.join(output,item.name+'-payments.png'),fullPage:true,animations:'disabled'})
   await navigate('版本发布');await page.getByRole('button',{name:'配置可选内容',exact:true}).first().click();await expect(page.getByRole('dialog').locator('.update-item')).toHaveCount(2);await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).first()).toBeChecked();await expect(page.getByRole('dialog').locator('.update-item').nth(1)).toContainText('安全更新');await page.getByRole('dialog').locator('.update-item').nth(1).locator('.el-checkbox').click();await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).nth(1)).toBeChecked();await page.getByRole('dialog').locator('.update-item').nth(1).locator('.el-checkbox').click();await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).nth(1)).not.toBeChecked();await page.getByRole('dialog').getByPlaceholder('变更说明').nth(1).fill('跨端配置验证 https://github.com/fixture/private');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();const savedItems=JSON.parse(store.db.prepare("SELECT items FROM release_catalog WHERE product_id='detla' AND version='1.4.0'").get().items);assert.deepEqual(savedItems[1].requires,['security']);assert.equal(savedItems[1].required,false);await expect(page.getByRole('button',{name:'发布版本信息',exact:true})).toBeVisible();await page.getByRole('button',{name:'新增版本',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('所属软件')).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click()
   await navigate('客户管理');assert.equal(await dataRows().count(),25);await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.list-footer')).toContainText('第 2 / 3 页');await page.getByRole('textbox',{name:'搜索当前列表'}).fill('demo');await expect(dataRows()).toHaveCount(1);await navigate('功能与定价');await expect(page.getByRole('textbox',{name:'搜索当前列表'})).toHaveValue('');await navigate('客户管理');await expect(page.getByRole('textbox',{name:'搜索当前列表'})).toHaveValue('demo');await page.getByRole('textbox',{name:'搜索当前列表'}).fill('')
   await navigate('客户管理');await page.getByRole('button',{name:'新增客户',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(errors.length,0,errors.join('\n'));await page.getByRole('button',{name:'取消',exact:true}).click()
   await navigate('版本发布');const notesLink=page.getByRole('link',{name:'查看发布说明',exact:true});assert.equal(new URL(await notesLink.getAttribute('href')).origin,base);const notesPage=await context.newPage();await notesPage.goto(await notesLink.getAttribute('href'));await expect(notesPage.getByRole('heading',{name:'软件正式版 1.4.0'})).toBeVisible();assert.doesNotMatch(await notesPage.content(),/github\.com/i);await notesPage.close()
   assert.deepEqual(external,[],item.name+' must not load public notes or assets from GitHub');results.push({name:item.name,passed:true,pages:13,checks:['unauthenticated-data-guard','entitlement-list-edit','module-min-version','settings-drafts','release-selection','manual-release-entry','pagination','per-page-search','authority-public-notes'],consoleErrors:errors});console.log(item.name+' passed')
  }catch(error){results.push({name:item.name,passed:false,error:error.message,consoleErrors:errors});throw error}finally{await context.close();await browser.close()}
 }
}finally{writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));await new Promise(resolve=>server.close(resolve));store.close()}
