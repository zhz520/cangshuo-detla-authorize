<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import SupportHistory from './SupportHistory.vue'

const props=defineProps({api:Function,customers:Array})
const sites=ref([]), alerts=ref([]), status=ref('OPEN'), tab=ref('sites'), busy=ref(false), saving=ref(false), error=ref('')
const editing=ref(null), siteDialog=ref(false), selected=ref(null), detail=ref(null), reviewDialog=ref(false), resolution=ref('')
const hasMore=ref(false), previous=ref([]), before=ref(null)
const form=reactive({ slug:'',customerId:'',title:'',agentUsername:'',password:'',privacyUrl:'',blockedDomains:'',enabled:false,aiCheck:false })
const moderation=ref(null), modelForm=reactive({ enabled:false,endpoint:'',model:'',apiKey:'' })
const activeCustomers=computed(()=>props.customers.filter(row=>row.status==='ACTIVE'))
const statuses={OPEN:'待复核',CONFIRMED:'已确认',DISMISSED:'已排除'}
const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—'
const sitePath=row=>'/chat/'+row.slug
const supportMetrics=computed(()=>[
  {label:'客服站点',value:sites.value.length,detail:'已开通的客户客服入口'},
  {label:'已开放',value:sites.value.filter(row=>row.enabled&&row.customer_status==='ACTIVE').length,detail:'当前可访问站点'},
  {label:'待复核告警',value:alerts.value.filter(row=>row.status==='OPEN').length,detail:'当前告警列表中的线索'}
])
let revision=0
async function refresh(){
  const id=++revision
  busy.value=true;error.value=''
  try{
    if(tab.value==='sites'){
      const result=await props.api('/support-admin/sites')
      if(id===revision)sites.value=result.sites
    }else if(tab.value==='moderation'){
      const result=await props.api('/support-admin/moderation')
      if(id===revision){moderation.value=result;Object.assign(modelForm,{enabled:result.enabled,endpoint:result.endpoint,model:result.model,apiKey:''})}
    }else{
      const result=await props.api('/support-admin/alerts?status='+status.value+(before.value?'&before='+before.value:''))
      if(id===revision){alerts.value=result.alerts;hasMore.value=result.hasMore}
    }
  }catch(err){if(id===revision)error.value=err.message}
  finally{if(id===revision)busy.value=false}
}
onMounted(refresh)
function switchTab(next){if(tab.value===next)return;modelForm.apiKey='';tab.value=next;if(next==='history'){revision++;busy.value=false;error.value=''}else refresh()}
function resetAlerts(){before.value=null;previous.value=[];refresh()}
function nextPage(){
  if(!hasMore.value||busy.value||!alerts.value.length)return
  previous.value.push(before.value)
  before.value=alerts.value[alerts.value.length-1].id;refresh()
}
function prevPage(){if(!previous.value.length||busy.value)return;before.value=previous.value.pop();refresh()}
function edit(row=null){
  editing.value=row
  Object.assign(form,{
    slug:row?.slug||'',customerId:row?.customer_id||'',title:row?.title||'',agentUsername:row?.agent_username||'',
    password:'',privacyUrl:row?.privacy_url||'',blockedDomains:row?.blocked_domains.join('\n')||'',enabled:row?.enabled||false,aiCheck:row?.aiCheck||false
  })
  siteDialog.value=true
}
async function save(){
  if(saving.value)return
  saving.value=true
  try{
    await props.api('/support-admin/sites'+(editing.value?'/'+editing.value.slug:''),{method:editing.value?'PUT':'POST',body:{...form}})
    form.password='';siteDialog.value=false;await refresh();ElMessage.success('客服站点已保存')
  }catch(err){ElMessage.error(err.message)}
  finally{saving.value=false}
}
async function openAlert(row){
  selected.value=row;detail.value=null;resolution.value='';reviewDialog.value=true
  try{
    const result=await props.api('/support-admin/alerts/'+row.id)
    if(selected.value?.id===row.id)detail.value=result
  }catch(err){ElMessage.error(err.message)}
}
async function resolve(result){
  if(saving.value||!detail.value||!resolution.value.trim())return
  saving.value=true
  try{
    await props.api('/support-admin/alerts/'+selected.value.id,{method:'PUT',body:{status:result,resolution:resolution.value.trim()}})
    reviewDialog.value=false;await refresh();ElMessage.success('已记录复核结果')
  }catch(err){ElMessage.error(err.message)}
  finally{saving.value=false}
}
async function saveModeration(){
  if(saving.value)return
  saving.value=true
  try{
    moderation.value=await props.api('/support-admin/moderation',{method:'PUT',body:{...modelForm}})
    modelForm.apiKey='';ElMessage.success('审核设置已保存')
  }catch(err){ElMessage.error(err.message)}
  finally{saving.value=false}
}
async function testModeration(){
  if(saving.value)return
  saving.value=true
  try{await props.api('/support-admin/moderation/test',{method:'POST',body:{}});ElMessage.success('模型连接正常')}
  catch(err){ElMessage.error(err.message)}
  finally{saving.value=false}
}
</script>

