<template>
  <div class="payment-settings" :aria-busy="saving || !!uploadingKey">
    <section class="payment-overview">
      <div class="payment-overview-copy">
        <span class="overview-kicker"><i></i>支付基础设施</span>
        <h2>{{ enabledProviders.length ? '支付通道已就绪' : '配置支付通道' }}</h2>
        <p>统一维护商户参数；项目只选择可用通道和开放方式，密钥不进入项目配置。</p>
      </div>
      <div class="payment-overview-meta">
        <span>{{ enabledProviders.length }} / {{ providers.length }} 个通道启用</span>
        <el-tag :type="enabledProviders.length ? 'success' : 'info'" effect="light" round>{{ enabledProviders.length ? '运行中' : '待配置' }}</el-tag>
      </div>
    </section>

    <div class="payment-summary">
      <article class="insight-card"><span>已启用通道</span><strong>{{ enabledProviders.length }}</strong><small>{{ providers.length }} 个可用通道</small></article>
      <article class="insight-card"><span>已接入项目</span><strong>{{ configuredProjects }}</strong><small>共 {{ projects.length }} 个项目</small></article>
      <article class="insight-card"><span>开放方式</span><strong>{{ activeMethods.length }}</strong><small>{{ methodSummary }}</small></article>
    </div>

    <el-alert v-if="dirty" title="支付设置有未保存的修改" type="warning" :closable="false" show-icon />
    <el-alert v-else title="修改商户参数或支付方式后，请保存当前支付通道。支付方式彼此独立。" type="info" :closable="false" show-icon />

    <article v-for="provider in providers" :key="provider.id" class="provider-card">
      <header class="provider-header">
        <div>
          <h3>{{ provider.name }}</h3>
          <p>{{ provider.description }}</p>
        </div>
        <div class="provider-status">
          <el-tag :type="paymentForms[provider.id]?.enabled ? 'success' : 'info'" effect="plain">
            {{ paymentForms[provider.id]?.enabled ? '已启用' : '已停用' }}
          </el-tag>
          <span class="provider-switch-label">{{ paymentForms[provider.id]?.enabled ? '系统启用' : '系统停用' }}</span><el-switch v-model="paymentForms[provider.id].enabled" :aria-label="`系统启用${provider.name}`" />
        </div>
      </header>

      <section class="method-section">
        <div class="method-heading">
          <div><h4>支持的支付方式</h4><p>按项目需要独立开放，不依据浏览器或 User-Agent 自动切换。</p></div>
          <span>{{ paymentForms[provider.id].methods.length }} 项已选</span>
        </div>
        <el-checkbox-group v-model="paymentForms[provider.id].methods" class="method-grid">
          <el-checkbox v-for="method in PAYMENT_METHODS" :key="method" :value="method" border class="method-option">
            <span>{{ PAYMENT_METHOD_LABELS[method] }}</span>
            <small>{{ PAYMENT_METHOD_DESCRIPTIONS[method] }}</small>
          </el-checkbox>
        </el-checkbox-group>
      </section>

      <section class="config-section">
        <div class="method-heading">
          <div><h4>商户参数</h4><p>仅展示当前所选支付方式需要的字段；其他字段会保留原配置。</p></div>
          <span>{{ visibleFields(provider).length }} 项</span>
        </div>
        <el-form label-position="top" class="config-grid" :disabled="saving || !!uploadingKey">
          <el-form-item v-for="field in visibleFields(provider)" :key="field.key" :label="field.label" :required="field.required" class="config-field">
            <div class="field-control">
              <el-input v-model="paymentForms[provider.id].config[field.key]" :type="field.type === 'password' ? 'password' : 'text'" :show-password="field.type === 'password'" autocomplete="new-password" :placeholder="field.type === 'password' && provider.secretsSet ? '已配置，留空保留原值' : field.placeholder || (field.required ? '必填' : '选填')" />
              <el-upload v-if="field.upload" :show-file-list="false" :http-request="request => uploadPaymentKey(provider, field, request.file)" accept=".pem,.key,.txt" :disabled="saving || !!uploadingKey">
                <el-button :loading="uploadingKey === field.key">{{ uploadingKey === field.key ? '上传中' : '上传文件' }}</el-button>
              </el-upload>
            </div>
            <small v-if="field.help" class="field-help">{{ field.help }}</small>
          </el-form-item>
        </el-form>
        <el-alert v-if="!visibleFields(provider).length" title="请先选择一种支付方式，再填写对应商户参数。" type="info" :closable="false" />
      </section>

      <footer class="provider-actions">
        <span>{{ paymentForms[provider.id].enabled ? '项目可把此通道设为默认支付接入。' : '启用后才能被项目选用。' }}</span>
        <el-button type="primary" :loading="saving" :disabled="!!uploadingKey" @click="savePayment(provider)">保存支付通道</el-button>
      </footer>
    </article>

    <section class="project-section">
      <div class="project-heading">
        <div><h3>项目支付接入</h3><p>商户密钥留在系统级；项目只选择通道和开放方式。</p></div>
        <el-input v-model="projectSearch" clearable placeholder="搜索项目或客户" class="project-search" />
      </div>
      <el-table :data="filteredProjects" stripe>
        <el-table-column prop="name" label="项目" min-width="150" />
        <el-table-column prop="customer_name" label="客户" min-width="130" />
        <el-table-column label="支付通道" min-width="170">
          <template #default="scope"><span v-if="scope.row.payment_provider_name">{{ scope.row.payment_provider_name }} <el-tag v-if="!scope.row.payment_provider_enabled" size="small" type="warning">系统已停用</el-tag></span><span v-else class="muted">未接入</span></template>
        </el-table-column>
        <el-table-column label="开放方式" min-width="230">
          <template #default="scope"><div class="method-tags"><el-tag v-for="method in scope.row.payment_methods" :key="method" size="small" effect="plain">{{ PAYMENT_METHOD_LABELS[method] || method }}</el-tag><span v-if="!scope.row.payment_methods?.length" class="muted">未选择</span></div></template>
        </el-table-column>
        <el-table-column label="操作" width="130">
          <template #default="scope"><el-button link type="primary" @click="emit('edit-project', scope.row)">设置支付接入</el-button></template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_DESCRIPTIONS, visibleConfigFields } from './payment-methods'

