<template>
  <section class="service-groups-page workspace-page">
    <div class="insight-grid"><article v-for="metric in metrics" :key="metric.label" class="insight-card"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.detail }}</small></article></div>
    <section class="workspace-panel">
      <header class="workspace-panel-head"><div class="workspace-panel-title"><h2>共享服务组</h2><p>服务组成员属于同一软件，并配置唯一的运行时租户编号。</p></div><div class="workspace-panel-actions"><el-button @click="downloadRegistry">下载租户导出</el-button><el-button type="primary" @click="openGroup()">新建服务组</el-button></div></header>
      <div class="workspace-table-body"><el-table :data="groups" stripe empty-text="尚未登记共享服务组">
        <el-table-column prop="id" label="服务组编号" min-width="180" />
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column label="软件" min-width="130">
          <template #default="{row}">{{ productName(row.product_id) }}</template>
        </el-table-column>
        <el-table-column label="租户" min-width="230">
          <template #default="{row}">
            <el-tag v-for="member in row.members" :key="member.instance_id" size="small" class="tenant-tag">
              {{ member.runtime_tenant_id }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}"><el-tag :type="row.active ? 'success' : 'info'">{{ row.active ? '可发布' : '未就绪' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" min-width="260">
          <template #default="{row}">
            <el-button link type="primary" @click="openGroup(row)">编辑</el-button>
            <el-button link type="success" :disabled="!row.active" @click="openPlan(row)">创建发布计划</el-button>
          </template>
        </el-table-column>
      </el-table></div>
    </section>

    <section class="workspace-panel">
      <header class="workspace-panel-head"><div class="workspace-panel-title"><h2>最近发布计划</h2><p>签名计划的有效期、维护窗口与执行状态。</p></div><span class="panel-count">{{ recentPlans.length }}<small>条计划</small></span></header>
      <div class="workspace-table-body"><el-table :data="recentPlans" stripe empty-text="尚未签发共享发布计划">
        <el-table-column prop="targetVersion" label="目标版本" width="120" />
        <el-table-column prop="fromVersion" label="起始版本" width="120" />
        <el-table-column prop="groupId" label="服务组" min-width="180" />
        <el-table-column label="租户" min-width="190"><template #default="{row}">{{ row.tenants.join('、') }}</template></el-table-column>
        <el-table-column label="维护窗口" min-width="260"><template #default="{row}">{{ time(row.maintenanceWindow.startAt) }} 至 {{ time(row.maintenanceWindow.endAt) }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="createdAt" label="创建时间" min-width="180"><template #default="{row}">{{ time(row.createdAt) }}</template></el-table-column>
      </el-table></div>
    </section>

    <el-dialog v-model="groupDialog" :title="editingGroup ? '编辑共享服务组' : '新建共享服务组'" width="min(680px,94vw)" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveGroup">
        <el-form-item label="服务组编号"><el-input v-model="groupForm.id" :disabled="editingGroup" placeholder="如 delta-shared-prod" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="groupForm.name" maxlength="80" /></el-form-item>
        <el-form-item label="所属软件"><el-select v-model="groupForm.productId" :disabled="editingGroup"><el-option v-for="product in data.products" :key="product.id" :value="product.id" :label="product.name + ' · ' + product.id" /></el-select></el-form-item>
        <el-form-item label="成员实例"><el-select v-model="groupForm.instanceIds" multiple filterable placeholder="选择已登记运行时租户的实例"><el-option v-for="instance in eligibleInstances" :key="instance.id" :value="instance.id" :label="instance.customer_name + ' / ' + instance.name + ' · ' + instance.runtime_tenant_id" /></el-select><span class="muted">一个实例只能属于一个服务组；成员维护期和项目状态必须有效。</span></el-form-item>
        <el-form-item label="状态"><el-select v-model="groupForm.status"><el-option label="启用" value="ACTIVE" /><el-option label="暂停" value="PAUSED" /></el-select></el-form-item>
        <el-form-item label="维护窗口上限（分钟）"><el-input-number v-model="groupForm.maintenanceMaxMinutes" :min="1" :max="1440" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="groupDialog=false">取消</el-button><el-button type="primary" :loading="savingGroup" @click="saveGroup">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="planDialog" title="创建共享服务组发布计划" width="min(760px,94vw)" destroy-on-close>
      <el-alert type="warning" :closable="false" title="计划会使用授权中心签发密钥签名。安装由受控 shared_worker 在维护窗口内执行，本操作不会直接升级生产。" />
      <el-form label-position="top" class="plan-form" @submit.prevent="createPlan">
        <el-form-item label="服务组"><strong>{{ planGroup?.id }}</strong> <span class="muted">{{ planGroup?.name }}</span></el-form-item>
        <el-form-item label="目标正式版本"><el-select v-model="planForm.targetVersion" placeholder="选择已发布正式版"><el-option v-for="release in availableReleases" :key="release.version" :value="release.version" :label="release.version" /></el-select></el-form-item>
        <el-form-item label="当前安装版本"><el-input v-model="planForm.fromVersion" placeholder="如 1.12.4" /></el-form-item>
        <el-form-item label="维护窗口开始"><el-date-picker v-model="planForm.startAt" type="datetime" :clearable="false" format="YYYY-MM-DD HH:mm:ss" /></el-form-item>
        <el-form-item label="维护窗口结束"><el-date-picker v-model="planForm.endAt" type="datetime" :clearable="false" format="YYYY-MM-DD HH:mm:ss" /></el-form-item>
        <p class="muted">成员：{{ planGroup?.members.map(item => item.runtime_tenant_id).join('、') }}。维护窗口必须在创建时已经开启。</p>
      </el-form>
      <el-input v-if="planEnvelope" :model-value="planEnvelopeText" type="textarea" :rows="12" readonly />
      <template #footer>
        <el-button @click="planDialog=false">关闭</el-button>
        <el-button v-if="planEnvelope" type="success" @click="downloadPlan">下载签名计划</el-button>
        <el-button v-else type="primary" :loading="creatingPlan" @click="createPlan">签发计划</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({ data: { type: Object, required: true }, api: { type: Function, required: true }, refresh: { type: Function, required: true } })
