import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium,devices} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'Mail-test-only-password-2026'})
store.management.saveMailSettings({enabled:true,host:'smtp.example.com',port:465,security:'TLS',username:'sender@example.com',password:'independent-fixture-password',from:'sender@example.com',senderName:'隔离测试',operatorEmails:['ops-a@example.com','ops-b@example.com']},'test')
const server=createAuthorityServer(store,{staticDirectory:path.resolve('dist')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`
const results=[]
const output=path.resolve(process.env.E2E_OUTPUT||'D:/CodexData/outputs/detla-mail-multi')
await mkdir(output,{recursive:true})
for(const item of [{name:'desktop',engine:chromium,options:{viewport:{width:1440,height:900}}},{name:'mobile',engine:chromium,options:devices['Pixel 7']}]){
  store.management.saveMailSettings({enabled:true,host:'smtp.example.com',port:465,security:'TLS',username:'sender@example.com',from:'sender@example.com',senderName:'隔离测试',operatorEmails:['ops-a@example.com','ops-b@example.com']},'test')
  const browser=await item.engine.launch({headless:true}),context=await browser.newContext(item.options),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  try{
    await page.goto(base)
    await page.getByRole('textbox').first().fill('owner')
    await page.locator('input[type=password]').fill('Mail-test-only-password-2026')
    await page.getByRole('button',{name:'登录运营后台'}).click()
    await page.getByRole('heading',{name:'运营概览',exact:true}).waitFor()
    if(item.options.isMobile){const toggle=page.getByRole('button',{name:'打开菜单',exact:true});if(await toggle.isVisible())await toggle.click()}
    await page.getByRole('button',{name:'邮件通知',exact:true}).click()
    await page.getByRole('heading',{name:'邮件通知',exact:true}).waitFor()
    const field=page.locator('.mail-form .el-form-item').filter({hasText:'运营通知收件邮箱'})
    await expect(field.locator('.el-tag')).toHaveCount(2)
    const input=field.getByPlaceholder('输入、粘贴或换行添加多个邮箱')
    await input.fill('ops-c@example.com');await field.getByRole('button',{name:'添加',exact:true}).click()
    await expect(field.locator('.el-tag')).toHaveCount(3)
    await input.fill('OPS-A@example.com');await field.getByRole('button',{name:'添加',exact:true}).click()
    await expect(field.locator('.el-tag')).toHaveCount(3)
    await page.getByRole('button',{name:'保存邮箱配置',exact:true}).click()
    await expect.poll(()=>store.management.mailSettings(true).operatorEmails.length).toBe(3)
    assert.deepEqual(store.management.mailSettings(true).operatorEmails,['ops-a@example.com','ops-b@example.com','ops-c@example.com'])
    await expect(field.locator('.el-tag')).toHaveCount(3)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)
    await page.screenshot({path:path.join(output,`mail-recipients-${item.name}.png`),fullPage:true,animations:'disabled'})
    assert.deepEqual(errors,[])
    results.push({name:item.name,passed:true,recipients:3,duplicatesRemoved:true})
  }finally{await context.close();await browser.close()}
}
console.log(JSON.stringify(results))
server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close()
