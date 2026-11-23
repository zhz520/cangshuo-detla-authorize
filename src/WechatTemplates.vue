<template>
  <section class="wechat-template-page">
    <el-alert
      title="这里只维护模板方案，不下发客户公众号的最终模板 ID。客户实例绑定自己的公众号后，再按方案匹配或选用模板。"
      type="info" :closable="false" show-icon class="page-alert" />

    <div class="section-head">
      <div><strong>业务模板方案</strong><span>角色、场景、官方字段类型和默认字段映射统一由授权中心版本化发布。</span></div>
      <el-button type="primary" @click="open()">新增方案</el-button>
    </div>

    <el-table :data="rows" v-loading="busy" stripe empty-text="还没有模板方案">
      <el-table-column prop="product_name" label="软件" min-width="130" />
      <el-table-column label="角色" width="100"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column>
      <el-table-column label="场景" min-width="160"><template #default="{ row }">{{ scenarioLabel(row.scenario) }}<br/><small class="muted">{{ row.scenario }}</small></template></el-table-column>
      <el-table-column prop="name" label="方案名称" min-width="170" />
      <el-table-column prop="template_hint" label="微信模板提示" min-width="190" show-overflow-tooltip />
      <el-table-column label="字段" min-width="220">
        <template #default="{ row }"><span class="field-summary">{{ Object.keys(row.fields || {}).join(' · ') || '未配置' }}</span></template>
      </el-table-column>
      <el-table-column label="版本/状态" width="130">
        <template #default="{ row }"><span>v{{ row.version }}</span> <el-tag :type="row.status==='ACTIVE'?'success':'info'" size="small">{{ row.status==='ACTIVE'?'已发布':'草稿' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }"><el-button link type="primary" @click="open(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="form.id ? '编辑模板方案' : '新增模板方案'" width="min(760px,96vw)" destroy-on-close>
      <el-form label-position="top" class="scheme-form">
        <div class="form-grid three">
          <el-form-item label="软件"><el-select v-model="form.productId"><el-option v-for="item in products" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="接收角色"><el-select v-model="form.role"><el-option v-for="(label,value) in roles" :key="value" :label="label" :value="value" /></el-select></el-form-item>
          <el-form-item label="业务场景"><el-select v-model="form.scenario"><el-option v-for="(label,value) in scenarios" :key="value" :label="label" :value="value" /></el-select></el-form-item>
        </div>
        <div class="form-grid">
          <el-form-item label="方案名称"><el-input v-model="form.name" maxlength="80" placeholder="例如：管理员 · 新订单" /></el-form-item>
          <el-form-item label="微信模板标题提示"><el-input v-model="form.templateHint" maxlength="160" placeholder="帮助客户在微信后台选择正确模板" /></el-form-item>
        </div>
        <div class="field-heading"><span>默认字段映射</span><small>左侧是微信模板变量，右侧是客户系统的数据源编码</small></div>
        <div v-for="(field,index) in form.fields" :key="index" class="field-row">
          <el-input v-model="field.key" maxlength="64" placeholder="例如 thing1" />
          <el-input v-model="field.source" maxlength="64" placeholder="例如 message" />
          <el-button text type="danger" :disabled="form.fields.length<=1" @click="form.fields.splice(index,1)">删除</el-button>
        </div>
        <el-button plain size="small" @click="form.fields.push({key:'',source:''})">添加字段</el-button>
        <div class="form-grid">
          <el-form-item label="消息点击链接（选填）"><el-input v-model="form.url" maxlength="2000" placeholder="客户域名下的页面地址，由客户实例可再覆盖" /></el-form-item>
          <el-form-item label="发布状态"><el-radio-group v-model="form.status"><el-radio value="DRAFT">草稿</el-radio><el-radio value="ACTIVE">发布</el-radio></el-radio-group></el-form-item>
        </div>
        <div class="form-grid">
          <el-form-item label="小程序 AppID（选填）"><el-input v-model="form.miniAppId" maxlength="64" /></el-form-item>
          <el-form-item label="小程序页面路径（选填）"><el-input v-model="form.miniPagepath" maxlength="200" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存方案</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({ api: { type: Function, required: true }, products: { type: Array, default: () => [] } })
