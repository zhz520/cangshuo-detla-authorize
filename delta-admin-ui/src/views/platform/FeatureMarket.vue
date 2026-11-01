<template>
  <div class="platform-page" v-loading="loading">
    <el-card shadow="never">
      <template #header><div class="section-heading"><div><h2>功能商城</h2><p>按需开通扩展功能，现有业务功能继续使用。</p></div><el-button @click="load">刷新</el-button></div></template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <template v-if="overview">
        <el-descriptions :column="isCompact ? 1 : 2" border>
          <el-descriptions-item label="客户编号">{{ overview.customerId }}</el-descriptions-item>
          <el-descriptions-item label="当前版本">{{ overview.version }} <el-tag size="small" type="info">{{ overview.channel === 'preview' ? '预览版' : '正式版' }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="实例编号">{{ overview.instanceId }}</el-descriptions-item>
          <el-descriptions-item label="授权状态">{{ licenseLabels[overview.licenseStatus] || overview.licenseStatus }}<span v-if="overview.expiresAt"> · 到期 {{ formatTime(overview.expiresAt) }}</span></el-descriptions-item>
        </el-descriptions>
        <div class="license-actions"><el-button @click="activationVisible = true">查看开通信息</el-button><el-button type="primary" :disabled="!overview.verifierConfigured" @click="licenseVisible = true">导入授权</el-button></div>
        <p v-if="!overview.verifierConfigured" class="muted">授权服务尚未配置，请联系维护人员完成接入后开通付费模块。</p>
      </template>
    </el-card>
    <div v-if="!error" class="feature-grid">
      <el-card v-for="feature in features" :key="feature.id" shadow="never" class="feature-card">
        <div class="section-heading"><h3>{{ feature.name }}</h3><el-tag :type="feature.enabled ? 'success' : 'info'">{{ statusLabels[feature.status] || feature.status }}</el-tag></div>
        <p class="description">{{ feature.description }}</p>
        <ul><li v-for="capability in feature.capabilities" :key="capability">{{ capability }}</li></ul>
        <p class="muted">{{ feature.paid ? '付费扩展 · 人工报价与开通' : '基础功能 · 已包含' }}</p>
        <p class="muted">最低版本 {{ feature.minVersion }}<span v-if="feature.dependencies.length"> · 依赖基础业务系统</span></p>
        <div class="feature-actions">
          <el-button v-if="feature.enabled" type="primary" @click="$router.push(feature.entryPath)">进入功能</el-button>
          <el-button v-else-if="!feature.entitled" @click="activationVisible = true">查看开通信息</el-button>
          <el-switch v-if="feature.paid" :model-value="feature.enabled" :aria-label="`启用${feature.name}`" :disabled="!feature.entitled || !!changing" :loading="changing === feature.id" active-text="启用" @change="value => toggle(feature, value)" />
        </div>
      </el-card>
    </div>
    <el-dialog v-model="activationVisible" title="人工开通扩展功能" width="min(560px, 94vw)">
      <p>将下方客户编号、实例编号及需要开通的功能发送给维护人员，确认价格与期限后获取本实例的签名授权文件。</p>
      <el-input :model-value="identityText" type="textarea" :rows="4" readonly />
      <p class="muted">当前版本采用人工开通，不会自动扣款。授权文件导入后，再开启需要使用的模块。</p>
      <template #footer><el-button @click="activationVisible = false">关闭</el-button><el-button type="primary" @click="copyIdentity">复制实例信息</el-button></template>
    </el-dialog>
    <el-dialog v-model="licenseVisible" title="导入签名授权" width="min(620px, 94vw)" @closed="licenseText = ''">
      <p>粘贴维护人员提供的完整授权文件内容。系统会校验签名、客户编号、实例编号及有效期。</p>
      <el-input v-model="licenseText" type="textarea" :rows="9" maxlength="32768" placeholder="粘贴授权 JSON 内容" />
      <template #footer><el-button @click="licenseVisible = false">取消</el-button><el-button type="primary" :loading="importing" :disabled="!licenseText.trim()" @click="importLicense">校验并导入</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useResponsive } from '@/utils/responsive'
import { getPlatformOverview, getPlatformFeatures, importPlatformLicense, setPlatformFeatureEnabled } from '@/api/platform'

const { isCompact } = useResponsive()
const overview = ref(null), features = ref([]), loading = ref(false), error = ref(''), changing = ref('')
const activationVisible = ref(false), licenseVisible = ref(false), importing = ref(false), licenseText = ref('')
const licenseLabels = { NONE: '尚未导入授权', VALID: '授权有效', INVALID: '授权验证失败', EXPIRED: '授权已到期', NOT_YET_VALID: '授权尚未生效' }
const statusLabels = { INCLUDED: '已包含', ENABLED: '已启用', DISABLED: '已授权，未启用', EXPIRED: '已到期', NOT_PURCHASED: '待开通' }
const identityText = computed(() => overview.value ? `客户编号：${overview.value.customerId}\n实例编号：${overview.value.instanceId}\n当前版本：${overview.value.version}` : '')
function formatTime(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
async function load() {
  loading.value = true; error.value = ''
  try { const [info, modules] = await Promise.all([getPlatformOverview(), getPlatformFeatures()]); overview.value = info.data; features.value = modules.data }
  catch { error.value = '功能与授权信息加载失败，请刷新重试。'; overview.value = null; features.value = [] }
  finally { loading.value = false }
}
async function toggle(feature, enabled) {
  changing.value = feature.id
  try { const response = await setPlatformFeatureEnabled(feature.id, enabled); features.value = response.data; ElMessage.success(enabled ? '功能已启用' : '功能已关闭') }
  catch { /* Request interceptor displays the server error. */ }
  finally { changing.value = '' }
}
async function copyIdentity() {
  try { await navigator.clipboard.writeText(identityText.value); ElMessage.success('实例信息已复制') }
  catch { ElMessage.info('请手动选中并复制上方实例信息') }
}
async function importLicense() {
  let envelope
  try { envelope = JSON.parse(licenseText.value) } catch { return ElMessage.error('授权文件不是有效的 JSON，请粘贴完整内容') }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return ElMessage.error('授权文件格式不正确')
  importing.value = true
  try { await importPlatformLicense(envelope); licenseVisible.value = false; licenseText.value = ''; await load(); ElMessage.success('授权已导入，请启用需要使用的模块') }
  catch { /* Keep the dialog open for correction. */ }
  finally { importing.value = false }
}
onMounted(load)
</script>

<style scoped>
.platform-page { display: grid; gap: 18px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
h2, h3 { margin: 0; color: #17191c; }
h2 { font-size: 20px; } h3 { font-size: 17px; }
.section-heading p, .muted { color: #73777e; font-size: 13px; line-height: 1.7; }
.license-actions, .feature-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 16px; }
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px; }
.feature-card :deep(.el-card__body) { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
.feature-actions { margin-top: auto; padding-top: 14px; }
.description { color: #555b63; line-height: 1.8; }
ul { padding-left: 20px; color: #555b63; line-height: 2; }
:deep(.el-descriptions__content) { overflow-wrap: anywhere; }
:deep(.el-dialog p) { line-height: 1.8; }
</style>