const props = defineProps({ data: { type: Object, required: true }, api: { type: Function, required: true }, refresh: { type: Function, required: true } })
const emit = defineEmits(['edit-project'])
const paymentForms = reactive({})
const snapshots = reactive({})
const saving = ref(false)
const uploadingKey = ref('')
const projectSearch = ref('')

const providers = computed(() => props.data.paymentProviders || [])
const projects = computed(() => props.data.projects || [])
const enabledProviders = computed(() => providers.value.filter(provider => paymentForms[provider.id]?.enabled))
const configuredProjects = computed(() => projects.value.filter(project => project.payment_provider_name).length)
const activeMethods = computed(() => [...new Set(enabledProviders.value.flatMap(provider => paymentForms[provider.id]?.methods || []))])
const methodSummary = computed(() => activeMethods.value.map(method => PAYMENT_METHOD_LABELS[method]).join(' / ') || '尚未选择')
const filteredProjects = computed(() => {
  const keyword = projectSearch.value.trim().toLowerCase()
  if (!keyword) return projects.value
  return projects.value.filter(project => `${project.name || ''} ${project.customer_name || ''}`.toLowerCase().includes(keyword))
})
const dirty = computed(() => Object.entries(paymentForms).some(([id, value]) => JSON.stringify(value) !== snapshots[id]))

function setPayment(provider) {
  paymentForms[provider.id] = { enabled: provider.enabled, config: { ...(provider.config || {}) }, methods: [...(provider.methods || [])] }
  snapshots[provider.id] = JSON.stringify(paymentForms[provider.id])
}

watch(providers, list => {
  for (const provider of list) {
    if (!snapshots[provider.id] || JSON.stringify(paymentForms[provider.id]) === snapshots[provider.id]) setPayment(provider)
  }
}, { immediate: true })

function visibleFields(provider) {
  return visibleConfigFields(provider, paymentForms[provider.id]?.methods || [])
}

async function run(action) {
  if (saving.value) return
  saving.value = true
  try {
    await action()
    ElMessage.success('支付通道已保存')
    await props.refresh()
  } catch (error) {
    ElMessage.error(error?.message || '保存支付通道失败')
  } finally {
    saving.value = false
  }
}

function savePayment(provider) {
  return run(async () => {
    const updated = await props.api('/payments/' + provider.id, { method: 'PUT', body: paymentForms[provider.id] })
    setPayment(updated)
  })
}

