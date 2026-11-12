<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { fetchWithTimeout } from './request.js'
import { fitSupportViewport } from './support-viewport.js'

const props=defineProps({slug:String,agent:Boolean})
const base='/api/support/'+props.slug+'/'
const site=ref(null), ready=ref(false), online=ref(true), fatal=ref(''), error=ref(''), note=ref('')
const authenticated=ref(false), username=ref(''), password=ref(''), busy=ref(false)
const filter=ref('OPEN'), listPage=ref(1), hasNext=ref(false), conversations=ref([]), selected=ref(null)
const status=ref(null), messages=ref([]), older=ref(false), draft=ref(''), file=ref(null)
const reporting=ref(false), reason=ref(''), sentReport=ref(false), confirmClose=ref(false)
const stream=ref(null), field=ref(null), appRoot=ref(null), newMessages=ref(0), sending=ref(false)
const prefix=computed(()=>props.agent?'agent/conversations/'+selected.value+'/':'')
let active=true,timer,generation=0,syncing=false,syncAgain=false,lastRead=0,failed=0,retryAfter=0,releaseViewport
let prepared=false,preparing=null,pendingSend=null
const clock=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit'})
const time=value=>clock.format(new Date(value))
const size=value=>value<1048576?Math.max(1,Math.ceil(value/1024))+' KB':(value/1048576).toFixed(1)+' MB'
const lastId=()=>messages.value[messages.value.length-1]?.id || 0
const bottom=()=>nextTick(()=>{ if(stream.value)stream.value.scrollTop=stream.value.scrollHeight;newMessages.value=0 })
const nearBottom=()=>!stream.value||stream.value.scrollHeight-stream.value.scrollTop-stream.value.clientHeight<100
function onScroll(){if(nearBottom())newMessages.value=0}
const newKey=()=>Array.from(window.crypto.getRandomValues(new Uint8Array(16)),value=>('0'+value.toString(16)).slice(-2)).join('')
async function request(path,{body,file:upload,key}={}) {
  const write=body!==undefined||Boolean(upload)
  const headers=write?{'X-Support-Request':'1','Content-Type':upload?'application/octet-stream':'application/json'}:{}
  if(upload) headers['X-Support-Filename']=encodeURIComponent(upload.name)
  if(key)headers['X-Support-Request-Id']=key
  return fetchWithTimeout(base+path,{method:write?'POST':'GET',headers,credentials:'same-origin',body:upload||(write?JSON.stringify(body):undefined)},upload?60000:12000,async response=>{
    let result
    try{result=await response.json()}catch{throw new Error('服务暂时不可用，请稍后重试')}
    if(!response.ok)throw Object.assign(new Error(result.message||'请求失败'),{status:response.status})
    return result
  })
}
function prepareVisitor(){
  if(!preparing)preparing=request('messages?prepare=1').then(result=>{prepared=true;return result}).finally(()=>{preparing=null})
  return preparing
}
function clearThread() {
  generation++; messages.value=[]; status.value=null; older.value=false; lastRead=0; draft.value=''; file.value=null; error.value=''; note.value=''; confirmClose.value=false; reporting.value=false; sentReport.value=false;reason.value='';newMessages.value=0;pendingSend=null
}
async function loadMessages({history=false}={}) {
  if (props.agent&&!selected.value) return
  const key=generation, path=prefix.value, first=messages.value[0]?.id, last=lastId(), pinned=nearBottom()
  const result=!props.agent&&!prepared&&!history?await prepareVisitor():await request(path+'messages'+(history?'?before='+first:last?'?after='+last:''))
  if(!active||key!==generation) return
  if(!props.agent&&selected.value&&result.id!==selected.value){clearThread();selected.value=null;prepared=false;syncAgain=true;return}
  status.value=result.status
  if(!props.agent){selected.value=result.id;sentReport.value=sentReport.value||Boolean(result.reported)}
  if(history) {
    const height=stream.value?.scrollHeight||0
    const current=new Set(messages.value.map(item=>item.id))
    messages.value=[...result.messages.filter(item=>!current.has(item.id)),...messages.value]
    older.value=result.messages.length===100
    await nextTick()
    if(stream.value&&key===generation)stream.value.scrollTop+=stream.value.scrollHeight-height
    return
  }
  if (!last) older.value=result.messages.length===100
  if (result.messages.length) {
    const previous=lastId()
    const fresh=result.messages.filter(item=>item.id>previous)
    messages.value.push(...fresh)
    if(pinned||!last) await bottom()
    else newMessages.value+=fresh.length
    if(props.agent) {
      const newest=result.messages.reduce((id,item)=>item.sender==='visitor'?Math.max(id,item.id):id,0)
      if(newest>lastRead && key===generation){
        await request(path+'read',{body:{through:newest}})
        if(key===generation)lastRead=newest
      }
    }
  }
}
async function loadList(){
  const state=filter.value, page=listPage.value
  const result=await request('agent/conversations?status='+state+'&page='+page)
  if(active&&authenticated.value&&state===filter.value&&page===listPage.value){conversations.value=result.conversations;hasNext.value=result.hasMore}
}
function handleError(err){
  if(props.agent&&err.status===401&&authenticated.value){authenticated.value=false;selected.value=null;conversations.value=[];clearThread()}
  error.value=err.name==='AbortError'?'连接超时，请重试':err instanceof TypeError?'网络中断，请重试':err.message
}
async function sync(force=false) {
  if(!active||!site.value||(!force&&document.hidden)||(props.agent&&!authenticated.value))return
  if(!force&&Date.now()<retryAfter)return
  if(!force&&!props.agent&&!selected.value)return
  if(syncing){syncAgain ||= force;return}
  syncing=true
  try{
    if(props.agent)await Promise.all([loadList(),loadMessages()])
    else await loadMessages()
    online.value=true;failed=0;retryAfter=0
  }catch(err){
    online.value=false
    failed++;retryAfter=Date.now()+Math.min(15000,1500*2**failed)
    if(err.status===401)handleError(err)
    if(err.status===404){fatal.value=err.message; site.value=null}
  }finally{
    syncing=false
    if(syncAgain){syncAgain=false;void sync(true)}
  }
}
function visibility(){if(!document.hidden)void sync(true)}
async function initialize(){
  fatal.value=''; ready.value=false
  try{
    site.value=await request('site')
    document.title=site.value.title+(props.agent?' · 客服工作台':' · 在线客服')
    if(props.agent)authenticated.value=(await request('agent/session')).authenticated
    await sync(true)
  }catch(err){fatal.value=err.message}
  finally{ready.value=true}
}
onMounted(()=>{
  releaseViewport=fitSupportViewport(appRoot.value,{beforeResize:nearBottom,afterResize:keep=>{if(keep)void bottom()}})
  void initialize()
  timer=setInterval(()=>void sync(),2500)
  document.addEventListener('visibilitychange',visibility)
  window.addEventListener('online',visibility)
  window.addEventListener('pageshow',visibility)
})
onUnmounted(()=>{active=false;clearInterval(timer);releaseViewport?.();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);window.removeEventListener('pageshow',visibility)})
async function perform(work){
  if(busy.value)return
  busy.value=true;error.value='';note.value=''
  try{await work()}catch(err){handleError(err)}
  finally{busy.value=false}
}
function login(){
  return perform(async()=>{
    try{await request('agent/login',{body:{username:username.value.trim(),password:password.value}})}
    finally{password.value=''}
    authenticated.value=true
    await sync(true)
  })
}
function logout(){
  return perform(async()=>{
    await request('agent/logout',{body:{}})
    authenticated.value=false; selected.value=null; conversations.value=[]; listPage.value=1;filter.value='OPEN';clearThread()
  })
}
function choose(id){
  if(busy.value||selected.value===id)return
  clearThread();selected.value=id;void sync(true)
}
function changeFilter(next){
  if(busy.value||filter.value===next)return
  filter.value=next;listPage.value=1;selected.value=null;conversations.value=[];clearThread();void sync(true)
}
function changePage(next){
  if(busy.value)return
  listPage.value=next;void sync(true)
}
function pick(event){
  const value=event.target.files?.[0]
  event.target.value=''
  if(!value)return
  if(value.size>site.value.attachmentLimit){error.value='附件最多 10 MB';return}
  if(!/\.(png|jpe?g|webp|pdf)$/i.test(value.name)){error.value='请选择 PNG、JPEG、WebP 或 PDF 文件';return}
  error.value='';file.value=value
}
function send(){
  const content=draft.value.trim(),upload=file.value,path=prefix.value+(upload?'attachment':'messages')
  if(busy.value||(!upload&&!content))return
  return perform(async()=>{
    sending.value=true
    try{
      if(!props.agent&&!prepared)await prepareVisitor()
      const value=upload||content
      if(pendingSend?.value!==value||pendingSend.path!==path)pendingSend={value,path,key:newKey()}
      const key=pendingSend.key
      await request(path,upload?{file:upload,key}:{body:{content},key})
      pendingSend=null
      if(upload)file.value=null;else if(draft.value.trim()===content)draft.value=''
      await sync(true);await bottom()
    }finally{sending.value=false}
  })
}
function composerKey(event){
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229||!window.matchMedia('(hover:hover) and (pointer:fine)').matches)return
  event.preventDefault();void send()
}
function showOlder(){return perform(()=>loadMessages({history:true}))}
function report(){
  return perform(async()=>{
    await request('report',{body:{reason:reason.value.trim()}})
    reporting.value=false;reason.value='';sentReport.value=true;note.value='举报已提交，等待复核。'
  })
}
function reset(){
  return perform(async()=>{
    await request('reset',{body:{}})
    clearThread();selected.value=null;prepared=true
  })
}
function closeConversation(){
  return perform(async()=>{
    await request(prefix.value+'close',{body:{}})
    status.value='CLOSED';filter.value='CLOSED';listPage.value=1;conversations.value=[];confirmClose.value=false
    await sync(true)
  })
}
</script>