const roles = { USER: '客户', PLAYER: '打手', ADMIN: '管理员', CS: '客服' }
const scenarios = { new_order: '新订单', order_status: '订单状态', refund_status: '退款/提现', complaint_status: '投诉状态', staff_review: '员工审核' }
const rows = ref([]), busy = ref(false), saving = ref(false), dialog = ref(false)
const form = reactive({ id: '', productId: 'detla', role: 'ADMIN', scenario: 'new_order', name: '', templateHint: '', fields: [{ key: 'thing1', source: 'message' }], url: '', miniAppId: '', miniPagepath: '', status: 'DRAFT' })
function roleLabel(value) { return roles[value] || value }
function scenarioLabel(value) { return scenarios[value] || value }

async function load() {
  busy.value = true
  try { rows.value = await props.api('/wechat-template-schemes') } catch (error) { ElMessage.error(error?.message || '模板方案加载失败') } finally { busy.value = false }
}
function open(row = null) {
  Object.assign(form, { id: '', productId: row?.product_id || props.products[0]?.id || 'detla', role: 'ADMIN', scenario: 'new_order', name: '', templateHint: '', fields: [{ key: 'thing1', source: 'message' }], url: '', miniAppId: '', miniPagepath: '', status: 'DRAFT' }, row ? {
    id: row.id, productId: row.product_id, role: row.role, scenario: row.scenario, name: row.name, templateHint: row.template_hint || '',
    fields: Object.entries(row.fields || {}).map(([key, source]) => ({ key, source })), url: row.url || '',
    miniAppId: row.miniprogram?.appid || '', miniPagepath: row.miniprogram?.pagepath || '', status: row.status
  } : {})
  if (!form.fields.length) form.fields = [{ key: 'thing1', source: 'message' }]
  dialog.value = true
}
async function save() {
  if (!form.name.trim()) return ElMessage.warning('请填写方案名称')
  const fields = Object.fromEntries(form.fields.filter(item => item.key.trim() && item.source.trim()).map(item => [item.key.trim(), item.source.trim()]))
  if (!Object.keys(fields).length) return ElMessage.warning('至少配置一个字段映射')
  saving.value = true
  try {
    const body = { productId: form.productId, role: form.role, scenario: form.scenario, name: form.name, templateHint: form.templateHint, fields, url: form.url, miniprogram: form.miniAppId ? { appid: form.miniAppId, pagepath: form.miniPagepath } : {}, status: form.status }
    if (form.id) await props.api(`/wechat-template-schemes/${form.id}`, { method: 'PUT', body })
    else await props.api('/wechat-template-schemes', { method: 'POST', body })
    dialog.value = false
    ElMessage.success('模板方案已保存')
    await load()
  } catch (error) { ElMessage.error(error?.message || '模板方案保存失败') } finally { saving.value = false }
}
async function remove(row) {
  try { await ElMessageBox.confirm(`确认删除“${row.name}”？客户实例已落地的模板 ID 不会被删除。`, '删除模板方案', { type: 'warning' }) } catch { return }
  try { await props.api(`/wechat-template-schemes/${row.id}`, { method: 'DELETE' }); ElMessage.success('模板方案已删除'); await load() } catch (error) { ElMessage.error(error?.message || '删除失败') }
}
onMounted(load)
</script>

<style scoped>
.wechat-template-page { display:grid; gap:16px; }
.page-alert { margin-bottom:0; }
.section-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.section-head strong, .section-head span { display:block; }.section-head strong { font-size:15px; }.section-head span { margin-top:4px; color:var(--el-text-color-secondary); font-size:12px; }
.muted { color:var(--el-text-color-placeholder); font-size:11px; }
.field-summary { color:var(--el-text-color-secondary); font-size:12px; }
.scheme-form { display:grid; gap:2px; }.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }.form-grid.three { grid-template-columns:repeat(3,minmax(0,1fr)); }
.field-heading { display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 8px; font-size:13px; font-weight:700; }.field-heading small { color:var(--el-text-color-secondary); font-size:11px; font-weight:400; }
.field-row { display:grid; grid-template-columns:1fr 1fr 48px; gap:8px; margin-bottom:8px; }
@media(max-width:768px){.section-head{align-items:flex-start;flex-direction:column}.form-grid,.form-grid.three{grid-template-columns:1fr}.field-row{grid-template-columns:1fr}}
</style>
