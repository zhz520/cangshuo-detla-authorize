<template>
  <div class="page-container"><el-card><template #header><div class="header"><span>打赏记录</span><el-button @click="$router.push('/system/reward-grab')">打赏与抢单设置</el-button></div></template>
    <el-form inline :model="query" class="search-form">
      <el-form-item label="客户ID"><el-input v-model="query.userId" clearable style="width:110px" /></el-form-item>
      <el-form-item label="打手ID"><el-input v-model="query.playerId" clearable style="width:110px" /></el-form-item>
      <el-form-item label="订单号"><el-input v-model="query.orderNo" clearable /></el-form-item>
      <el-form-item label="状态"><el-select v-model="query.status" clearable style="width:140px"><el-option v-for="(name,key) in statuses" :key="key" :label="name" :value="key" /></el-select></el-form-item>
      <el-form-item label="时间"><el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" /></el-form-item>
      <el-button type="primary" @click="search">查询</el-button>
    </el-form>
    <el-alert title="打手余额不足时标记待追回，双方余额保持不变；余额充足后点击重试冲正。原记录和操作日志永久保留。" type="info" :closable="false" style="margin-bottom:16px" />
    <el-table :data="records" v-loading="loading">
      <el-table-column prop="rewardNo" label="打赏编号" min-width="220" />
      <el-table-column prop="orderNo" label="来源订单" min-width="190" />
      <el-table-column prop="userId" label="客户ID" width="85" /><el-table-column prop="playerId" label="打手ID" width="85" />
      <el-table-column prop="amount" label="打赏金额" width="100" /><el-table-column prop="fee" label="服务费" width="90" /><el-table-column prop="income" label="打手实收" width="100" />
      <el-table-column label="状态" width="120"><template #default="{row}"><el-tag :type="row.status==='REVERSAL_PENDING'?'warning':row.status==='REVERSED'?'info':'success'">{{ statuses[row.status] }}</el-tag></template></el-table-column>
      <el-table-column prop="pendingRecovery" label="待追回" width="100" /><el-table-column prop="createdAt" label="时间" min-width="170" />
      <el-table-column label="操作" width="100" :fixed="isCompact ? false : 'right'"><template #default="{row}"><el-button link @click="show(row)">详情</el-button><el-button v-if="row.status!=='REVERSED'" link type="danger" @click="reverse(row)">{{ row.status==='REVERSAL_PENDING'?'重试冲正':'冲正' }}</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.pageNum" :page-size="20" :total="total" :pager-count="isCompact ? 5 : 7" layout="total, prev, pager, next" @current-change="load" style="margin-top:20px" />
  </el-card><el-dialog v-model="visible" title="打赏详情" width="680px"><el-descriptions v-if="selected" :column="1" border><el-descriptions-item v-for="(label,key) in detailFields" :key="key" :label="label">{{ selected[key] ?? '-' }}</el-descriptions-item></el-descriptions><p>以上余额为操作时的账目快照；管理操作记录可在系统操作日志中查询。</p></el-dialog></div>
</template>
<script setup>
import { useResponsive } from '@/utils/responsive'
import {ref,reactive,onMounted} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {getRewards,reverseReward} from '@/api/reward'
const { isCompact } = useResponsive()

const query=reactive({pageNum:1,pageSize:20,userId:'',playerId:'',orderNo:'',status:''}),dates=ref([]),records=ref([]),total=ref(0),loading=ref(false),visible=ref(false),selected=ref(null)
const statuses={PAID:'已到账',REVERSAL_PENDING:'待追回',REVERSED:'已冲正'}
const detailFields={rewardNo:'打赏编号',orderNo:'来源订单',userId:'客户ID',playerId:'打手ID',amount:'打赏金额',feePercent:'服务费比例（%）',fee:'服务费',income:'打手实收',remark:'打赏备注',userBalanceBefore:'客户打赏前余额',userBalanceAfter:'客户打赏后余额',playerBalanceBefore:'打手到账前余额',playerBalanceAfter:'打手到账后余额',reversalUserBalanceBefore:'客户冲正前余额',reversalUserBalanceAfter:'客户冲正后余额',reversalPlayerBalanceBefore:'打手冲正前余额',reversalPlayerBalanceAfter:'打手冲正后余额',pendingRecovery:'待追回金额',reversalReason:'冲正原因',reversalAdminId:'冲正管理员',reversedAt:'冲正完成时间',createdAt:'打赏时间'}
onMounted(load)
function search(){query.pageNum=1;load()}
async function load(){loading.value=true;try{const {data}=await getRewards({...query,startDate:dates.value?.[0],endDate:dates.value?.[1]});records.value=data.records;total.value=data.total}finally{loading.value=false}}
function show(row){selected.value=row;visible.value=true}
async function reverse(row){let reason;try{const result=await ElMessageBox.prompt(`冲正打赏 ¥${row.amount}，退回客户余额并扣回打手实收 ¥${row.income}。请输入原因。`,'异常打赏冲正',{inputType:'textarea',inputValidator:v=>!!v?.trim()&&v.trim().length<=200||'请输入1～200字原因',confirmButtonText:'确认冲正'});reason=result.value.trim()}catch(_){return}const {data}=await reverseReward(row.id,reason);ElMessage.success(data.status==='REVERSAL_PENDING'?'已记录待追回，余额充足后可重试':'冲正完成');load()}
</script>
<style scoped>.header{display:flex;align-items:center;justify-content:space-between}</style>