<template>
  <main ref="appRoot" class="support-app" :class="{ 'agent-mode':agent }">
    <div v-if="!ready||fatal" class="support-center">
      <div class="support-card">
        <span class="support-mark" aria-hidden="true">☏</span>
        <h1>{{ fatal?'客服暂不可用':'正在连接…' }}</h1>
        <p v-if="fatal" role="alert">{{ fatal }}</p>
        <button v-if="fatal" class="support-primary" @click="initialize">重新连接</button>
      </div>
    </div>
    <div v-else-if="agent&&!authenticated" class="support-center">
      <form class="support-card support-login" @submit.prevent="login">
        <span class="support-mark" aria-hidden="true">☏</span>
        <h1>客服工作台</h1><p>{{ site.title }}</p>
        <label>客服账号<input v-model="username" autocomplete="username" maxlength="64" required></label>
        <label>密码<input v-model="password" type="password" autocomplete="current-password" maxlength="128" required></label>
        <p v-if="error" class="support-error" role="alert">{{ error }}</p>
        <button class="support-primary" :disabled="busy">登录客服工作台</button>
      </form>
    </div>
    <div v-else class="support-shell" :class="{ 'has-thread':selected }">
      <header class="support-header">
        <span class="support-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11.5h7"/></svg></span>
        <div><h1>{{ site.title }}</h1><p>{{ agent?'客服工作台':(online?'人工客服':'连接中，正在重试') }}</p></div>
        <button v-if="agent" type="button" class="support-link header-action" :disabled="busy" @click="logout">退出</button>
        <button v-else type="button" class="support-link support-report-button header-action" :aria-label="sentReport?'已举报':'举报会话'" :aria-expanded="reporting" :disabled="busy" @click="reporting=!reporting"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 21V4m0 1h10l-1 3 1 3H5" stroke-linejoin="round" stroke-linecap="round"/></svg>{{ sentReport?'已举报':'举报' }}</button>
      </header>
      <div class="support-main">
        <aside v-if="agent" class="support-list">
          <div class="support-tabs"><button :class="{current:filter==='OPEN'}" @click="changeFilter('OPEN')">进行中</button><button :class="{current:filter==='CLOSED'}" @click="changeFilter('CLOSED')">已结束</button></div>
          <p v-if="!conversations.length" class="support-muted list-empty">暂无{{ filter==='OPEN'?'进行中':'已结束' }}会话</p>
          <button v-for="row in conversations" :key="row.id" type="button" class="support-row" :class="{current:selected===row.id}" @click="choose(row.id)">
            <strong>访客 #{{ row.id }}</strong><span>{{ time(row.updated_at) }}</span><small v-if="row.unread">未读</small>
          </button>
          <div v-if="listPage>1||hasNext" class="support-pages">
            <button class="support-link" :disabled="listPage===1" @click="changePage(listPage-1)">上一页</button><span>{{ listPage }}</span><button class="support-link" :disabled="!hasNext" @click="changePage(listPage+1)">下一页</button>
          </div>
        </aside>
        <section v-if="!agent||selected" class="support-thread" aria-label="聊天会话">
          <div v-if="agent" class="support-thread-bar">
            <button class="support-link mobile-back" :disabled="busy" @click="choose(null)">返回</button><strong>访客 #{{ selected }}</strong>
            <button v-if="status==='OPEN'&&!confirmClose" class="support-link header-action" :disabled="busy" @click="confirmClose=true">结束会话</button>
            <template v-if="confirmClose"><button class="support-link header-action" :disabled="busy" @click="confirmClose=false">取消</button><button class="support-danger" :disabled="busy" @click="closeConversation">确认结束</button></template>
          </div>
          <div v-if="reporting&&(!selected||sentReport)" class="support-report support-report-note" role="status"><span>{{ sentReport?'举报已提交，等待复核。':'发起会话后即可举报。' }}</span><button type="button" class="support-link" @click="reporting=false">知道了</button></div>
          <form v-else-if="reporting" class="support-report" @submit.prevent="report">
            <label for="support-reason">举报原因</label>
            <textarea id="support-reason" v-model="reason" maxlength="300" rows="2" placeholder="简述问题，请勿填写证件号或密码" required></textarea>
            <div><button type="button" class="support-link" @click="reporting=false">取消</button><button class="support-primary" :disabled="busy||!reason.trim()">提交举报</button></div>
          </form>
          <div ref="stream" class="support-stream" role="log" aria-label="聊天消息" @scroll.passive="onScroll">
            <button v-if="older" class="support-link history" :disabled="busy" @click="showOlder">加载更早消息</button>
            <div v-if="!agent&&!messages.length" class="support-welcome"><span aria-hidden="true">✦</span><strong>你好，有什么可以帮你？</strong></div>
            <article v-for="item in messages" :key="item.id" class="support-message" :class="{mine:item.sender===(agent?'agent':'visitor')}">
              <span class="support-message-meta">{{ item.sender==='agent'?'客服':'访客' }} · {{ time(item.created_at) }}</span>
              <div class="support-bubble">
                <a v-if="item.file_name" :href="base+prefix+'files/'+item.id" download class="support-file"><span aria-hidden="true">↧</span><span>{{ item.file_name }}<small>{{ size(item.file_size) }} · 下载附件</small></span></a>
                <span v-else>{{ item.content }}</span>
              </div>
            </article>
          </div>
          <button v-if="newMessages" type="button" class="support-link support-new-messages" @click="bottom">↓ {{ newMessages }} 条新消息</button>
          <p v-if="error" class="support-feedback support-error" role="alert">{{ error }}</p>
          <p v-else-if="note" class="support-feedback" role="status">{{ note }}</p>
          <p v-else-if="!online" class="support-feedback support-muted" role="status">网络暂时中断，正在重连…</p>
          <div v-if="status==='CLOSED'" class="support-closed">会话已结束 <button v-if="!agent" class="support-link" :disabled="busy" @click="reset">开始新会话</button></div>
          <form v-else-if="!agent||status==='OPEN'" class="support-composer" @submit.prevent="send">
            <div v-if="file" class="support-staged"><span>{{ file.name }} · {{ size(file.size) }}</span><button type="button" class="support-link" :disabled="busy" @click="file=null">移除</button></div>
            <div class="support-compose-row">
              <input ref="field" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" hidden @change="pick">
              <button type="button" class="support-attach" aria-label="添加附件" title="添加附件：PNG、JPEG、WebP、PDF，最多 10 MB" :disabled="busy" @click="field.click()"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 13 6-6a2 2 0 0 1 3 3l-7 7a4 4 0 0 1-6-6l8-8a5 5 0 0 1 7 7l-8 8"/></svg></button>
              <textarea v-model="draft" aria-label="消息内容" maxlength="4000" rows="1" :placeholder="file?'附件将单独发送':'输入消息…'" :readonly="Boolean(file)" @keydown="composerKey"></textarea>
              <button class="support-primary" :disabled="busy||(!file&&!draft.trim())">{{ sending?'发送中…':'发送' }}</button>
            </div>
            <p v-if="!agent" class="support-disclosure">{{ site.aiCheck?'客服消息脱敏后可能接受 AI 辅助审核':'会话可能接受安全审核' }} · <a :href="site.privacyUrl" target="_blank" rel="noopener noreferrer">隐私说明</a></p>
          </form>
        </section>
        <div v-else class="support-placeholder" role="status">{{ error||'选择一个会话开始接待' }}</div>
      </div>
    </div>
  </main>
</template>

<style src="./support.css"></style>
