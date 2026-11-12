import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { createAuthorityServer } from '../server/http.mjs'

test('support keeps owner, customer agents and anonymous visitors isolated',async()=>{
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const ownerPassword='Fixture-owner-only-2026', agentPassword='Fixture-agent-only-2026'
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword})
  store.createCustomer({id:'alpha',name:'甲公司'},'fixture')
  store.createCustomer({id:'beta',name:'乙公司'},'fixture')
  const old=store.lists()
  const server=createAuthorityServer(store)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  function client(){
    const cookies=new Map()
    let csrf=''
    return {cookies,async call(path,{method='GET',body,upload,filename,status=200,origin,header=true,csrfHeader=true,key,fetchSite}={}){
      const headers={Cookie:[...cookies.values()].join('; ')}
      if(method!=='GET'){
        headers['Content-Type']=upload?'application/octet-stream':'application/json'
        if(header)headers['X-Support-Request']='1'
        if(csrfHeader&&csrf)headers['X-CSRF-Token']=csrf
        if(upload)headers['X-Support-Filename']=encodeURIComponent(filename)
      }
      if(origin)headers.Origin=origin
      if(key)headers['X-Support-Request-Id']=key
      if(fetchSite)headers['Sec-Fetch-Site']=fetchSite
      const response=await fetch(base+path,{method,headers,body:upload||(body!==undefined?JSON.stringify(body):undefined)})
      const setCookie=response.headers.get('set-cookie')
      if(setCookie){
        const key=setCookie.split('=')[0]
        if(/Max-Age=0/.test(setCookie))cookies.delete(key)
        else cookies.set(key,setCookie.split(';')[0])
        assert.match(setCookie,/HttpOnly; SameSite=Strict/)
      }
      const data=response.headers.get('content-type').startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer())
      assert.equal(response.status,status,path+': '+JSON.stringify(data))
      if(data.csrf)csrf=data.csrf
      return {data,response}
    }}
  }
  const owner=client(), a=client(), b=client(), other=client(), agent=client(), agent2=client()
  const s='/api/support/alpha-chat/', s2='/api/support/beta-chat/', admin='/api/support-admin/'
  const post=(body,status=200)=>({method:'POST',body,status})
  const login=post({username:'agent',password:agentPassword})
  const site={slug:'alpha-chat',customerId:'alpha',title:'甲公司客服',privacyUrl:'https://example.com/privacy',agentUsername:'agent',password:agentPassword,blockedDomains:'blocked.example',enabled:true}
  try{
    assert.deepEqual(store.lists(),old,'additive migration must preserve legacy data')
    await a.call(s+'site',{status:404})
    await a.call(admin+'sites',{status:401})
    await owner.call('/api/login',post({username:'owner',password:ownerPassword}))
    await owner.call(admin+'sites',{...post(site,403),csrfHeader:false})
    await owner.call(admin+'sites',post(site,201))
    await owner.call(admin+'sites',post({...site,slug:'beta-chat',customerId:'beta',title:'乙公司客服'},201))
    assert.equal((await a.call(s+'site')).data.title,'甲公司客服')
    assert.equal((await a.call(s+'messages')).data.id,null)
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM support_conversations').get().n,0)
    await a.call(s+'messages',{...post({content:'禁止跨来源'},403),origin:'https://evil.example'})
    await a.call(s+'messages',{...post({content:'缺校验标记'},403),header:false})
    await a.call(s+'messages',{...post({content:'禁止同站跨来源写入'},403),fetchSite:'same-site'})
    const prepared=await a.call(s+'messages?prepare=1')
    assert.match(prepared.response.headers.get('set-cookie'),/support_visitor=[\w-]{43}\.\d{13}\.[\w-]{43};/)
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM support_conversations').get().n,0)
    const seed=a.cookies.get('support_visitor'), key='a'.repeat(32)
    const first=(await a.call(s+'messages',{...post({content:'甲访客咨询'},201),key})).data
    a.cookies.set('support_visitor',seed) // Reply was lost before the browser could accept the replacement cookie.
    const duplicate=(await a.call(s+'messages',{...post({content:'甲访客咨询'},201),key})).data
    assert.deepEqual(duplicate,first)
    await a.call(s+'messages',{...post({content:'不同内容不能重用编号'},409),key})
    assert.equal((await a.call(s+'messages')).data.messages.length,1)
    const second=(await b.call(s+'messages',post({content:'同一 IP 的乙访客'},201))).data
    assert.notEqual(first.conversationId,second.conversationId)
    const third=(await other.call(s2+'messages',post({content:'另一公司访客'},201))).data
    assert.equal((await b.call(s+'messages')).data.messages[0].content,'同一 IP 的乙访客')
    assert.equal((await a.call(s2+'messages')).data.id,null)
    await a.call(s+'agent/conversations',{status:401})
    await agent.call(s+'agent/login',login)
    await agent2.call(s2+'agent/login',login)
    assert.equal((await agent.call(s+'agent/conversations')).data.conversations.length,2)
    await agent.call(admin+'alerts',{status:401})
    await agent.call('/api/data',{status:401})
    await agent.call(s2+'agent/conversations',{status:401})
    await agent2.call(s2+'agent/conversations/'+first.conversationId+'/messages',{status:404})
    const thread=s+'agent/conversations/'+first.conversationId+'/'
    await agent.call(thread+'read',post({through:first.id}))
    assert.equal((await agent.call(s+'agent/conversations')).data.conversations.find(row=>row.id===first.conversationId).unread,0)
    await agent.call(thread+'messages',post({content:'您好，请问需要什么帮助？'},201))
    const polled=(await a.call(s+'messages?after='+first.id)).data
    assert.equal(polled.messages.length,1)
    assert.equal(polled.messages[0].sender,'agent')
    assert.equal((await b.call(s+'messages?after='+second.id)).data.messages.length,0)
    const file=Buffer.from('%PDF-1.4\n%%EOF')
    const upload={method:'POST',upload:file,filename:'测试.pdf',status:201}
    await a.call(s+'attachment',{...upload,filename:'测试.svg',status:415})
    await a.call(s+'attachment',{...upload,upload:Buffer.from('%PDF-1.4\n无结尾标记'),status:415})
    await a.call(s+'attachment',{...upload,upload:Buffer.alloc(10*1024*1024+1),status:413})
    const attachment=(await a.call(s+'attachment',upload)).data
    await b.call(s+'files/'+attachment.id,{status:404})
    await agent2.call(s2+'agent/conversations/'+third.conversationId+'/files/'+attachment.id,{status:404})
    const download=await agent.call(thread+'files/'+attachment.id)
    assert.deepEqual(download.data,file)
    assert.match(download.response.headers.get('content-disposition'),/^attachment;/)
    await agent.call(thread+'messages',post({content:'查看 https://sub.blocked.example/test'},422))
    await agent.call(thread+'messages',post({content:'请把验证码发给我 13812345678'},201))
    await a.call(s+'report',post({reason:'客服索要验证码'}))
    await a.call(s+'report',post({reason:'再次举报'}))
    const alerts=(await owner.call(admin+'alerts')).data.alerts
    assert.deepEqual(new Set(alerts.map(row=>row.code)),new Set(['visitor_report','blocked_domain','credential_request']))
    assert.equal(alerts.length,3)
    assert.equal(alerts.some(row=>'excerpt' in row),false)
    const risk=alerts.find(row=>row.code==='credential_request')
    const excerpt=(await owner.call(admin+'alerts/'+risk.id)).data.excerpt
    assert.doesNotMatch(excerpt,/13812345678/)
    await owner.call(admin+'alerts/'+risk.id,{method:'PUT',body:{status:'CONFIRMED',resolution:'复核模拟场景'}})
    assert.equal((await owner.call(admin+'alerts?status=CONFIRMED')).data.alerts[0].id,risk.id)
    assert(store.db.prepare("SELECT 1 FROM audit WHERE action='VIEW_SUPPORT_ALERT' AND target=?").get(String(risk.id)))
    await agent.call(thread+'close',post({}))
    assert.equal((await a.call(s+'messages')).data.status,'CLOSED')
    assert.equal((await agent.call(s+'agent/conversations?status=CLOSED')).data.conversations[0].id,first.conversationId)
    assert.deepEqual((await agent.call(thread+'files/'+attachment.id)).data,file)
    const history=admin+'sites/alpha-chat/conversations'
    await agent.call(history,{status:401})
    await a.call(history+'/'+first.conversationId,{status:401})
    assert.deepEqual((await owner.call(history)).data.conversations.map(row=>row.id),[first.conversationId])
    assert.equal((await owner.call(history+'?status=ALL&id='+second.conversationId)).data.conversations[0].status,'OPEN')
    const transcript=(await owner.call(history+'/'+first.conversationId)).data
    assert.equal(transcript.status,'CLOSED')
    assert(transcript.messages.some(row=>row.content==='甲访客咨询'))
    assert.equal('visitor_hash' in transcript,false)
    assert.deepEqual((await owner.call(history+'/'+first.conversationId+'/files/'+attachment.id)).data,file)
    await owner.call(history+'/'+second.conversationId+'/files/'+attachment.id,{status:404})
    await owner.call(admin+'sites/beta-chat/conversations/'+first.conversationId,{status:404})
    assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action IN ('VIEW_SUPPORT_CONVERSATION','DOWNLOAD_SUPPORT_ATTACHMENT')").get().n,2)
    await a.call(s+'messages',post({content:'已结束不允许发送'},409))
    await a.call(s+'reset',post({}))
    const renewed=(await a.call(s+'messages',post({content:'开启新会话'},201))).data
    assert.notEqual(first.conversationId,renewed.conversationId)
    await a.call(s+'files/'+attachment.id,{status:404})
    await owner.call(admin+'sites/alpha-chat',{method:'PUT',body:{...site,password:'Fixture-rotated-only-2026'}})
    await agent.call(s+'agent/conversations',{status:401})
    assert.equal((await a.call(s+'messages')).data.id,renewed.conversationId)
    await owner.call(admin+'sites/alpha-chat',{method:'PUT',body:{...site,password:'',enabled:false}})
    await a.call(s+'messages',{status:404})
    assert.equal((await owner.call(history+'/'+first.conversationId)).data.messages.length,transcript.messages.length)
    assert.equal((await other.call(s2+'messages')).data.id,third.conversationId)
    assert.deepEqual(store.lists().customers,old.customers)
    assert.deepEqual(store.lists().modules,old.modules)
  }finally{
    await new Promise(resolve=>server.close(resolve));store.close()
  }
})
