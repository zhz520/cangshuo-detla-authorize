<template>
  <div v-loading="loading" class="analysis-page">
    <el-result v-if="checked && !enabled" icon="info" title="收益对比分析尚未启用" sub-title="请先在功能商城导入有效授权并启用此模块。原有收益日报继续可用。">
      <template #extra><el-button type="primary" @click="$router.push('/platform/features')">前往功能商城</el-button><el-button @click="$router.push('/statistics/income-daily')">查看收益日报</el-button></template>
    </el-result>
    <template v-if="enabled">
      <el-card shadow="never">
        <template #header><h2>收益对比分析</h2></template>
        <el-form inline><el-form-item label="结算日期"><el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="date => date > new Date()" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" /></el-form-item><el-form-item><el-button type="primary" @click="loadReport">查询</el-button><el-button :disabled="!report" @click="exportCsv">导出每日汇总</el-button></el-form-item></el-form>
        <el-alert v-if="report" :title="report.basis" type="info" :closable="false" />
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      </el-card>
      <el-card v-if="report" shadow="never">
        <template #header>周期对比</template>
        <p class="period">当前周期 {{ report.current.startDate }} 至 {{ report.current.endDate }} · 上一周期 {{ report.previous.startDate }} 至 {{ report.previous.endDate }}</p>
        <el-table :data="metrics" stripe><el-table-column prop="name" label="指标" min-width="140" /><el-table-column label="当前周期" min-width="140"><template #default="{ row }">{{ metricValue(row, report.current.summary[row.key]) }}</template></el-table-column><el-table-column label="上一周期" min-width="140"><template #default="{ row }">{{ metricValue(row, report.previous.summary[row.key]) }}</template></el-table-column><el-table-column label="变化率" min-width="120"><template #default="{ row }">{{ report.changePercent[row.key] == null ? '上期为零，不计算' : Number(report.changePercent[row.key]).toFixed(2) + '%' }}</template></el-table-column></el-table>
      </el-card>
      <el-card v-if="report" shadow="never">
        <template #header>当前周期每日收益</template>
        <el-table :data="report.current.days" stripe><el-table-column prop="date" label="结算日期" min-width="140" /><el-table-column prop="orderCount" label="已结算订单数" min-width="120" /><el-table-column v-for="column in metrics.filter(item => !['orderCount', 'averageOrderAmount'].includes(item.key))" :key="column.key" :label="column.name" min-width="140"><template #default="{ row }">{{ metricValue(column, row[column.key]) }}</template></el-table-column></el-table>
      </el-card>
    </template>
    <el-alert v-if="error && !enabled" :title="error" type="error" :closable="false" show-icon />
  </div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { getPlatformFeatures, getIncomeComparison } from '@/api/platform'
const loading = ref(false), checked = ref(false), enabled = ref(false), error = ref(''), report = ref(null)
function formatDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const end = new Date(), start = new Date(); start.setDate(end.getDate() - 29)
const range = ref([formatDate(start), formatDate(end)])
const metrics = [{key:'orderCount', name:'已结算订单数'}, {key:'orderAmount', name:'已结算订单金额'}, {key:'playerIncome', name:'打手收入'}, {key:'commissionIncome', name:'平台抽成'}, {key:'averageOrderAmount', name:'平均订单金额'}]
function metricValue(metric, value) { return metric.key === 'orderCount' ? String(value ?? 0) : `¥${Number(value ?? 0).toFixed(2)}` }
async function loadReport() {
  if (!range.value?.[0] || !range.value?.[1]) return
  loading.value = true; error.value = ''; report.value = null
  try { report.value = (await getIncomeComparison({startDate:range.value[0], endDate:range.value[1]})).data }
  catch { error.value = '报表加载失败，请检查日期范围和模块授权后重试。' }
  finally { loading.value = false }
}
function exportCsv() {
  if (!report.value) return
  const rows = [['周期', '结算日期', '已结算订单数', '订单金额', '打手收入', '平台抽成']]
  for (const [key, name] of [['current','当前周期'], ['previous','上一周期']]) for (const day of report.value[key].days) rows.push([name,day.date,day.orderCount,day.orderAmount,day.playerIncome,day.commissionIncome])
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'})), anchor = document.createElement('a')
  anchor.href = url; anchor.download = `收益对比-${report.value.current.startDate}-${report.value.current.endDate}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onMounted(async () => {
  loading.value = true
  try { enabled.value = (await getPlatformFeatures()).data.some(feature => feature.id === 'advanced_income_reports' && feature.enabled); checked.value = true; if (enabled.value) await loadReport() }
  catch { error.value = '无法确认模块授权，请刷新后重试。' }
  finally { loading.value = false }
})
</script>
<style scoped>
.analysis-page { display: grid; gap: 18px; }
h2 { margin: 0; font-size: 20px; }
.period { color: #73777e; font-size: 13px; line-height: 1.8; }
</style>
