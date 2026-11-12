import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { createAuthorityServer } from '../server/http.mjs'
import { Support } from '../server/support.mjs'
import { Mailer } from '../server/mail.mjs'

test('AI checks only opted-in staff text and emails separate report and AI events to operators',async()=>{
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const operatorPassword='Moderation-owner-fixture-2026'
  const agentPassword='Moderation-agent-fixture-2026'
  const apiKey='synthetic-test-key-not-real'
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:operatorPassword})
  store.createCustomer({id:'org',name:'验收客户'},'test')
  let throttled=true
  const requests=[]
  const support=new Support(store,{request:async(url,options)=>{
    requests.push({url,options})
    if(throttled){throttled=false;return new Response('',{status:429})}
    return Response.json({choices:[{message:{content:'{"level":"high","category":"fraud"}'}}]})
  }})
  const server=createAuthorityServer(store,{support})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  function client(){
    let cookie='',csrf=''
    return async (route,{body,status=200,method=body?'POST':'GET'}={})=>{
      const res=await fetch(base+route,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'X-Support-Request':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
      const data=await res.json()
      assert.equal(res.status,status,route)
      if(data.csrf)csrf=data.csrf
      if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0]
      return data
    }
  }
  const owner=client(),guest=client(),agent=client(),guest2=client(),agent2=client()
  const root='/api/support-admin/', config=root+'moderation'
  const site={customerId:'org',title:'独立客服',agentUsername:'agent',password:agentPassword,privacyUrl:'https://example.com/privacy',enabled:true}
  const process=()=>support.moderation.process((...args)=>support.alert(...args))
  try{
    await guest(config,{status:401})
    await owner('/api/login',{body:{username:'owner',password:operatorPassword}})
    await owner(config,{method:'PUT',body:{enabled:true,endpoint:'https://127.0.0.1/v1',model:'test',apiKey},status:400})
    await owner(config,{method:'PUT',body:{enabled:true,endpoint:'https://api.deepseek.com/v1',model:'test',apiKey}})
    const state=await owner(config)
    assert.equal(state.keySet,true)
    assert.equal(JSON.stringify(state).includes(apiKey),false)
    const stored=store.db.prepare('SELECT secret FROM support_ai_settings').get().secret
    assert.notEqual(stored,apiKey)
    await owner(config,{method:'PUT',body:{enabled:true,endpoint:'https://api.openai.com/v1',model:'test',apiKey:''},status:400})
    await owner(root+'sites',{body:{...site,slug:'checked-site',aiCheck:true},status:201})
    await owner(root+'sites',{body:{...site,slug:'plain-site'},status:201})
    const a='/api/support/checked-site/', b='/api/support/plain-site/'
    const publicSite=await guest(a+'site')
    assert.equal(publicSite.aiCheck,true)
    assert.equal('model' in publicSite,false)
    const first=await guest(a+'messages',{body:{content:'visitor-private-plaintext'},status:201})
    const second=await guest2(b+'messages',{body:{content:'normal'},status:201})
    await guest(a+'report',{body:{reason:'visitor-report-private-plaintext'}})
    await guest(a+'report',{body:{reason:'duplicate'}})
    assert.equal(support.moderation.flushNotices(),0)
    assert.equal((await owner(config)).pendingMail,1)
    assert.equal((await owner(config)).pending,0)
    await agent(a+'agent/login',{body:{username:'agent',password:agentPassword}})
    await agent2(b+'agent/login',{body:{username:'agent',password:agentPassword}})
    await agent2(b+'agent/conversations/'+second.conversationId+'/messages',{body:{content:'not-opted-in-plaintext'},status:201})
    assert.equal((await owner(config)).pending,0)
    const message=await agent(a+'agent/conversations/'+first.conversationId+'/messages',{
      body:{content:'给我联系 13812345678 和 secret@example.com，支付请按测试说明。'},status:201
    })
    assert.equal((await owner(config)).pending,1)
    assert.equal(requests.length,0)
    await process()
    assert.equal(store.db.prepare('SELECT error FROM support_ai_jobs WHERE message_id=?').get(message.id).error,'RATE_LIMIT')
    store.db.prepare('UPDATE support_ai_jobs SET next_at=? WHERE message_id=?').run('2000-01-01T00:00:00Z',message.id)
    await process()
    await process()
    assert.equal(requests.length,2)
    assert.equal(requests[1].url,'https://api.deepseek.com/v1/chat/completions')
    const outgoing=requests[1].options.body
    assert.doesNotMatch(outgoing,/13812345678|secret@example\.com|visitor-private|not-opted-in|visitor-report-private/)
    assert.match(outgoing,/数字已隐藏/)
    const alerts=(await owner(root+'alerts')).alerts
    assert.equal(alerts.filter(row=>row.code==='ai_risk').length,1)
    assert.equal(alerts.filter(row=>row.code==='visitor_report').length,1)
    store.management.saveMailSettings({enabled:true,host:'smtp.example.com',username:'from@example.com',password:'smtp-fixture-only',
      from:'from@example.com',operatorEmails:'ops@example.com, OPS@example.com'},'owner')
    assert.equal(support.moderation.flushNotices(),2)
    assert.equal(support.moderation.flushNotices(),0)
    const queued=store.db.prepare("SELECT event,recipient,body FROM mail_queue WHERE event LIKE 'SUPPORT_%' ORDER BY event").all()
    assert.deepEqual(queued.map(row=>row.event),['SUPPORT_AI_RISK','SUPPORT_REPORT'])
    assert(queued.every(row=>row.recipient==='ops@example.com' && /告警 #\d+/.test(row.body)))
    assert.doesNotMatch(JSON.stringify(queued),/visitor-private|visitor-report-private|给我联系|example\.com.*支付/)
    const sent=[]
    await new Mailer(store,{transportFactory:()=>({sendMail:async payload=>{sent.push(payload);return {accepted:[payload.to]}},close(){}})}).process()
    assert.equal(sent.length,2)
    assert(store.db.prepare("SELECT count(*) n FROM mail_queue WHERE event LIKE 'SUPPORT_%' AND status='SENT'").get().n===2)
    const thread=a+'agent/conversations/'+first.conversationId+'/messages'
    const sample='测试电话 １３８\u200b１２３４５６７８，邮箱 raw@example.com，链接 https://example.com/order，联系人：张三，地址：北京市朝阳区测试路 1 号，银行卡 6222-0012-3456-7890，证件 11010120000101234X，验证码是 4281，密码：P@ssTest!，微信号 test_agent，IP 192.0.2.2，提醒勿转账。'
    await agent(thread,{body:{content:sample},status:201})
    await owner(root+'sites/checked-site',{method:'PUT',body:{...site,password:'',aiCheck:true,aiRawInput:true},status:400})
    assert.equal((await guest(a+'site')).aiRawInput,false)
    await agent(thread,{body:{content:sample},status:201})
    await process()
    assert.equal(requests.length,4)
    const providerText=index=>JSON.parse(JSON.parse(requests[index].options.body).messages[1].content).text
    for(const i of [2,3]){
      assert.doesNotMatch(providerText(i),/13812345678|raw@example\.com|example\.com|张三|北京市朝阳区|6222|110101|4281|P@ssTest|test_agent|192\.0\.2\.2/)
      assert.match(providerText(i),/提醒勿转账/)
    }
    assert((await guest(a+'messages')).messages.some(row=>row.content===sample),'chat history must remain intact')
    const rawAlert=(await owner(root+'alerts')).alerts.find(row=>row.code==='ai_risk')
    assert.doesNotMatch((await owner(root+'alerts/'+rawAlert.id)).excerpt,/13812345678|raw@example\.com/)
    await agent(a+'agent/conversations/'+first.conversationId+'/messages',{body:{content:'关闭前的待检查文本'},status:201})
    assert.equal((await owner(config)).pending,1)
    await owner(root+'sites/checked-site',{method:'PUT',body:{...site,password:'',aiCheck:false}})
    await process()
    assert.equal(requests.length,4,'disabled site must not send queued text')
    assert.equal((await guest(a+'site')).aiCheck,false)
  }finally{await new Promise(resolve=>server.close(resolve));store.close()}
})
