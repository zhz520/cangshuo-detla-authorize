<template>
  <el-card shadow="never">
    <template #header><div class="usage-head"><strong>实名核验服务账户</strong><el-button :loading="loading" @click="load">刷新</el-button></div></template>
    <el-alert title="按次核验使用独立服务余额；客户功能授权与核验余额是两层控制，缺一不可。" type="info" :closable="false" show-icon/>
    <el-table :data="rows" stripe v-loading="loading" class="usage-table">
      <el-table-column prop="customer_name" label="客户" min-width="130"/>
      <el-table-column label="实例" min-width="210"><template #default="{row}"><span>{{ row.instance_name }}</span><br/><small class="muted">{{ row.instance_id }}</small></template></el-table-column>
      <el-table-column label="可用余额" width="120"><template #default="{row}">{{ money(row.balance_cents) }}</template></el-table-column>
      <el-table-column label="冻结金额" width="120"><template #default="{row}">{{ money(row.reserved_cents) }}</template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'danger'">{{ row.status==='ACTIVE'?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="更新时间" min-width="170"><template #default="{row}">{{ time(row.updated_at) }}</template></el-table-column>
      <el-table-column label="操作" min-width="240" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openCredit(row)">充值</el-button><el-button link @click="showDetail(row)">流水</el-button><el-button link :type="row.status==='ACTIVE'?'danger':'success'" @click="toggle(row)">{{ row.status==='ACTIVE'?'停用':'启用' }}</el-button></template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="creditVisible" title="服务账户充值" width="min(460px,94vw)">
    <p class="muted">{{ current?.customer_name }} / {{ current?.instance_name }}</p>
    <el-form label-position="top"><el-form-item label="充值金额（元）"><el-input v-model="creditAmount" inputmode="decimal" placeholder="如 100.00"/></el-form-item><el-form-item label="充值引用"><el-input v-model="creditReference" maxlength="128" placeholder="如 线下收款单号"/></el-form-item></el-form>
    <template #footer><el-button @click="creditVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="credit">确认充值</el-button></template>
  </el-dialog>

  <el-drawer v-model="detailVisible" :title="`${current?.instance_name || ''} · 核验流水`" size="min(92vw, 760px)">
    <el-tabs v-model="detailTab">
      <el-tab-pane label="核验请求" name="requests"><el-table :data="requests" stripe><el-table-column prop="status" label="状态" width="100"/><el-table-column label="单价" width="100"><template #default="{row}">{{ money(row.price_cents) }}</template></el-table-column><el-table-column prop="result" label="结果" min-width="150"/><el-table-column label="时间" min-width="170"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column></el-table></el-tab-pane>
      <el-tab-pane label="资金流水" name="ledger"><el-table :data="ledger" stripe><el-table-column prop="type" label="类型" width="100"/><el-table-column label="金额" width="110"><template #default="{row}">{{ money(row.amount_cents) }}</template></el-table-column><el-table-column label="余额" width="110"><template #default="{row}">{{ money(row.balance_after) }}</template></el-table-column><el-table-column prop="reference" label="引用" min-width="170"/><el-table-column label="时间" min-width="170"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column></el-table></el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
const props = defineProps({ api: Function })
const rows = ref([]), loading = ref(false), saving = ref(false)
const current = ref(null), creditVisible = ref(false), creditAmount = ref(''), creditReference = ref('')
const detailVisible = ref(false), detailTab = ref('requests'), requests = ref([]), ledger = ref([])
const money = cents => '¥' + (Number(cents || 0) / 100).toFixed(2)
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
async function load() {
  loading.value = true
  try { rows.value = await props.api('/usage/accounts') }
  catch (error) { ElMessage.error(error.message) }
  finally { loading.value = false }
}
function openCredit(row) { current.value = row; creditAmount.value = ''; creditReference.value = ''; creditVisible.value = true }
async function credit() {
  const value = String(creditAmount.value || '').trim()
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) return ElMessage.warning('请输入有效充值金额')
  saving.value = true
  try {
    await props.api(`/usage/accounts/${current.value.instance_id}/credit`, { method: 'POST', body: { amountCents: Math.round(Number(value) * 100), reference: creditReference.value.trim() } })
    ElMessage.success('充值已入账'); creditVisible.value = false; await load()
  } catch (error) { ElMessage.error(error.message) }
  finally { saving.value = false }
}
async function toggle(row) {
  const next = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
  try { await ElMessageBox.confirm(`确定${next === 'ACTIVE' ? '启用' : '停用'}该实例的实名核验服务账户？`, '确认操作'); await props.api(`/usage/accounts/${row.instance_id}/status`, { method: 'PUT', body: { status: next } }); await load() }
  catch (error) { if (error?.message && error !== 'cancel') ElMessage.error(error.message) }
}
async function showDetail(row) {
  current.value = row; detailTab.value = 'requests'; detailVisible.value = true
  try {
    ;[requests.value, ledger.value] = await Promise.all([
      props.api(`/usage/requests?instanceId=${encodeURIComponent(row.instance_id)}`),
      props.api(`/usage/ledger?instanceId=${encodeURIComponent(row.instance_id)}`)
    ])
  } catch (error) { ElMessage.error(error.message) }
}
onMounted(load)
</script>

<style scoped>.usage-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.usage-table{margin-top:18px}@media(max-width:600px){.usage-head{align-items:flex-start;flex-direction:column}}</style>