<template>
  <section class="workspace-page support-admin">
    <div class="insight-grid"><article v-for="metric in supportMetrics" :key="metric.label" class="insight-card"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.detail }}</small></article></div>
    <section class="workspace-panel">
      <header class="workspace-panel-head"><div class="workspace-panel-title"><h2>在线客服运营</h2><p>管理客户客服入口、会话记录、风险线索和审核通知。</p></div><span class="panel-count">{{ sites.length }}<small>个站点</small></span></header>
      <div class="workspace-table-body support-body">
    <div class="support-admin-toolbar">
      <div aria-label="客服运营菜单"><el-button :type="tab==='sites'?'primary':'default'" @click="switchTab('sites')">客服站点</el-button><el-button :type="tab==='history'?'primary':'default'" @click="switchTab('history')">会话记录</el-button><el-button :type="tab==='alerts'?'primary':'default'" @click="switchTab('alerts')">风险告警</el-button><el-button :type="tab==='moderation'?'primary':'default'" @click="switchTab('moderation')">审核与通知</el-button></div>
      <div v-if="tab!=='history'"><el-button :loading="busy" @click="refresh">刷新</el-button><el-button v-if="tab==='sites'" type="primary" :disabled="!activeCustomers.length" @click="edit()">新增客服站点</el-button></div>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
    <template v-if="tab==='sites'">
      <p class="muted">站点绑定一个客户。开放前请确认已约定审核范围，并填写向访客公开的隐私说明。</p>
      <p v-if="!activeCustomers.length" class="muted">请先在客户管理中登记并启用客户。</p>
      <el-table :data="sites" row-key="slug" empty-text="还没有客服站点">
        <el-table-column prop="title" label="客服站点" min-width="155"><template #default="{row}"><strong>{{ row.title }}</strong><br/><small class="muted">{{ row.slug }}</small></template></el-table-column>
        <el-table-column prop="customer_name" label="客户公司" min-width="140"/>
        <el-table-column label="开放状态" min-width="110"><template #default="{row}"><el-tag :type="row.enabled&&row.customer_status==='ACTIVE'?'success':'info'">{{ row.customer_status!=='ACTIVE'?'客户已停用':row.enabled?'已开放':'未开放' }}</el-tag></template></el-table-column>
        <el-table-column prop="agent_username" label="客服账号" min-width="125"/>
        <el-table-column label="入口" min-width="180"><template #default="{row}"><a :href="sitePath(row)" target="_blank" rel="noopener noreferrer">访客聊天</a> · <a :href="sitePath(row)+'/agent'" target="_blank" rel="noopener noreferrer">客服登录</a></template></el-table-column>
        <el-table-column label="操作" min-width="100"><template #default="{row}"><el-button link type="primary" @click="edit(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </template>
    <SupportHistory v-else-if="tab==='history'" :api="api"/>
    <template v-else-if="tab==='alerts'">
      <div class="support-admin-toolbar"><p class="muted">规则命中和举报是待复核线索。打开摘要会记入操作记录。</p>
        <el-select v-model="status" aria-label="告警状态" class="support-status" @change="resetAlerts">
          <el-option v-for="(label,key) in statuses" :key="key" :label="label" :value="key"/>
        </el-select>
      </div>
      <el-table :data="alerts" row-key="id" empty-text="没有该状态的告警">
        <el-table-column prop="site_title" label="客服站点" min-width="145"/>
        <el-table-column prop="conversation_id" label="会话编号" min-width="105"/>
        <el-table-column prop="reason" label="告警原因" min-width="205"/>
        <el-table-column label="发现时间" min-width="170"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column>
        <el-table-column label="操作" min-width="95"><template #default="{row}"><el-button link type="primary" @click="openAlert(row)">查看摘要</el-button></template></el-table-column>
      </el-table>
      <div v-if="previous.length||hasMore" class="support-admin-toolbar"><el-button :disabled="!previous.length||busy" @click="prevPage">上一页</el-button><el-button :disabled="!hasMore||busy" @click="nextPage">下一页</el-button></div>
    </template>
    <template v-else-if="moderation">
      <div class="moderation-status"><el-tag :type="moderation.smtpReady?'success':'warning'">{{ moderation.smtpReady?'运营邮箱已启用':'待配置运营邮箱' }}</el-tag><a href="/#mail">邮件通知设置</a></div>
      <p class="muted">举报和 AI 风险发送到运营邮箱。待转发 {{ moderation.pendingMail }} 条。</p>
      <el-form label-position="top" class="model-form" @submit.prevent="saveModeration">
        <el-form-item label="OpenAI 兼容 API 地址"><el-input v-model.trim="modelForm.endpoint" maxlength="500" placeholder="https://服务商地址/v1"/></el-form-item>
        <el-form-item label="模型名称"><el-input v-model.trim="modelForm.model" maxlength="160" placeholder="填写服务商提供的模型 ID"/></el-form-item>
        <el-form-item label="API Key"><el-input v-model="modelForm.apiKey" type="password" autocomplete="new-password" maxlength="1000" :placeholder="moderation.keySet?'已保存；留空保持原值':'仅运营后台可配置'"/></el-form-item>
        <el-form-item label="启用 AI 内容检查"><el-switch v-model="modelForm.enabled" aria-label="启用 AI 内容检查"/></el-form-item>
        <p class="muted">仅检查已开通 AI 的站点的客服文字。请先更新该站隐私说明。待检查 {{ moderation.pending }} 条，失败 {{ moderation.failed }} 条。</p>
        <el-button type="primary" :loading="saving" native-type="submit">保存审核设置</el-button><el-button :disabled="!moderation.keySet||saving" @click="testModeration">测试已保存的模型</el-button>
      </el-form>
    </template>
    <el-dialog v-model="siteDialog" :title="editing?'编辑客服站点':'新增客服站点'" width="min(600px,94vw)" :close-on-click-modal="false" @closed="form.password=''">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="客户公司"><el-input v-if="editing" :model-value="editing.customer_name" disabled/><el-select v-else v-model="form.customerId" placeholder="选择启用的客户" filterable><el-option v-for="customer in activeCustomers" :key="customer.id" :label="customer.name" :value="customer.id"/></el-select></el-form-item>
        <el-form-item label="站点编号"><el-input v-model.trim="form.slug" :disabled="Boolean(editing)" maxlength="48" placeholder="例如 acme-support，创建后不变"/></el-form-item>
        <el-form-item label="聊天页名称"><el-input v-model.trim="form.title" maxlength="60" placeholder="例如 XX 公司在线客服"/></el-form-item>
        <el-form-item label="客服账号"><el-input v-model.trim="form.agentUsername" maxlength="64" autocomplete="off"/></el-form-item>
        <el-form-item label="客服密码"><el-input v-model="form.password" type="password" show-password maxlength="128" autocomplete="new-password" :placeholder="editing?'留空保留现密码':'至少 16 个字符'"/></el-form-item>
        <el-form-item label="隐私说明链接"><el-input v-model.trim="form.privacyUrl" maxlength="500" placeholder="https://…"/></el-form-item>
        <el-form-item label="拦截域名（可选）"><el-input v-model="form.blockedDomains" type="textarea" :rows="2" maxlength="4000" placeholder="每行一个域名，同时拦截子域名"/></el-form-item>
        <el-form-item label="开放聊天入口"><el-switch v-model="form.enabled"/></el-form-item>
        <el-form-item label="本站 AI 内容检查"><el-switch v-model="form.aiCheck" aria-label="本站 AI 内容检查"/><small class="muted">全局已启用且本站已告知后生效</small></el-form-item>
        <el-form-item v-if="form.aiCheck" label="AI 检查文本"><span class="muted">先遮盖常见敏感信息，再送检</span></el-form-item>
      </el-form>
      <template #footer><el-button @click="siteDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存站点</el-button></template>
    </el-dialog>
    <el-dialog v-model="reviewDialog" title="复核客服告警" width="min(580px,94vw)">
      <template v-if="selected">
        <p><strong>{{ selected.reason }}</strong> · {{ selected.site_title }} · 会话 #{{ selected.conversation_id }}</p>
        <template v-if="detail">
          <p class="muted">告警摘要（已隐藏常见联系方式和数字）</p>
          <pre class="support-excerpt">{{ detail.excerpt || '无文本摘要' }}</pre>
          <template v-if="detail.status==='OPEN'"><label for="support-review-note">复核说明</label><el-input id="support-review-note" v-model="resolution" type="textarea" maxlength="300" :rows="3" placeholder="记录判断依据，避免填写访客身份信息"/></template>
          <p v-else>{{ statuses[detail.status] }}：{{ detail.resolution }}</p>
        </template>
        <p v-else class="muted">正在读取摘要…</p>
      </template>
      <template v-if="detail?.status==='OPEN'" #footer><el-button :disabled="!resolution.trim()||saving" @click="resolve('DISMISSED')">排除告警</el-button><el-button type="danger" :loading="saving" :disabled="!resolution.trim()" @click="resolve('CONFIRMED')">确认风险</el-button></template>
    </el-dialog>
      </div>
    </section>
  </section>