const groups = computed(() => props.data.serviceGroups || [])
const recentPlans = computed(() => (props.data.sharedReleasePlans || []).slice(0, 20))
const metrics = computed(() => [
  { label: '服务组', value: groups.value.length, detail: '已登记共享服务组' },
  { label: '可发布', value: groups.value.filter(item => item.active).length, detail: '成员与版本条件已满足' },
  { label: '最近计划', value: recentPlans.value.length, detail: '按签发时间倒序展示' }
])
const eligibleInstances = computed(() => (props.data.instances || []).filter(item => item.runtime_tenant_id))
const groupDialog = ref(false), editingGroup = ref(false), savingGroup = ref(false)
const groupForm = reactive({ id: '', name: '', productId: '', instanceIds: [], status: 'ACTIVE', maintenanceMaxMinutes: 240 })
const planDialog = ref(false), planGroup = ref(null), creatingPlan = ref(false), planEnvelope = ref(null)
const planForm = reactive({ targetVersion: '', fromVersion: '', startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 3600000) })
const availableReleases = computed(() => (props.data.releases || []).filter(item => item.status === 'PUBLISHED' && item.product_id === planGroup.value?.product_id))
const planEnvelopeText = computed(() => planEnvelope.value ? JSON.stringify(planEnvelope.value, null, 2) : '')
function productName(id) { return props.data.products?.find(item => item.id === id)?.name || id }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function openGroup(row = null) {
  editingGroup.value = !!row
  Object.assign(groupForm, row ? { id: row.id, name: row.name, productId: row.product_id, instanceIds: row.members.map(item => item.instance_id), status: row.status, maintenanceMaxMinutes: row.maintenance_max_minutes } : { id: '', name: '', productId: props.data.products?.[0]?.id || '', instanceIds: [], status: 'ACTIVE', maintenanceMaxMinutes: 240 })
  groupDialog.value = true
}
async function downloadRegistry() {
  try {
    const registry = await props.api('/runtime/tenants')
    const url = URL.createObjectURL(new Blob([JSON.stringify(registry, null, 2)], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `runtime-tenants-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) { ElMessage.error(error.message) }
}
async function saveGroup() {
  if (savingGroup.value) return
  savingGroup.value = true
  try {
    const path = editingGroup.value ? `/service-groups/${groupForm.id}` : '/service-groups'
    await props.api(path, { method: editingGroup.value ? 'PUT' : 'POST', body: groupForm })
    groupDialog.value = false
    await props.refresh()
    ElMessage.success('服务组已保存')
  } catch (error) { ElMessage.error(error.message) } finally { savingGroup.value = false }
}
function openPlan(group) {
  planGroup.value = group
  planForm.targetVersion = ''
  planForm.fromVersion = ''
  planForm.startAt = new Date(Date.now() - 60000)
  planForm.endAt = new Date(Date.now() + 3600000)
  planEnvelope.value = null
  planDialog.value = true
}
async function createPlan() {
  if (creatingPlan.value) return
  creatingPlan.value = true
  try {
    const result = await props.api(`/service-groups/${planGroup.value.id}/plans`, { method: 'POST', body: { targetVersion: planForm.targetVersion, fromVersion: planForm.fromVersion, startAt: planForm.startAt.toISOString(), endAt: planForm.endAt.toISOString() } })
    planEnvelope.value = result.envelope
    await props.refresh()
    ElMessage.success('发布计划已签发')
  } catch (error) { ElMessage.error(error.message) } finally { creatingPlan.value = false }
}
function downloadPlan() {
  const url = URL.createObjectURL(new Blob([planEnvelopeText.value], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `shared-release-${planEnvelope.value.id || 'plan'}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<style scoped>
.service-groups-page { display: grid; gap: 18px; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tenant-tag { margin: 2px 4px 2px 0; }
.plan-form { margin-top: 16px; }
</style>
