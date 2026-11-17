<template>
  <section class="workspace-page">
    <section class="workspace-panel">
      <header class="workspace-panel-head">
        <div class="workspace-panel-title"><h2>实名供应商</h2><p>姓名与身份证号二要素核验</p></div>
        <el-tag :type="provider.configured ? 'success' : 'info'">{{ provider.configured ? '已配置' : '未启用' }}</el-tag>
      </header>
      <el-alert class="provider-guide" type="info" :closable="false" show-icon
        :title="provider.mode === 'ALIYUN_CLOUD_AUTH' ? '阿里云身份二要素由授权中心直接调用' : provider.mode === 'TENCENT_FACEID' ? '腾讯云二要素由授权中心直接调用' : '填写服务商提供的 HTTPS 核验接口'"
        :description="provider.mode === 'ALIYUN_CLOUD_AUTH' ? '授权中心调用阿里云 cloudauth Id2MetaVerify，后付费 0.2 元/次；只有核验一致/不一致计费，接口异常或无记录不扣费。只需填写阿里云 AccessKey。' : provider.mode === 'TENCENT_FACEID' ? '授权中心使用腾讯云 IdCardVerification 接口，只需填写腾讯云 API 密钥，不需要自建转发服务。' : '接口需接受 POST JSON：{ name, idNumber }，并返回 { matched: true|false, requestId }；令牌通过 Authorization: Bearer 发送。'" />
      <el-form label-position="top" class="identity-provider-form" :disabled="loading || savingProvider">
        <el-row :gutter="16">
          <el-col :xs="24" :md="12"><el-form-item label="服务商类型"><el-select v-model="provider.mode" @change="switchProviderMode"><el-option label="阿里云二要素（推荐）" value="ALIYUN_CLOUD_AUTH" /><el-option label="腾讯云二要素" value="TENCENT_FACEID" /><el-option label="自定义 HTTPS 接口" value="CUSTOM" /></el-select></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="启用实名供应商"><el-switch v-model="provider.enabled" /></el-form-item></el-col>
        </el-row>
        <el-row v-if="provider.mode === 'ALIYUN_CLOUD_AUTH'" :gutter="16">
          <el-col :xs="24" :md="12"><el-form-item label="阿里云 AccessKey ID"><el-input v-model="provider.secretId" autocomplete="off" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="阿里云 AccessKey Secret"><el-input v-model="provider.secretKey" type="password" show-password autocomplete="new-password" :placeholder="provider.hasSecretKey ? '已保存，留空保留原值' : '填写阿里云 AccessKey Secret'" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="接口"><el-input model-value="cloudauth.aliyuncs.com" readonly /></el-form-item></el-col>
        </el-row>
        <el-row v-else-if="provider.mode === 'TENCENT_FACEID'" :gutter="16">
          <el-col :xs="24" :md="12"><el-form-item label="腾讯云 SecretId"><el-input v-model="provider.secretId" autocomplete="off" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="腾讯云 SecretKey"><el-input v-model="provider.secretKey" type="password" show-password autocomplete="new-password" :placeholder="provider.hasSecretKey ? '已保存，留空保留原值' : '填写腾讯云 API 密钥'" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="地域"><el-input v-model="provider.region" placeholder="ap-guangzhou" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="接口"><el-input model-value="faceid.tencentcloudapi.com" readonly /></el-form-item></el-col>
        </el-row>
        <el-row v-else :gutter="16">
          <el-col :xs="24" :md="12"><el-form-item label="核验接口地址（HTTPS）"><el-input v-model="provider.url" placeholder="https://api.your-domain.com/verify" /></el-form-item></el-col>
          <el-col :xs="24" :md="12"><el-form-item label="访问令牌（Bearer Token）"><el-input v-model="provider.token" type="password" show-password autocomplete="new-password" :placeholder="provider.hasToken ? '已保存，留空保留原值' : '填写服务商提供的接口令牌'" /></el-form-item></el-col>
        </el-row>
        <el-button type="primary" :loading="savingProvider" @click="saveProvider">保存供应商配置</el-button>
      </el-form>
    </section>
    <div class="insight-grid">
      <article v-for="metric in metrics" :key="metric.label" class="insight-card">
        <span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.detail }}</small>
      </article>
    </div>

    <section class="workspace-panel">
      <header class="workspace-panel-head">
        <div class="workspace-panel-title"><h2>实名核验服务账户</h2><p>授权权益与核验余额双重校验；余额、套餐和预占均可追溯。</p></div>
        <div class="workspace-panel-actions">
          <span class="panel-count">{{ rows.length }}<small>个实例</small></span>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </div>
      </header>
      <div class="workspace-table-body">
        <el-table :data="rows" stripe v-loading="loading">
          <el-table-column prop="customer_name" label="客户" min-width="125" />
          <el-table-column label="实例" min-width="190"><template #default="{row}"><span>{{ row.instance_name }}</span><br/><small class="muted">{{ row.instance_id }}</small></template></el-table-column>
          <el-table-column label="计费" width="120"><template #default="{row}">{{ modeLabel(row.billing_mode) }}<br/><small class="muted">{{ money(row.unit_price_cents) }}/次</small></template></el-table-column>
          <el-table-column label="可用余额" width="105"><template #default="{row}">{{ money(row.balance_cents) }}</template></el-table-column>
          <el-table-column label="套餐剩余" width="95"><template #default="{row}">{{ row.package_remaining || 0 }} 次</template></el-table-column>
          <el-table-column label="核验用量" width="140"><template #default="{row}"><span>{{ row.charged_count || 0 }} 次</span><br/><small class="muted">通过 {{ row.matched_count || 0 }} · 不匹配 {{ row.mismatch_count || 0 }}</small></template></el-table-column>
          <el-table-column label="状态" width="82"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'danger'">{{ row.status==='ACTIVE'?'启用':'停用' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" min-width="250" fixed="right"><template #default="{row}">
            <el-button link type="primary" @click="openAccount(row)">设置</el-button>
            <el-button link @click="openCredit(row)">充值</el-button>
            <el-button link @click="openGrant(row)">发套餐</el-button>
            <el-button link @click="showDetail(row)">流水</el-button>
          </template></el-table-column>
        </el-table>
      </div>
    </section>

    <section class="workspace-panel package-panel">
      <header class="workspace-panel-head">
        <div class="workspace-panel-title"><h2>实名核验套餐</h2><p>套餐按实例发放，先到期先消耗；客户后台可直接发起微信扫码购买。</p></div>
        <div class="workspace-panel-actions"><el-button type="primary" @click="openPackage()">新增套餐</el-button></div>
      </header>
      <div class="workspace-table-body">
        <el-table :data="packages" stripe>
          <el-table-column prop="code" label="编码" width="120" />
          <el-table-column prop="name" label="套餐" min-width="160" />
          <el-table-column prop="verification_count" label="核验次数" width="100" />
          <el-table-column label="价格" width="110"><template #default="{row}">{{ money(row.price_cents) }}</template></el-table-column>
          <el-table-column prop="validity_days" label="有效天数" width="100" />
          <el-table-column label="范围" width="110"><template #default="{row}">{{ row.scope_type==='PROJECT' ? '指定项目' : '全局' }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'info'">{{ row.status }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openPackage(row)">编辑</el-button><el-button link type="danger" @click="deletePackage(row)">删除</el-button></template></el-table-column>
        </el-table>
      </div>
    </section>
  </section>

  <el-dialog v-model="accountVisible" title="实名核验计费设置" width="min(560px,96vw)">
    <p class="muted">{{ current?.customer_name }} / {{ current?.instance_name }}</p>
    <el-form label-position="top">
      <el-row :gutter="14">
        <el-col :xs="24" :sm="12"><el-form-item label="计费模式"><el-select v-model="accountForm.billingMode"><el-option label="只按次计费" value="METERED"/><el-option label="只套餐" value="PACKAGE"/><el-option label="套餐优先 + 余额" value="HYBRID"/></el-select></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="单次价格（元）"><el-input v-model="accountForm.priceYuan" inputmode="decimal" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="账户状态"><el-switch v-model="accountForm.active" active-text="启用" inactive-text="停用" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="accountVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="creditVisible" title="实名核验余额充值" width="min(460px,96vw)">
    <p class="muted">{{ current?.customer_name }} / {{ current?.instance_name }}</p>
    <el-form label-position="top"><el-form-item label="充值金额（元）"><el-input v-model="creditAmount" inputmode="decimal" placeholder="如 100.00"/></el-form-item><el-form-item label="充值引用（必填，防重复）"><el-input v-model="creditReference" maxlength="128" placeholder="如 线下收款单号"/></el-form-item></el-form>
    <template #footer><el-button @click="creditVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="credit">确认充值</el-button></template>
  </el-dialog>

  <el-dialog v-model="grantVisible" title="发放实名核验套餐" width="min(460px,96vw)">
    <p class="muted">{{ current?.customer_name }} / {{ current?.instance_name }}</p>
    <el-form label-position="top"><el-form-item label="套餐"><el-select v-model="grantPackageId"><el-option v-for="item in activePackages" :key="item.id" :value="item.id" :label="item.name + ' · ' + item.verification_count + '次 · ' + item.validity_days + '天'" /></el-select></el-form-item></el-form>
    <template #footer><el-button @click="grantVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="grantPackage">确认发放</el-button></template>
  </el-dialog>

  <el-dialog v-model="packageVisible" :title="packageEditing ? '编辑实名核验套餐' : '新增实名核验套餐'" width="min(620px,96vw)">
    <el-form label-position="top">
      <el-row :gutter="14">
        <el-col :xs="24" :sm="12"><el-form-item label="套餐编码"><el-input v-model="packageForm.code" /></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="套餐名称"><el-input v-model="packageForm.name" /></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="核验次数"><el-input-number v-model="packageForm.verificationCount" :min="1" :max="10000000" /></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="价格（元）"><el-input v-model="packageForm.priceYuan" inputmode="decimal" /></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="有效天数"><el-input-number v-model="packageForm.validityDays" :min="1" :max="3660" /></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="适用范围"><el-select v-model="packageForm.scopeType"><el-option label="全局" value="GLOBAL"/><el-option label="指定项目" value="PROJECT"/></el-select></el-form-item></el-col>
        <el-col v-if="packageForm.scopeType==='PROJECT'" :span="24"><el-form-item label="项目"><el-select v-model="packageForm.scopeId"><el-option v-for="row in projects" :key="row.project_id" :value="row.project_id" :label="row.customer_name + ' / ' + row.project_name" /></el-select></el-form-item></el-col>
        <el-col :xs="24" :sm="12"><el-form-item label="状态"><el-select v-model="packageForm.status"><el-option label="草稿" value="DRAFT"/><el-option label="启用" value="ACTIVE"/><el-option label="停用" value="RETIRED"/></el-select></el-form-item></el-col>
      </el-row>
      <el-form-item label="说明"><el-input v-model="packageForm.description" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="packageVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="savePackage">保存套餐</el-button></template>
  </el-dialog>

  <el-drawer v-model="detailVisible" :title="(current?.instance_name || '') + ' · 核验流水'" size="min(92vw, 760px)">
    <el-tabs v-model="detailTab">
      <el-tab-pane label="核验请求" name="requests"><el-table :data="requests" stripe><el-table-column prop="status" label="状态" width="105"/><el-table-column prop="billing_mode" label="计费" width="100"/><el-table-column label="单价" width="100"><template #default="{row}">{{ money(row.price_cents) }}</template></el-table-column><el-table-column label="结果" min-width="120"><template #default="{row}">{{ resultLabel(row.result) }}</template></el-table-column><el-table-column prop="provider_request_id" label="供应商请求号" min-width="180" show-overflow-tooltip/><el-table-column label="时间" min-width="170"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column></el-table></el-tab-pane>
      <el-tab-pane label="资金流水" name="ledger"><el-table :data="ledger" stripe><el-table-column prop="type" label="类型" width="110"/><el-table-column label="金额" width="110"><template #default="{row}">{{ money(row.amount_cents) }}</template></el-table-column><el-table-column label="余额" width="110"><template #default="{row}">{{ money(row.balance_after) }}</template></el-table-column><el-table-column prop="reference" label="引用" min-width="170"/><el-table-column label="时间" min-width="170"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column></el-table></el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
