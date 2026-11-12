<script setup>
import { nextTick, onMounted, ref } from 'vue'

const props=defineProps({api:{type:Function,required:true}})
const sites=ref([]), slug=ref(''), state=ref('CLOSED'), query=ref(''), applied=ref('')
const rows=ref([]), cursor=ref(null), back=ref([]), more=ref(false), loading=ref(false), error=ref('')
const dialog=ref(false), current=ref(null), records=ref([]), older=ref(false), detailBusy=ref(false), detailError=ref(''), transcript=ref(null)
const states={CLOSED:'已结束',OPEN:'进行中',ALL:'全部'}
const format=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—'
let revision=0, detailRevision=0

function pathFor(site,id){
  return '/support-admin/sites/'+encodeURIComponent(site)+'/conversations'+(id?'/'+id:'')
}
async function load(){
  const key=++revision
  loading.value=true;error.value=''
  try{
    if(!slug.value){rows.value=[];more.value=false;return}
    const args=new URLSearchParams({status:state.value})
    if(applied.value)args.set('id',applied.value)
    if(cursor.value)args.set('before',cursor.value)
    const result=await props.api(pathFor(slug.value)+'?'+args)
    if(key===revision){rows.value=result.conversations;more.value=result.hasMore}
  }catch(err){if(key===revision)error.value=err.message}
  finally{if(key===revision)loading.value=false}
}
onMounted(async()=>{
  loading.value=true
  try{
    sites.value=(await props.api('/support-admin/sites')).sites
    slug.value=sites.value[0]?.slug||''
    await load()
  }catch(err){error.value=err.message;loading.value=false}
})
function filter(){
  const term=query.value.trim()
  if(term&&!/^[1-9]\d{0,14}$/.test(term)){revision++;loading.value=false;rows.value=[];cursor.value=null;back.value=[];more.value=false;error.value='请输入有效的会话编号';return}
  applied.value=term
  cursor.value=null;back.value=[];rows.value=[];more.value=false;void load()
}
function move(forward){
  if(loading.value)return
  if(forward){
    if(!more.value||!rows.value.length)return
    back.value.push(cursor.value);cursor.value=rows.value[rows.value.length-1].id
  }else{
    if(!back.value.length)return
    cursor.value=back.value.pop()
  }
  void load()
}
async function view(row){
  current.value={...row,slug:slug.value}
  records.value=[];older.value=false;dialog.value=true
  await pageDetail(false)
}
function clearDetail(){
  detailRevision++;current.value=null;records.value=[];detailError.value='';detailBusy.value=false
}
async function pageDetail(history){
  if(!current.value||(!records.value.length&&history))return
  const key=++detailRevision, entry=current.value
  const path=pathFor(entry.slug,entry.id)+(history?'?before='+records.value[0].id:'')
  detailBusy.value=true;detailError.value=''
  try{
    const data=await props.api(path)
    if(key!==detailRevision||!dialog.value)return
    const height=transcript.value?.scrollHeight||0
    current.value={...entry,status:data.status,created_at:data.created_at,updated_at:data.updated_at}
    records.value=history?[...data.messages,...records.value]:data.messages
    older.value=data.hasOlder
    await nextTick()
    if(key===detailRevision&&transcript.value)transcript.value.scrollTop=history?transcript.value.scrollTop+transcript.value.scrollHeight-height:transcript.value.scrollHeight
  }catch(err){if(key===detailRevision)detailError.value=err.message}
  finally{if(key===detailRevision)detailBusy.value=false}
}
function fileUrl(id){return '/api'+pathFor(current.value.slug,current.value.id)+'/files/'+id}
</script>

