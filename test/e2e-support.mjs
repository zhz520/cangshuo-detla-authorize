import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {mkdirSync,readFileSync} from 'node:fs'
import path from 'node:path'
import {chromium,webkit,devices} from 'playwright'
import {expect} from 'playwright/test'
import {AuthorityStore} from '../server/store.mjs'
import {createAuthorityServer} from '../server/http.mjs'

const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const ownerPassword='Local-owner-fixture-2026',agentPassword='Local-agent-fixture-2026'
const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword})
store.createCustomer({id:'demo-company',name:'演示公司'},'fixture')
const server=createAuthorityServer(store,{staticDirectory:path.resolve('dist')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const profile=process.env.SUPPORT_E2E_PROFILE||'desktop'
const mobile=profile!=='desktop', ios=profile.startsWith('ios')
const device=devices[ios?(profile==='ios-small'?'iPhone SE':'iPhone 13'):'Pixel 7']
const uaSuffix=profile.endsWith('wechat')?' MicroMessenger/8.0.60':profile.endsWith('qq')?' QQ/9.1.0':''
const mobileOptions={...device,userAgent:device.userAgent+uaSuffix,...(profile==='ios-small'?{viewport:{width:320,height:568}}:{})}
let browser
try{
  browser=await (ios?webkit:chromium).launch({headless:true,...(!ios&&process.env.E2E_CHROMIUM_EXECUTABLE?{executablePath:process.env.E2E_CHROMIUM_EXECUTABLE}:{})})
  const desktop={viewport:{width:1366,height:900}}
  const operator=await (await browser.newContext(desktop)).newPage()
  const agent=await (await browser.newContext(mobile?mobileOptions:desktop)).newPage()
  const visitor=await (await browser.newContext(mobile?mobileOptions:desktop)).newPage()
  const other=await (await browser.newContext(mobile?mobileOptions:desktop)).newPage()
  if(mobile)await visitor.addInitScript(()=>{
    let simulatedHeight=null
    const view=Object.assign(new EventTarget(),{offsetTop:0,scale:1})
    Object.defineProperty(view,'height',{get:()=>simulatedHeight??window.innerHeight,set:value=>{simulatedHeight=value}})
    Object.defineProperty(window,'visualViewport',{configurable:true,value:view})
  })
  const errors=[]
  for(const page of [operator,agent,visitor,other]){
    page.setDefaultTimeout(10000)
    page.on('pageerror',error=>errors.push(error.message))
  }
  await operator.goto(base)
  await operator.getByRole('textbox').first().fill('owner')
  await operator.locator('input[type=password]').fill(ownerPassword)
  await operator.getByRole('button',{name:'登录运营后台'}).click()
  await operator.getByRole('button',{name:'在线客服',exact:true}).click()
  await operator.getByRole('button',{name:'新增客服站点'}).click()
  const dialog=operator.getByRole('dialog')
  await dialog.locator('.el-form-item').filter({hasText:'客户公司'}).getByRole('combobox').click()
  await operator.getByRole('option',{name:'演示公司'}).click()
  await dialog.getByPlaceholder('例如 acme-support，创建后不变').fill('demo-support')
  await dialog.getByPlaceholder('例如 XX 公司在线客服').fill('演示公司在线客服')
  await dialog.getByLabel('客服账号').fill('agent')
  await dialog.getByPlaceholder('至少 16 个字符').fill(agentPassword)
  await dialog.getByPlaceholder('https://…').fill('https://example.com/privacy')
  await dialog.getByText('遮盖常见敏感信息',{exact:true}).click()
  await operator.getByRole('option',{name:'发送原文片段（不遮盖）'}).click()
  await dialog.locator('.el-form-item').filter({hasText:'开放聊天入口'}).locator('.el-switch').click()
  await dialog.getByRole('button',{name:'保存站点'}).click()
  await expect(operator.getByRole('link',{name:'访客聊天'})).toHaveAttribute('href','/chat/demo-support')
  for(const route of ['/chat/demo-support','/chat/demo-support/agent']){
    const html=await (await fetch(base+route)).text()
    assert.match(html,/<title>在线客服<\/title>/)
    assert.doesNotMatch(html,/授权运营中心|authority-ui/)
  }
  assert.match(await (await fetch(base+'/')).text(),/<title>沧烁 · 授权运营中心<\/title>/)
  if(profile==='desktop'){
    const slow=await (await browser.newContext(desktop)).newPage()
    let allowAssets
    const gate=new Promise(resolve=>{allowAssets=resolve})
    await slow.route('**/assets/*.js',async route=>{await gate;await route.continue()})
    try{
      await slow.goto(base+'/chat/demo-support',{waitUntil:'commit'})
      await expect(slow.getByRole('status')).toHaveText('正在打开客服…')
      await expect(slow).toHaveTitle('在线客服')
    }finally{allowAssets()}
    await expect(slow.getByRole('heading',{name:'演示公司在线客服'})).toBeVisible()
    await slow.context().close()
  }
  await visitor.goto(base+'/chat/demo-support')
  await other.goto(base+'/chat/demo-support')
  await expect(visitor.getByRole('heading',{name:'演示公司在线客服'})).toBeVisible()
  await expect(visitor.getByRole('link',{name:'隐私说明'})).toBeVisible()
  const flag=visitor.getByRole('button',{name:'举报会话'})
  await expect(flag).toHaveText('举报')
  await flag.click()
  await expect(visitor.getByText('发起会话后即可举报。')).toBeVisible()
  await visitor.getByRole('button',{name:'知道了'}).click()
  assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(mobile){
    await visitor.getByRole('textbox',{name:'消息内容'}).focus()
    await visitor.evaluate(()=>{window.visualViewport.height=300;window.visualViewport.offsetTop=12;window.visualViewport.dispatchEvent(new Event('resize'))})
    await expect.poll(async()=>{const box=await visitor.getByRole('button',{name:'发送',exact:true}).boundingBox();return box.y+box.height}).toBeLessThanOrEqual(313)
    await visitor.evaluate(()=>{window.visualViewport.height=null;window.visualViewport.offsetTop=0;window.visualViewport.dispatchEvent(new Event('resize'))})
  }
  async function send(page,message){
    await page.getByRole('textbox',{name:'消息内容'}).fill(message)
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await expect(page.getByText(message,{exact:true})).toBeVisible()
  }
  if(profile==='desktop'){
    let lostReply=false
    await visitor.route('**/api/support/demo-support/messages',async route=>{
      if(route.request().method()!=='POST'||lostReply)return route.continue()
      lostReply=true
      await route.fetch()
      await route.abort('failed')
    })
    await visitor.getByRole('textbox',{name:'消息内容'}).fill('访客甲：需要售后帮助')
    await visitor.getByRole('button',{name:'发送',exact:true}).click()
    await expect(visitor.getByText('网络中断，请重试')).toBeVisible()
  }
  await send(visitor,'访客甲：需要售后帮助')
  await expect(visitor.getByText('访客甲：需要售后帮助',{exact:true})).toHaveCount(1)
  await send(other,'访客乙：咨询工作时间')
  await agent.goto(base+'/chat/demo-support/agent')
  await agent.getByLabel('客服账号').fill('agent')
  await agent.getByLabel('密码').fill(agentPassword)
  await agent.getByRole('button',{name:'登录客服工作台'}).click()
  await agent.getByRole('button',{name:/访客 #1/}).click()
  await expect(agent.getByText('访客甲：需要售后帮助',{exact:true})).toBeVisible()
  await send(agent,'请提供订单号，我来帮你核对')
  await expect(visitor.getByText('请提供订单号，我来帮你核对')).toBeVisible()
  await expect(other.getByText('请提供订单号，我来帮你核对')).toHaveCount(0)
  await visitor.reload()
  await expect(visitor.getByText('访客甲：需要售后帮助')).toBeVisible()
  await visitor.locator('input[type=file]').setInputFiles({name:'售后说明.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')})
  await visitor.getByRole('button',{name:'发送',exact:true}).click()
  const download=agent.getByRole('link',{name:/售后说明.pdf/})
  await expect(download).toBeVisible()
  const downloaded=agent.waitForEvent('download')
  await download.click()
  const saved=await downloaded
  assert((ios?['售后说明.pdf','attachment.pdf']:['售后说明.pdf']).includes(saved.suggestedFilename()))
  assert.deepEqual(readFileSync(await saved.path()),Buffer.from('%PDF-1.4\n%%EOF'))
  await visitor.getByRole('button',{name:'举报会话'}).click()
  await visitor.getByLabel('举报原因').fill('首版举报流程测试')
  await visitor.getByRole('button',{name:'提交举报'}).click()
  await expect(visitor.getByText('举报已提交，等待复核。')).toBeVisible()
  await visitor.reload()
  await expect(visitor.getByRole('button',{name:'已举报'})).toBeVisible()
  await operator.getByRole('button',{name:'风险告警'}).click()
  await expect(operator.getByText('访客举报该会话')).toBeVisible()
  await operator.getByRole('button',{name:'查看摘要'}).click()
  await expect(operator.getByText('首版举报流程测试')).toBeVisible()
  await operator.getByPlaceholder('记录判断依据，避免填写访客身份信息').fill('测试告警，已排除')
  await operator.getByRole('button',{name:'排除告警'}).click()
  await expect(operator.getByText('没有该状态的告警')).toBeVisible()
  await operator.getByRole('button',{name:'审核与通知'}).click()
  await expect(operator.getByText('待配置运营邮箱',{exact:true})).toBeVisible()
  await expect(operator.getByRole('button',{name:'测试已保存的模型'})).toBeDisabled()
  await visitor.emulateMedia({reducedMotion:'reduce'})
  assert.equal(await visitor.locator('.support-shell').evaluate(node=>getComputedStyle(node).animationName),'none')
  if(process.env.E2E_OUTPUT){
    const output=path.resolve(process.env.E2E_OUTPUT)
    if(process.platform==='win32')assert(/^D:[\\/]/i.test(output),'Artifacts must remain on D:')
    mkdirSync(output,{recursive:true})
    await visitor.screenshot({path:path.join(output,'visitor-h5.png')})
    await agent.screenshot({path:path.join(output,'agent-desktop.png')})
  }
  await agent.getByRole('button',{name:'结束会话',exact:true}).click()
  await agent.getByRole('button',{name:'确认结束'}).click()
  await expect(visitor.getByRole('button',{name:'开始新会话'})).toBeVisible()
  if(mobile)await agent.getByRole('button',{name:'返回',exact:true}).click()
  await agent.getByRole('button',{name:'进行中',exact:true}).click()
  await expect(agent.getByRole('button',{name:/访客 #1/})).toHaveCount(0)
  await agent.getByRole('button',{name:'已结束',exact:true}).click()
  await agent.getByRole('button',{name:/访客 #1/}).click()
  await expect(agent.getByText('访客甲：需要售后帮助',{exact:true})).toBeVisible()
  await operator.getByRole('button',{name:'会话记录',exact:true}).click()
  await operator.getByRole('button',{name:'查看会话'}).click()
  const history=operator.getByRole('region',{name:'历史聊天记录'})
  await expect(history.getByText('访客甲：需要售后帮助',{exact:true})).toBeVisible()
  await expect(history.getByRole('link',{name:'售后说明.pdf'})).toBeVisible()
  await operator.setViewportSize({width:360,height:720})
  assert.equal(await operator.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)
  assert.deepEqual(errors,[])
  console.log('PASS '+profile+': layout, visible report, reply, attachments and closed history')
}finally{
  await browser?.close()
  await new Promise(resolve=>server.close(resolve))
  store.close()
}
