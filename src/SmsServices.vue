<template>
  <div class="sms-service">
    <el-card shadow="never">
      <template #header>
        <div class="sms-head">
          <div>
            <strong>短信服务</strong>
            <span class="muted">授权中心统一发送、计费和套餐管理</span>
          </div>
          <div class="sms-head-actions">
            <el-tag :type="settings.enabled ? 'success' : 'info'">{{ settings.enabled ? '已启用' : '未启用' }}</el-tag>
            <el-button :loading="loading" @click="load">刷新</el-button>
          </div>
        </div>
      </template>
      <el-alert title="授权中心统一接入时，阿里云 AccessKey 只保存在这里；客户也可以在自己的后台选择阿里云直连并自行保存密钥。" type="info" :closable="false" show-icon />
      <el-tabs v-model="tab" class="sms-tabs">
        <el-tab-pane label="接入配置" name="settings">
          <el-form label-position="top" class="sms-form" :disabled="saving">
            <div class="form-grid">
              <el-form-item label="启用短信服务"><el-switch v-model="settings.enabled" /></el-form-item>
              <el-form-item label="阿里云 Endpoint"><el-input v-model="settings.endpoint" readonly /></el-form-item>
              <el-form-item label="AccessKey ID"><el-input v-model="settings.accessKeyId" autocomplete="off" /></el-form-item>
              <el-form-item label="AccessKey Secret">
                <el-input v-model="settings.accessKeySecret" type="password" show-password autocomplete="new-password"
                  :placeholder="settings.hasSecret ? '已保存，留空保留原值' : '填写阿里云 RAM 子账号 Secret'" />
              </el-form-item>
              <el-form-item label="默认短信签名"><el-input v-model="settings.defaultSignName" placeholder="例如：KK云电竞" /></el-form-item>
              <el-form-item label="请求超时（毫秒）"><el-input-number v-model="settings.timeoutMs" :min="1000" :max="30000" :step="1000" /></el-form-item>
              <el-form-item>
                <template #label><span class="label-with-help">回执签名密钥<el-tooltip content="与阿里云短信回执转发端共享的 32 字节密钥，用于验证回执确实来自你的转发服务。"><span class="help-dot">?</span></el-tooltip></span></template>
                <el-input v-model="settings.receiptKey" type="password" show-password autocomplete="new-password"
                  :placeholder="settings.receiptConfigured ? '已配置，留空保留原值' : '32 字节 Base64 或 64 位十六进制'" />
              </el-form-item>
            </div>
            <el-alert v-if="!settings.masterKeyConfigured" title="系统加密密钥未就绪，暂时无法保存密钥。" type="warning" :closable="false" show-icon />
            <el-alert v-else-if="!settings.receiptConfigured" title="填写与阿里云回执转发端一致的签名密钥。收到成功回执后才扣费。" type="info" :closable="false" show-icon />
            <div class="form-actions"><el-button type="primary" :loading="saving" @click="saveSettings">保存接入配置</el-button></div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="模板管理" name="templates">
          <el-alert class="template-alert" type="info" :closable="false" show-icon
            title="登录、找回密码、改绑手机和微信绑定共需 5 个验证码模板。"
            description="点击「初始化验证码模板」会自动创建 otp_login、otp_reset、otp_bind_old、otp_bind_new、otp_wechat_bind；如已有启用的验证码模板，会复制其签名、阿里云模板 Code 和变量配置。" />
          <div class="table-toolbar"><span class="muted">客户只提交 templateKey 和变量，正文、签名和模板 Code 由这里统一配置。</span><span class="toolbar-actions"><el-button @click="seedTemplates">初始化验证码模板</el-button><el-button type="primary" @click="openTemplate()">新增模板</el-button></span></div>
          <el-table :data="templates" stripe>
            <el-table-column prop="template_key" label="模板键" min-width="220" />
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="scene" label="场景" width="120" />
            <el-table-column prop="provider_template_code" label="阿里云模板 Code" min-width="160" />
            <el-table-column prop="sign_name" label="签名" min-width="120"><template #default="{row}">{{ row.sign_name || settings.defaultSignName || '默认' }}</template></el-table-column>
            <el-table-column label="计费" width="105"><template #default="{row}"><el-tag :type="row.billable ? 'success' : 'info'">{{ row.billable ? (row.billing_units || 1) + '条' : '免费' }}</el-tag></template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':row.status==='RETIRED'?'info':'warning'">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openTemplate(row)">编辑</el-button><el-button link type="danger" @click="deleteTemplate(row)">删除</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="计费策略" name="accounts">
          <div class="table-toolbar"><span class="muted">按项目设置计费模式、单条价格和额度；套餐优先于余额。</span></div>
          <el-table :data="accounts" stripe>
            <el-table-column prop="customer_name" label="客户" min-width="130" />
            <el-table-column prop="project_name" label="项目" min-width="150"><template #default="{row}">{{ row.project_name }}<br/><small class="muted">{{ row.project_id }}</small></template></el-table-column>
            <el-table-column label="模式" width="110"><template #default="{row}"><el-tag>{{ modeLabel(row.billing_mode) }}</el-tag></template></el-table-column>
            <el-table-column label="单条价格" width="105"><template #default="{row}">{{ money(row.unit_price_cents) }}</template></el-table-column>
            <el-table-column label="余额" width="110"><template #default="{row}">{{ money(row.balance_cents) }}</template></el-table-column>
            <el-table-column label="套餐剩余" width="110"><template #default="{row}">{{ row.package_remaining || 0 }} 条</template></el-table-column>
            <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '暂停' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" min-width="250" fixed="right"><template #default="{row}"><el-button link type="primary" @click="editAccount(row)">设置</el-button><el-button link @click="openCredit(row)">充值</el-button><el-button link @click="openGrant(row)">发套餐</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="套餐管理" name="packages">
          <div class="table-toolbar"><span class="muted">套餐是预付条数包，默认到期作废、先到期先消耗。</span><el-button type="primary" @click="openPackage()">新增套餐</el-button></div>
          <el-table :data="packages" stripe>
            <el-table-column prop="code" label="编码" width="120" />
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="message_count" label="条数" width="100" />
            <el-table-column label="价格" width="110"><template #default="{row}">{{ money(row.price_cents) }}</template></el-table-column>
            <el-table-column prop="validity_days" label="有效天数" width="100" />
            <el-table-column label="范围" width="110"><template #default="{row}">{{ row.scope_type === 'PROJECT' ? '指定项目' : '全局' }}</template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'info'">{{ row.status }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openPackage(row)">编辑</el-button><el-button link type="danger" @click="deletePackage(row)">删除</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="接入凭据" name="credentials">
          <el-alert title="每个实例使用独立 client secret；只显示一次，生成后请放入该实例的受保护配置。" type="warning" :closable="false" show-icon />
          <el-table :data="credentials" stripe class="credential-table">
            <el-table-column prop="customer_name" label="客户" min-width="130" />
            <el-table-column prop="instance_name" label="实例" min-width="180" />
            <el-table-column prop="instance_id" label="实例 UUID" min-width="300" />
            <el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="row.status ? 'success' : 'info'">{{ row.status || '未生成' }}</el-tag></template></el-table-column>
            <el-table-column label="最近使用" min-width="180"><template #default="{row}">{{ time(row.last_used_at) }}</template></el-table-column>
            <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="rotateCredential(row)">生成/轮换</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="用量账单" name="usage">
          <div class="table-toolbar"><el-select v-model="usageProject" clearable placeholder="全部项目" @change="loadUsage"><el-option v-for="account in accounts" :key="account.project_id" :value="account.project_id" :label="account.customer_name + ' / ' + account.project_name" /></el-select><el-button :loading="loadingUsage" @click="loadUsage">刷新流水</el-button></div>
          <div v-if="usageSummary" class="usage-summary">
            <span>回执发送成功 <b>{{ usageSummary.delivered_count }}</b></span>
            <span>失败 <b>{{ usageSummary.failed_count }}</b></span>
            <span>待确认 <b>{{ usageSummary.pending_count }}</b></span>
            <span>已扣款 <b>{{ money(usageSummary.charged_cents) }}</b></span>
            <span>套餐消耗 <b>{{ usageSummary.package_units }}</b></span>
            <span v-if="usageSummary.legacy_accepted_count">旧版仅受理 <b>{{ usageSummary.legacy_accepted_count }}</b></span>
          </div>
          <el-table :data="usage" stripe>
            <el-table-column label="时间" min-width="165"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column>
            <el-table-column prop="instance_name" label="实例" min-width="130" />
            <el-table-column prop="scene" label="场景" width="120" />
            <el-table-column prop="phone_masked" label="手机号" width="120" />
            <el-table-column label="状态" width="128"><template #default="{row}">{{ statusLabel(row) }}</template></el-table-column>
            <el-table-column label="计费" width="130"><template #default="{row}">{{ row.billing_status === 'CHARGED' ? money(row.charge_cents) : row.billing_status === 'RESERVED' ? '待结算' : '未扣款' }}</template></el-table-column>
            <el-table-column prop="error_code" label="错误码" min-width="150" />
            <el-table-column label="操作" width="110"><template #default="{row}"><el-button v-if="canRelease(row)" link type="warning" @click="releaseUnknown(row)">释放预占</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="templateVisible" :title="templateEditing ? '编辑短信模板' : '新增短信模板'" width="min(720px,96vw)">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="模板键"><el-input v-model="templateForm.templateKey" :disabled="templateEditing" placeholder="例如 otp_login" /></el-form-item>
          <el-form-item label="名称"><el-input v-model="templateForm.name" /></el-form-item>
          <el-form-item label="场景"><el-input v-model="templateForm.scene" placeholder="例如 LOGIN / ORDER" /></el-form-item>
          <el-form-item label="阿里云模板 Code"><el-input v-model="templateForm.providerTemplateCode" placeholder="SMS_xxx" /></el-form-item>
          <el-form-item label="签名"><el-input v-model="templateForm.signName" placeholder="留空使用默认签名" /></el-form-item>
          <el-form-item label="计费单位"><el-input-number v-model="templateForm.billingUnits" :min="1" :max="10" /></el-form-item>
          <el-form-item label="是否计费"><el-switch v-model="templateForm.billable" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="templateForm.status"><el-option label="草稿" value="DRAFT"/><el-option label="启用" value="ACTIVE"/><el-option label="停用" value="RETIRED"/></el-select></el-form-item>
        </div>
        <el-form-item label="变量">
          <div class="variable-list">
            <div v-for="(item,index) in templateVariables" :key="index" class="variable-row">
              <el-input v-model="item.key" placeholder="变量名，如 code" />
              <el-input-number v-model="item.maxLength" :min="1" :max="200" />
              <el-checkbox v-model="item.required">必填</el-checkbox>
              <el-button text type="danger" @click="templateVariables.splice(index,1)">删除</el-button>
            </div>
            <el-button text type="primary" @click="templateVariables.push({key:'',maxLength:40,required:true})">添加变量</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="templateVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveTemplate">保存模板</el-button></template>
    </el-dialog>

    <el-dialog v-model="packageVisible" :title="packageEditing ? '编辑套餐' : '新增套餐'" width="min(620px,96vw)">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="套餐编码"><el-input v-model="packageForm.code" /></el-form-item>
          <el-form-item label="套餐名称"><el-input v-model="packageForm.name" /></el-form-item>
          <el-form-item label="条数"><el-input-number v-model="packageForm.messageCount" :min="1" :max="10000000" /></el-form-item>
          <el-form-item label="价格（元）"><el-input v-model="packageForm.priceYuan" inputmode="decimal" /></el-form-item>
          <el-form-item label="有效天数"><el-input-number v-model="packageForm.validityDays" :min="1" :max="3660" /></el-form-item>
          <el-form-item label="适用范围"><el-select v-model="packageForm.scopeType"><el-option label="全局" value="GLOBAL"/><el-option label="指定项目" value="PROJECT"/></el-select></el-form-item>
          <el-form-item v-if="packageForm.scopeType==='PROJECT'" label="项目"><el-select v-model="packageForm.scopeId"><el-option v-for="account in accounts" :key="account.project_id" :value="account.project_id" :label="account.customer_name + ' / ' + account.project_name" /></el-select></el-form-item>
          <el-form-item label="状态"><el-select v-model="packageForm.status"><el-option label="草稿" value="DRAFT"/><el-option label="启用" value="ACTIVE"/><el-option label="停用" value="RETIRED"/></el-select></el-form-item>
        </div>
        <el-form-item label="说明"><el-input v-model="packageForm.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="packageVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="savePackage">保存套餐</el-button></template>
    </el-dialog>

    <el-dialog v-model="accountVisible" title="项目短信账户" width="min(620px,96vw)">
      <p class="muted">{{ accountCurrent?.customer_name }} / {{ accountCurrent?.project_name }}</p>
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="计费模式"><el-select v-model="accountForm.billingMode"><el-option label="只按条计费" value="METERED"/><el-option label="只套餐" value="PACKAGE"/><el-option label="套餐+按条" value="HYBRID"/></el-select></el-form-item>
          <el-form-item label="单条价格（元）"><el-input v-model="accountForm.priceYuan" inputmode="decimal" /></el-form-item>
          <el-form-item label="每日上限（0 不限）"><el-input-number v-model="accountForm.dailyLimit" :min="0" :max="10000000" /></el-form-item>
          <el-form-item label="每月上限（0 不限）"><el-input-number v-model="accountForm.monthlyLimit" :min="0" :max="100000000" /></el-form-item>
          <el-form-item label="低余额提醒（元）"><el-input v-model="accountForm.lowYuan" inputmode="decimal" /></el-form-item>
          <el-form-item label="账户状态"><el-switch v-model="accountForm.enabled" active-text="启用" inactive-text="暂停" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="accountVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">保存账户</el-button></template>
    </el-dialog>

    <el-dialog v-model="creditVisible" title="短信余额充值" width="min(460px,96vw)">
      <p class="muted">{{ accountCurrent?.customer_name }} / {{ accountCurrent?.project_name }}</p>
      <el-form label-position="top"><el-form-item label="充值金额（元）"><el-input v-model="creditAmount" inputmode="decimal" /></el-form-item><el-form-item label="充值引用"><el-input v-model="creditReference" maxlength="128" placeholder="如线下收款单号" /></el-form-item></el-form>
      <template #footer><el-button @click="creditVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="credit">确认充值</el-button></template>
    </el-dialog>

    <el-dialog v-model="grantVisible" title="发放短信套餐" width="min(460px,96vw)">
      <p class="muted">{{ accountCurrent?.customer_name }} / {{ accountCurrent?.project_name }}</p>
      <el-form label-position="top"><el-form-item label="套餐"><el-select v-model="grantPackageId"><el-option v-for="item in availablePackages" :key="item.id" :value="item.id" :label="item.name + ' · ' + item.message_count + '条 · ' + item.validity_days + '天'" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="grantVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="grantPackage">确认发放</el-button></template>
    </el-dialog>

    <el-dialog v-model="credentialVisible" title="短信接入凭据" width="min(620px,96vw)">
      <el-alert title="请立即复制并放入该实例的受保护配置；离开后不会再次显示。" type="warning" :closable="false" show-icon />
      <el-input v-model="credentialText" type="textarea" :rows="4" readonly class="credential-secret" />
      <template #footer><el-button type="primary" @click="credentialVisible=false">我已保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({ api: Function, refresh: Function })