const props = defineProps({ api: Function })
const rows = ref([]), packages = ref([]), loading = ref(false), saving = ref(false)
const provider = reactive({mode:'ALIYUN_CLOUD_AUTH',url:'',token:'',hasToken:false,secretId:'',secretKey:'',hasSecretKey:false,region:'ap-guangzhou',enabled:false,configured:false,credentials:{}})
const savingProvider=ref(false)
const current = ref(null), accountVisible = ref(false), creditVisible = ref(false), grantVisible = ref(false)
const detailVisible = ref(false), detailTab = ref('requests'), requests = ref([]), ledger = ref([])
const creditAmount = ref(''), creditReference = ref(''), grantPackageId = ref('')
const packageVisible = ref(false), packageEditing = ref(false)
const accountForm = reactive({ billingMode: 'HYBRID', priceYuan: '1.00', active: true })
const packageForm = reactive({ id: '', code: '', name: '', verificationCount: 100, priceYuan: '50.00', validityDays: 365, scopeType: 'GLOBAL', scopeId: '', status: 'DRAFT', description: '' })
const money = cents => '¥' + (Number(cents || 0) / 100).toFixed(2)
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const modeLabel = value => ({ METERED: '按次', PACKAGE: '套餐', HYBRID: '套餐优先' }[value] || value || '—')
const resultLabel = value => String(value || '').startsWith('MATCH') ? '姓名证件一致' : String(value || '').startsWith('MISMATCH') ? '姓名证件不一致' : value || '—'
const activePackages = computed(() => packages.value.filter(item => item.status === 'ACTIVE'))
const projects = computed(() => {
  const map = new Map()
  rows.value.forEach(row => map.set(row.project_id, { project_id: row.project_id, project_name: row.project_name, customer_name: row.customer_name }))
  return [...map.values()]
})
const metrics = computed(() => [
  { label: '服务账户', value: rows.value.length, detail: '已接入授权中心的实例' },
  { label: '可用余额', value: money(rows.value.reduce((sum, row) => sum + Number(row.balance_cents || 0), 0)), detail: '不含被预占金额' },
  { label: '套餐剩余', value: rows.value.reduce((sum, row) => sum + Number(row.package_remaining || 0), 0) + ' 次', detail: '全部有效套餐' },
  { label: '已核验', value: rows.value.reduce((sum, row) => sum + Number(row.charged_count || 0), 0) + ' 次', detail: '已扣费请求' }
])
const toCents = value => Math.round(Number(value) * 100)
async function load() {
  loading.value = true
  try {
    const [accounts, offers, settings] = await Promise.all([props.api('/usage/accounts'), props.api('/identity/packages'), props.api('/usage/provider')])
    rows.value=accounts; packages.value=offers
    Object.assign(provider,{mode:'ALIYUN_CLOUD_AUTH',region:'ap-guangzhou'},settings,{token:'',secretKey:''})
  }
  catch (error) { ElMessage.error(error.message) }
  finally { loading.value = false }
}
function switchProviderMode(mode) {
  const saved = provider.credentials?.[mode] || {}
  provider.secretId = saved.secretId || ''
  provider.secretKey = ''
  provider.hasSecretKey = Boolean(saved.hasSecretKey)
  provider.region = saved.region || 'ap-guangzhou'
  provider.url = saved.url || ''
  provider.hasToken = Boolean(saved.hasToken)
}
async function saveProvider() {
  savingProvider.value=true
  try {
    const body = provider.mode === 'ALIYUN_CLOUD_AUTH'
      ? {mode:'ALIYUN_CLOUD_AUTH',secretId:provider.secretId,secretKey:provider.secretKey,enabled:provider.enabled}
      : provider.mode === 'TENCENT_FACEID'
        ? {mode:'TENCENT_FACEID',secretId:provider.secretId,secretKey:provider.secretKey,region:provider.region,enabled:provider.enabled}
        : {mode:'CUSTOM',url:provider.url,token:provider.token,enabled:provider.enabled}
    Object.assign(provider,await props.api('/usage/provider',{method:'PUT',body}),{token:'',secretKey:''})
    ElMessage.success('实名供应商配置已保存')
  } catch(error) { ElMessage.error(error.message) }
  finally { savingProvider.value=false }
}
function openAccount(row) { current.value = row; accountForm.billingMode = row.billing_mode || 'HYBRID'; accountForm.priceYuan = (Number(row.unit_price_cents || 0) / 100).toFixed(2); accountForm.active = row.status === 'ACTIVE'; accountVisible.value = true }
async function saveAccount() {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(accountForm.priceYuan))) return ElMessage.warning('请输入有效单价')
  saving.value = true
  try { await props.api('/usage/accounts/' + current.value.instance_id, { method: 'PUT', body: { billingMode: accountForm.billingMode, unitPriceCents: toCents(accountForm.priceYuan), status: accountForm.active ? 'ACTIVE' : 'SUSPENDED' } }); await load(); accountVisible.value = false; ElMessage.success('账户设置已保存') }
  catch (error) { ElMessage.error(error.message) } finally { saving.value = false }
}
function openCredit(row) { current.value = row; creditAmount.value = ''; creditReference.value = ''; creditVisible.value = true }
async function credit() {
  const value = String(creditAmount.value || '').trim(), reference = String(creditReference.value || '').trim()
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) return ElMessage.warning('请输入有效充值金额')
  if (!reference) return ElMessage.warning('请填写充值引用')
  saving.value = true
  try { await props.api('/usage/accounts/' + current.value.instance_id + '/credit', { method: 'POST', body: { amountCents: toCents(value), reference } }); await load(); creditVisible.value = false; ElMessage.success('充值已入账') }
  catch (error) { ElMessage.error(error.message) } finally { saving.value = false }
}
function openGrant(row) { current.value = row; grantPackageId.value = ''; grantVisible.value = true }
async function grantPackage() {
  if (!grantPackageId.value) return ElMessage.warning('请选择套餐')
  saving.value = true
  try { await props.api('/usage/accounts/' + current.value.instance_id + '/packages', { method: 'POST', body: { packageId: grantPackageId.value } }); await load(); grantVisible.value = false; ElMessage.success('套餐已发放') }
  catch (error) { ElMessage.error(error.message) } finally { saving.value = false }
}
function openPackage(row = null) {
  packageEditing.value = Boolean(row)
  Object.assign(packageForm, row ? { id: row.id, code: row.code, name: row.name, verificationCount: row.verification_count, priceYuan: (Number(row.price_cents || 0) / 100).toFixed(2), validityDays: row.validity_days, scopeType: row.scope_type, scopeId: row.scope_id || '', status: row.status, description: row.description || '' } : { id: '', code: '', name: '', verificationCount: 100, priceYuan: '50.00', validityDays: 365, scopeType: 'GLOBAL', scopeId: '', status: 'DRAFT', description: '' })
  packageVisible.value = true
}
async function savePackage() {
  if (!packageForm.code.trim() || !packageForm.name.trim()) return ElMessage.warning('请填写套餐编码和名称')
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(packageForm.priceYuan))) return ElMessage.warning('请输入有效套餐价格')
  saving.value = true
  try {
    const body = { code: packageForm.code.trim(), name: packageForm.name.trim(), verificationCount: packageForm.verificationCount, priceCents: toCents(packageForm.priceYuan), validityDays: packageForm.validityDays, scopeType: packageForm.scopeType, scopeId: packageForm.scopeType === 'PROJECT' ? packageForm.scopeId : null, status: packageForm.status, description: packageForm.description }
    await props.api(packageEditing.value ? '/identity/packages/' + packageForm.id : '/identity/packages', { method: packageEditing.value ? 'PUT' : 'POST', body })
    packageVisible.value = false; await load(); ElMessage.success('套餐已保存')
  } catch (error) { ElMessage.error(error.message) } finally { saving.value = false }
}
async function deletePackage(row) {
  try {
    await ElMessageBox.confirm('删除套餐「' + row.name + '」？已有购买或发放记录的套餐不能删除。', '删除实名核验套餐', { type: 'warning' })
    await props.api('/identity/packages/' + row.id, { method: 'DELETE' })
    await load(); ElMessage.success('套餐已删除')
  } catch (error) { if (error !== 'cancel' && error?.message && error.message !== 'cancel') ElMessage.error(error.message) }
}
async function showDetail(row) {
  current.value = row; detailTab.value = 'requests'; detailVisible.value = true
  try { ;[requests.value, ledger.value] = await Promise.all([props.api('/usage/requests?instanceId=' + encodeURIComponent(row.instance_id)), props.api('/usage/ledger?instanceId=' + encodeURIComponent(row.instance_id))]) }
  catch (error) { ElMessage.error(error.message) }
}
onMounted(load)
</script>

<style scoped>
.package-panel{margin-top:22px}.muted{color:#78869a;font-size:13px}
.provider-guide{margin:0 20px 16px}.identity-provider-form{padding:0 20px 20px}
@media(max-width:720px){.workspace-panel-head{align-items:flex-start;flex-direction:column}}
</style>
