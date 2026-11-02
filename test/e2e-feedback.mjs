import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {chromium} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const output=path.resolve(process.env.E2E_OUTPUT||'D:/CodexData/temp/detla-ux-1.4.1/authority-feedback')
if(process.platform==='win32')assert(/^D:[\\/]/i.test(output));mkdirSync(output,{recursive:true})
const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Feedback-test-only-2026'})
store.transaction(()=>{for(let i=0;i<10000;i++)store.db.prepare('INSERT INTO customers VALUES (?,?,?,?,?)').run('customer-'+i,'客户 '+i,'ACTIVE','隔离性能数据',new Date().toISOString())})
store.releaseService.create({version:'1.4.1',channel:'stable',notes:'中心发布说明 https://github.com/fixture/private',sourceUrl:'https://github.com/zhz520/cangshuo-detla/releases/tag/v1.4.1'},'test');store.releaseService.publish('detla','1.4.1','test')
const server=createAuthorityServer(store,{staticDirectory:path.resolve('dist')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],external=[],checks=[]
let sessionFailure=true,dataFailure=false,dataRequests=0,writes=0,holdData=null,releaseData
page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',async route=>{
  const url=new URL(route.request().url())
  if(url.origin!==base){external.push(url.href);return route.abort()}
  if(url.pathname==='/api/session'&&sessionFailure){sessionFailure=false;return route.fulfill({status:503,contentType:'text/html',body:'unavailable'})}
  if(url.pathname==='/api/customers'&&route.request().method()==='POST')writes++
  if(url.pathname==='/api/data'){
    dataRequests++
    if(holdData){const response=await route.fetch();releaseData=()=>route.fulfill({response});holdData=null;return}
    if(dataFailure){const status=dataFailure===401?401:503;dataFailure=false;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({message:status===401?'请先登录运营后台':'隔离测试：暂时无法加载'})})}
  }
  return route.continue()
})
async function login(){await page.getByRole('textbox').first().fill('owner');await page.locator('input[type=password]').fill('Feedback-test-only-2026');await page.getByRole('button',{name:'登录运营后台'}).click();await page.locator('.workspace').waitFor()}
async function navigate(name){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor()}
try{
  await page.goto(base);await page.getByRole('button',{name:'重新连接',exact:true}).waitFor();assert.equal(dataRequests,0)
  await page.getByRole('button',{name:'重新连接',exact:true}).click();await page.getByRole('heading',{name:'授权运营中心'}).waitFor();assert.equal(dataRequests,0);checks.push('boot-retry-without-private-access')
  dataFailure=true;await login();await expect(page.locator('.data-error')).toContainText('数据加载失败');await expect(page.locator('.stats')).toHaveCount(0)
  await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.stats')).toBeVisible();checks.push('initial-data-error-and-retry')
  const start=performance.now();await navigate('客户管理');await expect(page.locator('.el-table__body tr')).toHaveCount(25);const transitionMs=performance.now()-start
  const rows=await page.locator('.el-table__body tr').count();assert.equal(rows,25);checks.push('10000-records-bounded-to-25-rows')
  dataFailure=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.data-error')).toContainText('上次加载的数据');await expect(page.locator('.el-table__body tr')).toHaveCount(25);checks.push('refresh-failure-retains-current-records')
  await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.data-error')).toHaveCount(0)
  holdData=true;const countBefore=dataRequests;await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>dataRequests).toBe(countBefore+1);await expect.poll(()=>typeof releaseData).toBe('function')
  await expect(page.locator('.el-loading-mask')).toHaveCount(0);await navigate('功能与定价');await expect(page.locator('.el-table__body tr')).toHaveCount(4);await expect(page.getByRole('cell',{name:'邮件通知',exact:true})).toBeVisible();await releaseData();await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();checks.push('inflight-refresh-allows-navigation')
  await navigate('客户管理');await page.getByRole('button',{name:'新增客户',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('客户编号').fill('feedback-created');await dialog.getByLabel('客户名称').fill('反馈测试客户')
  dataFailure=true;await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.data-error')).toContainText('刷新失败');assert.equal(writes,1);assert.equal(store.db.prepare('SELECT name FROM customers WHERE id=?').get('feedback-created').name,'反馈测试客户');checks.push('save-success-is-distinct-from-refresh-failure')
  await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.data-error')).toHaveCount(0)
  await navigate('版本发布');const link=page.getByRole('link',{name:'查看发布说明',exact:true});assert.equal(new URL(await link.getAttribute('href')).origin,base)
  const notes=await context.newPage();await notes.goto(await link.getAttribute('href'));await expect(notes.getByRole('heading',{name:'软件正式版 1.4.1'})).toBeVisible();assert.doesNotMatch(await notes.content(),/github\.com/i);await notes.close();checks.push('public-notes-use-authority-without-github')
  await navigate('客户管理');await page.goBack();await page.getByRole('heading',{name:'版本发布',exact:true}).waitFor();checks.push('browser-history-navigation')
  dataFailure=401;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('heading',{name:'授权运营中心'}).waitFor();await expect(page.locator('.workspace')).toHaveCount(0);checks.push('session-expiry-removes-private-data')
  await login();await navigate('客户管理');await page.getByRole('button',{name:'刷新',exact:true}).waitFor();await page.screenshot({path:path.join(output,'desktop-10000-customers.png'),animations:'disabled'});holdData=true;releaseData=undefined;await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>typeof releaseData).toBe('function');await page.getByRole('button',{name:'退出',exact:true}).click();await page.getByRole('heading',{name:'授权运营中心'}).waitFor();await releaseData();await expect(page.locator('.workspace')).toHaveCount(0);checks.push('late-refresh-does-not-restore-logged-out-data')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,customers:10000,renderedRows:rows,transitionMs,consoleErrors:errors,externalRequests:external},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,transitionMs}))
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:false,checks,error:error.message,consoleErrors:errors},null,2));throw error}
finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close()}