const loading = ref(false), saving = ref(false), tab = ref('settings')
const settings = reactive({ enabled: false, endpoint: 'dysmsapi.aliyuncs.com', accessKeyId: '', accessKeySecret: '', receiptKey: '', defaultSignName: '', timeoutMs: 8000, hasSecret: false, masterKeyConfigured: false })
const templates = ref([]), packages = ref([]), accounts = ref([]), credentials = ref([]), usage = ref([])
const usageProject = ref(''), loadingUsage = ref(false), usageSummary = ref(null)
let usageSequence = 0

const templateVisible = ref(false), templateEditing = ref(false), templateForm = reactive({})
const templateVariables = ref([])
const packageVisible = ref(false), packageEditing = ref(false), packageForm = reactive({})
const accountVisible = ref(false), accountCurrent = ref(null), accountForm = reactive({})
const creditVisible = ref(false), creditAmount = ref(''), creditReference = ref('')
const grantVisible = ref(false), grantPackageId = ref('')
const credentialVisible = ref(false), credentialText = ref('')
const availablePackages = computed(() => packages.value.filter(item => item.status === 'ACTIVE' && (item.scope_type === 'GLOBAL' || item.scope_id === accountCurrent.value?.project_id)))

const money = cents => '¥' + (Number(cents || 0) / 100).toFixed(2)
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const statusLabel = row => ({ DELIVERED: '发送成功', ACCEPTED: row.billing_status === 'RESERVED' ? '等待回执' : '旧版仅受理', FAILED: '发送失败', RESERVED: '提交中', UNKNOWN: '待确认' })[row.status] || row.status
const canRelease = row => row.billing_status === 'RESERVED' && (row.status === 'UNKNOWN' || Date.now() - Date.parse(row.created_at) >= 86400000)
const modeLabel = mode => ({ METERED: '只按条', PACKAGE: '只套餐', HYBRID: '套餐+按条' })[mode] || mode
const cents = value => Math.round(Number(value || 0) * 100)

