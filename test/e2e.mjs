import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {chromium,webkit,devices} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const output=path.resolve(process.env.E2E_OUTPUT||'D:/CodexData/temp/detla-ux-1.4.1/authority-browser')
if(process.platform==='win32')assert(/^D:[\\/]/i.test(output),'Artifacts must remain on D:');mkdirSync(output,{recursive:true})
const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Browser-test-only-2026'})
store.createCustomer({id:'demo',name:'浏览器测试客户',note:'独立内存数据，不访问生产环境'},'test')
for(let index=0;index<60;index++)store.createCustomer({id:'fixture-'+String(index).padStart(3,'0'),name:'分页测试客户 '+index},'test')
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
const results=[]
try{
 for(const item of cases){const browser=await item.engine.launch({headless:true});const context=await browser.newContext(item.options);if(item.name==='Android-WeChat')await context.addInitScript(()=>{AbortSignal.timeout=undefined});const page=await context.newPage();const errors=[],external=[];let dataRequests=0
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort()}if(new URL(route.request().url()).pathname==='/api/data')dataRequests++;return route.continue()})
  page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(base);await page.getByRole('heading',{name:'授权运营中心'}).waitFor();
   assert.equal(dataRequests,0,item.name+' must not request operator data before authentication')
   await page.getByRole('textbox').first().fill('owner');await page.locator('input[type=password]').fill('Browser-test-only-2026');await page.getByRole('button',{name:'登录运营后台'}).click();await page.getByRole('heading',{name:'运营概览',exact:true}).waitFor()
   async function navigate(name){if(item.options.viewport?.width<901||item.options.isMobile){const toggle=page.getByRole('button',{name:'打开菜单',exact:true});if(await toggle.isVisible())await toggle.click()}await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,item.name+' '+name+' horizontal overflow')}
   await navigate('客户管理');await page.getByRole('button',{name:'编辑',exact:true}).first().click();await page.getByRole('dialog').waitFor();const dialog=await page.getByRole('dialog').boundingBox();assert(dialog.x>=0&&dialog.x+dialog.width<=(await page.evaluate(()=>innerWidth))+2,item.name+' dialog overflow');await page.screenshot({path:path.join(output,item.name+'-customer.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'取消',exact:true}).click()
   for(const name of ['软件中心','项目管理','实例接入','邮件通知','功能与定价','购买订单','授权管理','版本发布','支付设置','操作记录'])await navigate(name)
   await navigate('功能与定价');const moduleRow=page.locator('.el-table__body tr').filter({hasText:'实名认证'});await moduleRow.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('最低客户端版本')).toHaveValue('1.4.0');await page.getByRole('dialog').getByLabel('最低客户端版本').fill('1.4.0');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();assert.equal(store.db.prepare("SELECT min_version FROM modules WHERE id='identity_verification'").get().min_version,'1.4.0');await expect(page.locator('.el-table__body tr').filter({hasText:'邮件通知'})).toContainText('¥50.00')
   await navigate('邮件通知');await page.getByLabel('SMTP 服务器').fill('draft.example.com');await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByLabel('SMTP 服务器')).toHaveValue('draft.example.com');await navigate('客户管理');await navigate('邮件通知');await expect(page.getByLabel('SMTP 服务器')).toHaveValue('draft.example.com')
   await navigate('支付设置');await page.getByLabel('支付关联 AppID').fill('draft-app-id');await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByLabel('支付关联 AppID')).toHaveValue('draft-app-id')
   await navigate('版本发布');await page.getByRole('button',{name:'配置可选内容',exact:true}).first().click();await expect(page.getByRole('dialog').locator('.update-item')).toHaveCount(2);await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).first()).toBeChecked();await expect(page.getByRole('dialog').locator('.update-item').nth(1)).toContainText('安全更新');await page.getByRole('dialog').locator('.update-item').nth(1).locator('.el-checkbox').click();await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).nth(1)).toBeChecked();await page.getByRole('dialog').locator('.update-item').nth(1).locator('.el-checkbox').click();await expect(page.getByRole('dialog').getByRole('checkbox',{name:'必须更新'}).nth(1)).not.toBeChecked();await page.getByRole('dialog').getByPlaceholder('变更说明').nth(1).fill('跨端配置验证 https://github.com/fixture/private');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();const savedItems=JSON.parse(store.db.prepare("SELECT items FROM release_catalog WHERE product_id='detla' AND version='1.4.0'").get().items);assert.deepEqual(savedItems[1].requires,['security']);assert.equal(savedItems[1].required,false);await expect(page.getByRole('button',{name:'发布版本信息',exact:true})).toBeVisible();await page.getByRole('button',{name:'新增版本',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('所属软件')).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click()
   await navigate('客户管理');assert.equal(await page.locator('.el-table__body tr').count(),25);await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.list-footer')).toContainText('第 2 / 3 页');await page.getByRole('textbox',{name:'搜索当前列表'}).fill('demo');await expect(page.locator('.el-table__body tr')).toHaveCount(1);await navigate('功能与定价');await expect(page.getByRole('textbox',{name:'搜索当前列表'})).toHaveValue('');await navigate('客户管理');await expect(page.getByRole('textbox',{name:'搜索当前列表'})).toHaveValue('demo');await page.getByRole('textbox',{name:'搜索当前列表'}).fill('')
   await navigate('客户管理');await page.getByRole('button',{name:'新增客户',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(errors.length,0,errors.join('\n'));await page.getByRole('button',{name:'取消',exact:true}).click()
   await navigate('版本发布');const notesLink=page.getByRole('link',{name:'查看发布说明',exact:true});assert.equal(new URL(await notesLink.getAttribute('href')).origin,base);const notesPage=await context.newPage();await notesPage.goto(await notesLink.getAttribute('href'));await expect(notesPage.getByRole('heading',{name:'软件正式版 1.4.0'})).toBeVisible();assert.doesNotMatch(await notesPage.content(),/github\.com/i);await notesPage.close()
   assert.deepEqual(external,[],item.name+' must not load public notes or assets from GitHub');results.push({name:item.name,passed:true,pages:12,checks:['unauthenticated-data-guard','module-min-version','settings-drafts','release-selection','manual-release-entry','pagination','per-page-search','authority-public-notes'],consoleErrors:errors});console.log(item.name+' passed')
  }catch(error){results.push({name:item.name,passed:false,error:error.message,consoleErrors:errors});throw error}finally{await context.close();await browser.close()}
 }
}finally{writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));await new Promise(resolve=>server.close(resolve));store.close()}