</template>

<style scoped>
.support-body{padding:18px 22px 22px}
.support-admin-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.support-admin-toolbar>div{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.support-admin-toolbar .el-button+.el-button{margin:0}
.support-admin-toolbar>[aria-label="客服运营菜单"]{padding:4px;border-radius:9px;background:#f7f8fa}
.support-admin-toolbar>[aria-label="客服运营菜单"] .el-button{border:0;background:transparent;box-shadow:none}
.support-admin-toolbar>[aria-label="客服运营菜单"] .el-button--primary{background:#fff;color:#17191d;box-shadow:0 1px 2px rgba(16,24,40,.08)}
.support-status{width:150px}
.support-excerpt{padding:12px;background:#f1f5fa;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.moderation-status{display:flex;align-items:center;gap:12px;margin-top:16px}
.model-form{max-width:560px;margin-top:20px}
@media(max-width:560px){
  .support-body{padding:16px 2px}
  .support-admin-toolbar>[aria-label="客服运营菜单"]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;padding:5px;background:#f2f5fa;border-radius:11px}
  .support-admin-toolbar>[aria-label="客服运营菜单"] .el-button{min-height:42px;margin:0;padding-inline:8px}
  .support-admin-toolbar .muted{margin:0}
  .moderation-status{flex-wrap:wrap}
  .model-form :deep(.el-button){margin:0 8px 8px 0;min-height:42px}
}
</style>