<template>
  <section class="conversation-history">
    <div class="history-tools">
      <el-select v-model="slug" aria-label="筛选客服站点" placeholder="选择站点" :disabled="!sites.length" @change="filter">
        <el-option v-for="site in sites" :key="site.slug" :label="site.title+' · '+site.slug" :value="site.slug"/>
      </el-select>
      <el-select v-model="state" aria-label="会话状态" @change="filter">
        <el-option v-for="(label,key) in states" :key="key" :label="label" :value="key"/>
      </el-select>
      <form @submit.prevent="filter">
        <el-input v-model="query" aria-label="会话编号" placeholder="会话编号" maxlength="15" inputmode="numeric" clearable @clear="filter"/>
        <el-button native-type="submit" :loading="loading">查询</el-button>
      </form>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false"/>
    <p v-if="!sites.length&&!loading&&!error" class="muted">尚无客服站点。</p>
    <el-table v-else :data="rows" row-key="id" :empty-text="loading?'正在读取会话…':'没有符合条件的会话'">
      <el-table-column prop="id" label="会话编号" min-width="115"/>
      <el-table-column label="状态" min-width="100"><template #default="{row}"><el-tag :type="row.status==='CLOSED'?'info':'success'">{{ states[row.status] }}</el-tag></template></el-table-column>
      <el-table-column label="开始时间" min-width="165"><template #default="{row}">{{ format(row.created_at) }}</template></el-table-column>
      <el-table-column label="最后活动" min-width="165"><template #default="{row}">{{ format(row.updated_at) }}</template></el-table-column>
      <el-table-column label="操作" min-width="100"><template #default="{row}"><el-button link type="primary" @click="view(row)">查看会话</el-button></template></el-table-column>
    </el-table>
    <div v-if="more||back.length" class="history-pages"><el-button :disabled="!back.length||loading" @click="move(false)">上一页</el-button><el-button :disabled="!more||loading" @click="move(true)">下一页</el-button></div>
    <el-dialog v-model="dialog" :title="current?'会话 #'+current.id:'会话记录'" width="min(690px,94vw)" @closed="clearDetail">
      <template v-if="current">
        <p class="muted history-meta">{{ states[current.status] }} · {{ current.slug }} · {{ format(current.updated_at) }}</p>
        <el-alert v-if="detailError" :title="detailError" :closable="false" type="error"/>
        <div ref="transcript" class="history-transcript" role="region" aria-label="历史聊天记录" tabindex="0">
          <el-button v-if="older" class="history-earlier" text :loading="detailBusy" @click="pageDetail(true)">加载更早消息</el-button>
          <p v-if="!records.length&&!detailError" class="muted">{{ detailBusy?'正在读取消息…':'没有消息' }}</p>
          <article v-for="message in records" :key="message.id" class="history-message" :class="{outbound:message.sender==='agent'}">
            <small>{{ message.sender==='agent'?'客服':'访客' }} · {{ format(message.created_at) }}</small>
            <a v-if="message.file_name" :href="fileUrl(message.id)" download>{{ message.file_name }}</a>
            <p v-else>{{ message.content }}</p>
          </article>
        </div>
        <p class="muted history-meta">查看会话和下载附件会记入操作记录。</p>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.history-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 14px}
.history-tools>.el-select:first-child{width:min(100%,260px)}
.history-tools>.el-select:nth-child(2){width:115px}
.history-tools form{display:flex;align-items:center;gap:8px;width:min(100%,240px)}
.history-pages{margin-top:12px}
.history-meta{margin:8px 0}
.history-transcript{max-height:53vh;overflow:auto;background:#f4f7fc;border-radius:10px;padding:12px;overscroll-behavior:contain}
.history-message{max-width:min(90%,540px);width:fit-content;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #dce6f8;border-radius:10px;padding:8px 12px;margin:8px 0}
.history-message.outbound{margin-left:auto;background:#eaf2ff}
.history-message small{color:#526887}
.history-message p{margin:4px 0 0;color:#182640}
.history-message a{display:block;margin-top:4px;color:#1b53bf}
.history-earlier{display:block;margin:0 auto}
@media(max-width:560px){
  .history-tools{display:grid;grid-template-columns:minmax(0,1fr) 94px}
  .history-tools>.el-select:first-child,.history-tools>.el-select:nth-child(2),.history-tools form{width:100%}
  .history-tools form{grid-column:1/-1}
  .history-transcript{max-height:48vh;max-height:48dvh;padding:8px}
}
</style>