async function uploadPaymentKey(provider, field, file) {
  if (!file || uploadingKey.value) return
  if (file.size > 32768) {
    ElMessage.error('密钥文件不能超过 32KB')
    return
  }
  uploadingKey.value = field.key
  try {
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    const result = await props.api('/payment-keys/upload', { method: 'POST', body: { kind: field.upload, filename: file.name, contentBase64 } })
    paymentForms[provider.id].config[field.key] = result.path
    ElMessage.success('文件已上传，请保存当前支付通道')
  } catch (error) {
    ElMessage.error(error?.message || '密钥文件上传失败')
  } finally {
    uploadingKey.value = ''
  }
}
</script>

<style scoped>
.payment-settings { display: grid; gap: 16px; }
.payment-overview { display: flex; align-items: center; justify-content: space-between; gap: 28px; min-height: 132px; padding: 26px 28px; overflow: hidden; border: 1px solid #eef0f4; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.025); }
.payment-overview-copy { min-width: 0; }
.overview-kicker { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 10px; color: #667085; font-size: 10px; font-weight: 650; letter-spacing: .05em; }
.overview-kicker i { width: 18px; height: 2px; background: #17191d; }
.payment-overview h2 { margin: 0 0 6px; color: #17191d; font-size: 24px; font-weight: 750; letter-spacing: -.55px; }
.payment-overview p { max-width: 660px; margin: 0; color: #667085; line-height: 1.7; }
.payment-overview-meta { display: grid; justify-items: end; gap: 10px; flex: 0 0 auto; color: #667085; font-size: 11px; }
.payment-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.provider-card { overflow: hidden; border: 1px solid #eef0f4; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.025); }
.provider-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px 22px 18px; background: #fff; border-bottom: 1px solid #f0f2f5; }
.provider-kicker { display: block; margin-bottom: 6px; color: #98a2b3; font-size: 9px; font-weight: 700; letter-spacing: .13em; }
.provider-header h3, .project-heading h3 { margin: 0 0 6px; color: #17191d; font-size: 18px; font-weight: 700; letter-spacing: -.2px; }
.provider-header p, .project-heading p, .method-heading p { margin: 0; color: #667085; font-size: 12px; line-height: 1.65; }
.provider-status { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
.provider-switch-label { color: #667085; font-size: 11px; }
.method-section, .config-section { padding: 20px 22px; }
.config-section { border-top: 1px solid #f0f2f5; background: #fcfcfd; }
.method-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.method-heading h4 { margin: 0 0 5px; color: #344054; font-size: 14px; font-weight: 650; }
.method-heading > span { color: #98a2b3; font-size: 11px; white-space: nowrap; }
.method-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; width: 100%; }
.method-grid :deep(.el-checkbox) { height: auto; min-height: 62px; margin: 0; padding: 12px 14px; align-items: flex-start; border-radius: 9px; background: #fbfcfd; }
.method-grid :deep(.el-checkbox__label) { display: block; white-space: normal; line-height: 1.45; }
.method-grid :deep(.el-checkbox__label span) { display: block; color: #334155; font-weight: 600; }
.method-grid :deep(.el-checkbox__label small) { display: block; margin-top: 3px; color: #8995a7; font-size: 11px; }
.method-grid :deep(.el-checkbox.is-bordered.is-checked) { background: #f2f4f7; border-color: #98a2b3; }
.config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 22px; }
.config-field { min-width: 0; }
.field-control { display: flex; align-items: center; gap: 8px; width: 100%; }
.field-control .el-input { min-width: 0; flex: 1; }
.field-help { display: block; margin-top: 5px; color: #8491a3; font-size: 12px; line-height: 1.55; }
.provider-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 22px; border-top: 1px solid #f0f2f5; background: #fff; }
.provider-actions span { color: #98a2b3; font-size: 11px; }
.project-section { overflow: hidden; border: 1px solid #eef0f4; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.025); }
.project-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 22px 16px; border-bottom: 1px solid #f0f2f5; }
.project-search { width: min(280px, 100%); }
.method-tags { display: flex; flex-wrap: wrap; gap: 5px; }
@media (max-width: 760px) {
  .payment-overview, .provider-header, .provider-actions, .project-heading { flex-direction: column; align-items: stretch; }
  .payment-overview { min-height: 0; padding: 22px; }
  .payment-overview-meta { justify-items: start; }
  .payment-summary, .config-grid { grid-template-columns: 1fr; }
  .provider-status { justify-content: flex-start; flex-wrap: wrap; }
  .provider-actions .el-button { width: 100%; }
  .project-search { width: 100%; }
}
</style>