async function load() {
  loading.value = true
  try {
    const [s, t, p, a, c] = await Promise.all([
      props.api('/sms/settings'), props.api('/sms/templates'), props.api('/sms/packages'),
      props.api('/sms/accounts'), props.api('/sms/credentials')
    ])
    Object.assign(settings, s, { accessKeySecret: '', receiptKey: '' })
    templates.value = t
    packages.value = p
    accounts.value = a
    credentials.value = c
    await loadUsage()
  } catch (error) { ElMessage.error(error.message) }
  finally { loading.value = false }
}
async function loadUsage() {
  const sequence = ++usageSequence
  const query = usageProject.value ? '?projectId=' + encodeURIComponent(usageProject.value) : ''
  loadingUsage.value = true
  try {
    const [rows, summary] = await Promise.all([props.api('/sms/usage' + query), props.api('/sms/usage-summary' + query)])
    if (sequence === usageSequence) { usage.value = rows; usageSummary.value = summary }
  }
  catch (error) {
    if (sequence === usageSequence) { usage.value = []; usageSummary.value = null; ElMessage.error(error.message) }
  }
  finally { if (sequence === usageSequence) loadingUsage.value = false }
}
async function saveSettings() {
  saving.value = true
  try {
    Object.assign(settings, await props.api('/sms/settings', { method: 'PUT', body: {
      enabled: settings.enabled, endpoint: settings.endpoint, accessKeyId: settings.accessKeyId,
      accessKeySecret: settings.accessKeySecret, receiptKey: settings.receiptKey, defaultSignName: settings.defaultSignName, timeoutMs: settings.timeoutMs
    } }))
    settings.accessKeySecret = ''
    settings.receiptKey = ''
    ElMessage.success('接入配置已保存')
    await props.refresh?.()
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
async function seedTemplates() {
  saving.value = true
  try {
    const result = await props.api('/sms/templates/defaults', { method: 'POST' })
    await load()
    ElMessage.success(result.created?.length
      ? '已创建 ' + result.created.length + ' 个验证码模板；已复制现有模板的通道配置，请核对阿里云模板 Code 和状态'
      : '验证码模板已存在，无需重复创建')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
function openTemplate(row) {
  templateEditing.value = !!row
  for (const key of Object.keys(templateForm)) delete templateForm[key]
  Object.assign(templateForm, row ? {
    templateKey: row.template_key,
    name: row.name,
    scene: row.scene,
    signName: row.sign_name || '',
    providerTemplateCode: row.provider_template_code || '',
    billingUnits: row.billing_units || 1,
    billable: row.billable !== false,
    status: row.status || 'DRAFT',
    minClientVersion: row.min_client_version || '1.16.5'
  } : {
    templateKey: '', name: '', scene: '', signName: '', providerTemplateCode: '',
    billingUnits: 1, billable: true, status: 'DRAFT', minClientVersion: '1.16.5'
  })
  templateVariables.value = (row?.variables || []).map(item => ({ key: item.key, maxLength: item.maxLength || 40, required: item.required !== false }))
  if (!templateVariables.value.length) templateVariables.value.push({ key: 'code', maxLength: 40, required: true })
  templateVisible.value = true
}
async function saveTemplate() {
  if (!templateForm.templateKey || !templateForm.name) return ElMessage.warning('请填写模板键和名称')
  const body = { ...templateForm, variables: templateVariables.value.filter(item => item.key.trim()) }
  saving.value = true
  try {
    if (templateEditing.value) await props.api('/sms/templates/' + encodeURIComponent(templateForm.templateKey), { method: 'PUT', body })
    else await props.api('/sms/templates', { method: 'POST', body })
    templateVisible.value = false; await load(); ElMessage.success('模板已保存')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
async function deleteTemplate(row) {
  try {
    await ElMessageBox.confirm('删除模板「' + (row.name || row.template_key) + '」？已有发送记录的模板不能删除。', '删除短信模板', { type: 'warning' })
    await props.api('/sms/templates/' + encodeURIComponent(row.template_key), { method: 'DELETE' })
    await load(); ElMessage.success('模板已删除')
  } catch (error) { if (error !== 'cancel' && error?.message && error.message !== 'cancel') ElMessage.error(error.message) }
}
function openPackage(row) {
  packageEditing.value = !!row
  for (const key of Object.keys(packageForm)) delete packageForm[key]
  Object.assign(packageForm, row ? {
    id: row.id,
    code: row.code,
    name: row.name,
    messageCount: row.message_count,
    priceYuan: (Number(row.price_cents) / 100).toFixed(2),
    validityDays: row.validity_days,
    scopeType: row.scope_type,
    scopeId: row.scope_id || '',
    status: row.status,
    description: row.description || ''
  } : {
    id: '', code: '', name: '', messageCount: 100, priceYuan: '5.00', validityDays: 30,
    scopeType: 'GLOBAL', scopeId: '', status: 'DRAFT', description: ''
  })
  packageVisible.value = true
}
async function savePackage() {
  if (!packageForm.code || !packageForm.name) return ElMessage.warning('请填写套餐编码和名称')
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(packageForm.priceYuan))) return ElMessage.warning('请输入有效套餐价格')
  saving.value = true
  try {
    const body = {
      code: packageForm.code.trim(),
      name: packageForm.name.trim(),
      messageCount: packageForm.messageCount,
      priceCents: cents(packageForm.priceYuan),
      validityDays: packageForm.validityDays,
      scopeType: packageForm.scopeType,
      scopeId: packageForm.scopeType === 'PROJECT' ? packageForm.scopeId : null,
      status: packageForm.status,
      description: packageForm.description || ''
    }
    if (packageEditing.value) await props.api('/sms/packages/' + packageForm.id, { method: 'PUT', body })
    else await props.api('/sms/packages', { method: 'POST', body })
    packageVisible.value = false; await load(); ElMessage.success('套餐已保存')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
async function deletePackage(row) {
  try {
    await ElMessageBox.confirm('删除套餐「' + row.name + '」？已有购买或发放记录的套餐不能删除。', '删除短信套餐', { type: 'warning' })
    await props.api('/sms/packages/' + row.id, { method: 'DELETE' })
    await load(); ElMessage.success('套餐已删除')
  } catch (error) { if (error !== 'cancel' && error?.message && error.message !== 'cancel') ElMessage.error(error.message) }
}
function editAccount(row) {
  accountCurrent.value = row
  Object.assign(accountForm, { billingMode: row.billing_mode, priceYuan: (Number(row.unit_price_cents) / 100).toFixed(2), dailyLimit: row.daily_limit || 0, monthlyLimit: row.monthly_limit || 0, lowYuan: (Number(row.low_balance_cents || 0) / 100).toFixed(2), enabled: row.enabled !== 0 })
  accountVisible.value = true
}
async function saveAccount() {
  saving.value = true
  try {
    await props.api('/sms/accounts/' + accountCurrent.value.project_id, { method: 'PUT', body: { billingMode: accountForm.billingMode, unitPriceCents: cents(accountForm.priceYuan), dailyLimit: accountForm.dailyLimit, monthlyLimit: accountForm.monthlyLimit, lowBalanceCents: cents(accountForm.lowYuan), enabled: accountForm.enabled } })
    accountVisible.value = false; await load(); ElMessage.success('账户设置已保存')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
function openCredit(row) { accountCurrent.value = row; creditAmount.value = ''; creditReference.value = ''; creditVisible.value = true }
async function credit() {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(creditAmount.value)) || Number(creditAmount.value) <= 0) return ElMessage.warning('请输入有效充值金额')
  saving.value = true
  try {
    await props.api('/sms/accounts/' + accountCurrent.value.project_id + '/credit', { method: 'POST', body: { amountCents: cents(creditAmount.value), reference: creditReference.value } })
    creditVisible.value = false; await load(); ElMessage.success('充值已入账')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
function openGrant(row) { accountCurrent.value = row; grantPackageId.value = availablePackages.value[0]?.id || ''; grantVisible.value = true }
async function grantPackage() {
  if (!grantPackageId.value) return ElMessage.warning('请选择套餐')
  saving.value = true
  try {
    await props.api('/sms/accounts/' + accountCurrent.value.project_id + '/packages', { method: 'POST', body: { packageId: grantPackageId.value } })
    grantVisible.value = false; await load(); ElMessage.success('套餐已发放')
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
async function rotateCredential(row) {
  try {
    await ElMessageBox.confirm('旧 Secret 将立即失效，确定生成新凭据？', '轮换短信凭据', { type: 'warning' })
    const result = await props.api('/sms/credentials/' + row.instance_id + '/rotate', { method: 'POST' })
    credentialText.value = 'instanceId=' + result.instanceId + '\nclientSecret=' + result.secret + '\n'
    credentialVisible.value = true
    await load()
  } catch (error) { if (error?.message && error !== 'cancel') ElMessage.error(error.message) }
}
async function releaseUnknown(row) {
  try { await ElMessageBox.confirm('确认上游没有受理后释放预占？错误释放可能造成漏计费。', '释放未知请求', { type: 'warning' }); await props.api('/sms/requests/' + row.id + '/release', { method: 'POST' }); await loadUsage(); ElMessage.success('已释放预占') }
  catch (error) { if (error?.message && error !== 'cancel') ElMessage.error(error.message) }
}
onMounted(load)
</script>

<style scoped>
.sms-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.sms-head > div:first-child { display:grid; gap:5px; }
.sms-head-actions { display:flex; align-items:center; gap:10px; }
.sms-tabs { margin-top:18px; }
.sms-form { max-width:900px; }
.template-alert { margin:4px 0 16px; }
.label-with-help { display:inline-flex; align-items:center; gap:6px; }
.help-dot { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:#eef1f5; color:#667085; font-size:11px; cursor:help; }
.form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 22px; }
.form-actions { display:flex; justify-content:flex-end; margin-top:6px; }
.table-toolbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin:8px 0 16px; }
.toolbar-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.usage-summary { display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:14px;color:#667085;font-size:13px; }
.variable-list { width:100%; display:grid; gap:9px; }
.variable-row { display:grid; grid-template-columns:minmax(0,1fr) 120px 70px auto; align-items:center; gap:10px; }
.credential-table { margin-top:14px; }
.credential-secret { margin-top:18px; }
.muted { color:#78869a; font-size:13px; }
@media(max-width:720px){.form-grid{grid-template-columns:1fr}.sms-head{align-items:flex-start;flex-direction:column}.table-toolbar{align-items:flex-start;flex-direction:column}.variable-row{grid-template-columns:1fr 90px auto}.variable-row .el-checkbox{grid-column:1}.variable-row .el-button{grid-column:2/4}}
</style>
