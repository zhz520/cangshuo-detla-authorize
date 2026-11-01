<template>
  <div class="page-container">
    <el-card>
      <template #header><div class="player-header"><span>打手管理</span><el-button v-if="isAdmin" @click="$router.push('/player-level')">管理等级分类</el-button></div></template>
      <el-form :inline="true" :model="query" class="search-form">
        <el-form-item><el-input v-model="query.keyword" placeholder="搜索打手" clearable @keyup.enter="fetchData" /></el-form-item>
        <el-form-item>
          <el-select v-model="query.status" placeholder="状态" clearable>
            <el-option label="待审核" value="PENDING" /><el-option label="正常" value="ACTIVE" />
            <el-option label="已驳回" value="REJECTED" /><el-option label="已冻结" value="FROZEN" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="fetchData">查询</el-button><el-button @click="query.keyword='';query.status='';fetchData()">重置</el-button></el-form-item>
      </el-form>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="头像" width="80">
          <template #default="{ row }">
            <el-avatar :src="row.avatar" :size="32">{{ (row.nickname || '')[0] || '打' }}</el-avatar>
          </template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" width="140" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column prop="realName" label="真实姓名" width="100" />
        <el-table-column prop="level" label="等级" width="90"><template #default="{ row }"><el-tag type="info" size="small">{{ levelLabel(row.level) }}</el-tag></template></el-table-column>
        <el-table-column prop="completedOrders" label="完成订单" width="100" />
        <el-table-column prop="balance" label="余额" width="100"><template #default="{ row }">¥{{ row.balance || 0 }}</template></el-table-column>
        <el-table-column prop="depositPaymentNo" label="押金订单号" width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.depositPaymentNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" min-width="150">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
            <div v-if="row.status === 'FROZEN' && row.frozenUntil" style="font-size:12px;color:#999;margin-top:2px">解冻时间：{{ row.frozenUntil }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="注册时间" width="170" />
        <el-table-column label="操作" width="360" :fixed="isCompact ? false : 'right'">
          <template #default="{ row }">
            <el-button link type="primary" @click="showDetail(row.id)">详情</el-button>
            <el-button link type="primary" @click="openEditDialog(row)">{{ isAdmin ? '编辑' : '改名' }}</el-button>
            <el-button link type="info" @click="showPlayerOrders(row)">订单</el-button>
            <el-button v-if="isAdmin" link type="primary" @click="showPlayerReviews(row)">评价</el-button>
            <template v-if="row.status === 'PENDING'">
              <el-button link type="success" @click="handleApprove(row.id)">通过</el-button>
              <el-button link type="danger" @click="openRejectDialog(row.id)">驳回</el-button>
            </template>
            <el-button v-if="row.status === 'ACTIVE'" link type="warning" @click="openFreezeDialog(row)">冻结</el-button>
            <el-popconfirm v-if="row.status === 'FROZEN'" title="确认解冻？" @confirm="handleUnfreeze(row.id)">
              <template #reference><el-button link type="success">解冻</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <Pagination :total="total" v-model:page="query.pageNum" v-model:limit="query.pageSize" @pagination="fetchData" />
    </el-card>
    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejectDialogVisible" title="驳回原因" width="400px">
      <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="请输入驳回原因" />
      <template #footer><el-button @click="rejectDialogVisible = false">取消</el-button><el-button type="primary" @click="handleReject">确定驳回</el-button></template>
    </el-dialog>
    <!-- 打手详情弹窗（精简版） -->
    <el-dialog v-model="detailVisible" title="打手详情" width="980px" destroy-on-close>
      <div v-loading="detailLoading" class="player-detail">
        <template v-if="detailData">
        <div class="player-detail-header">
          <el-avatar :src="detailData.avatar" :size="56">{{ (detailData.nickname || '')[0] || '打' }}</el-avatar>
          <div class="player-detail-main">
            <div class="player-detail-name">{{ detailData.nickname || ('ID: ' + detailData.id) }}</div>
            <div class="player-detail-sub">
              <span class="player-detail-id">ID: {{ detailData.id }}</span>
              <el-tag :type="statusTagType(detailData.status)" size="small" style="margin-left:8px">
                {{ statusText(detailData.status) }}
              </el-tag>
            </div>
          </div>
        </div>
        <el-descriptions :column="isNarrow ? 1 : 2" border size="small" style="margin-top:16px">
          <el-descriptions-item label="手机号">{{ detailData.phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="等级">{{ levelLabel(detailData.level) }}</el-descriptions-item>
          <el-descriptions-item label="个人简介" :span="2"><span class="introduction-text">{{ detailData.introduction || '暂未填写' }}</span></el-descriptions-item>
          <el-descriptions-item label="余额">¥{{ detailData.balance || 0 }}</el-descriptions-item>
          <el-descriptions-item label="完成订单">{{ detailData.completedOrders || 0 }}</el-descriptions-item>
          <el-descriptions-item label="评分">{{ detailData.avgRating || '-' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间" :span="2">{{ detailData.createdAt }}</el-descriptions-item>
          <el-descriptions-item v-if="detailData.depositPaymentNo" label="押金订单号" :span="2">
            {{ detailData.depositPaymentNo }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detailData.rejectReason" label="驳回原因" :span="2">
            {{ detailData.rejectReason }}
          </el-descriptions-item>
        </el-descriptions>
        <GrabVerificationStats v-if="isAdmin" :player-id="detailData.id" />
        <el-divider content-position="left">金额变化详情</el-divider>
        <el-table :data="playerTransactions" v-loading="transactionLoading" stripe size="small" max-height="360">
          <el-table-column prop="createdAt" label="时间" width="170" />
          <el-table-column prop="type" label="类型" width="130">
            <template #default="{ row }">{{ transactionTypeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="amount" label="金额" width="110">
            <template #default="{ row }">
              <span :class="transactionAmountClass(row.amount)">¥{{ formatTransactionAmount(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="balanceBefore" label="变动前" width="110">
            <template #default="{ row }">¥{{ formatTransactionAmount(row.balanceBefore) }}</template>
          </el-table-column>
          <el-table-column prop="balanceAfter" label="变动后" width="110">
            <template #default="{ row }">¥{{ formatTransactionAmount(row.balanceAfter) }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="220" show-overflow-tooltip />
        </el-table>
        <Pagination
          :total="transactionTotal"
          v-model:page="transactionQuery.pageNum"
          v-model:limit="transactionQuery.pageSize"
          @pagination="fetchPlayerTransactions"
        />
        </template>
      </div>
    </el-dialog>
    <!-- 打手编辑弹窗 -->
    <el-dialog v-model="editVisible" :title="isAdmin ? '编辑打手信息' : '修改昵称'" width="720px" destroy-on-close>
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" placeholder="请输入昵称" maxlength="20" />
        </el-form-item>
        <template v-if="isAdmin">
          <el-form-item label="真实姓名">
            <el-input v-model="editForm.realName" placeholder="请输入真实姓名" maxlength="20" />
          </el-form-item>
          <el-form-item label="抢单验证"><el-select v-model="editForm.grabCaptchaOverride"><el-option label="跟随等级" :value="-1"/><el-option label="必须图形验证" :value="1"/><el-option label="免验证" :value="0"/></el-select></el-form-item>
          <el-form-item label="等级">
            <el-select v-model="editForm.level" placeholder="请选择等级分类"><el-option v-for="level in levelOptions" :key="level.id" :label="level.name + (level.status===0?'（已停用）':'')" :value="level.id"/></el-select>
          </el-form-item>
          <el-form-item label="下单涨价">
            <el-select :model-value="editForm.priceIncreaseRate < 0 ? 'level' : 'custom'" @update:model-value="editForm.priceIncreaseRate=$event==='level'?-1:0">
              <el-option label="跟随等级涨价" value="level"/><el-option label="单独设置涨价" value="custom"/>
            </el-select>
            <div v-if="editForm.priceIncreaseRate >= 0" style="margin-top:8px;width:100%"><el-input-number v-model="editForm.priceIncreaseRate" :min="0" :max="100" :precision="2"/> %</div>
            <div style="width:100%;color:#858992;font-size:12px">仅指定该打手下单时生效，0% 表示不涨价；已有订单金额不变。</div>
          </el-form-item>
          <el-form-item label="个人简介">
            <el-input v-model="editForm.introduction" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="公开展示在打手个人主页" />
          </el-form-item>
          <PlayerHomepageFields :model="editForm" @busy="mediaBusy=$event"/>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" :disabled="mediaBusy" @click="handleEditSave">保存</el-button>
      </template>
    </el-dialog>
    <!-- 打手订单弹窗 -->
    <el-dialog v-model="ordersVisible" :title="ordersPlayerName + ' 的订单'" width="800px" destroy-on-close>
      <el-table :data="playerOrders" v-loading="ordersLoading" stripe size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="orderNo" label="订单号" width="180" />
        <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column prop="amount" label="金额" width="90">
          <template #default="{ row }">¥{{ row.amount }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="orderTagType(row.status)" size="small">{{ orderStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="下单时间" width="170" />
      </el-table>
      <Pagination :total="ordersTotal" v-model:page="ordersQuery.pageNum" v-model:limit="ordersQuery.pageSize" @pagination="fetchPlayerOrders" />
    </el-dialog>
    <!-- 冻结弹窗 -->
    <el-dialog v-if="isAdmin" v-model="reviewsVisible" :title="reviewsPlayerName + ' 的评价'" width="850px" destroy-on-close>
      <el-table :data="playerReviews" v-loading="reviewsLoading" stripe empty-text="暂无评价">
        <el-table-column prop="userNickname" label="评价用户" width="100" />
        <el-table-column prop="rating" label="评分" width="70"><template #default="{ row }">{{ row.rating }} 星</template></el-table-column>
        <el-table-column prop="content" label="评价内容" min-width="240"><template #default="{ row }"><span class="introduction-text">{{ row.content }}</span></template></el-table-column>
        <el-table-column prop="createdAt" label="评价时间" width="170" />
        <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="danger" @click="deleteReview(row)">删除</el-button></template></el-table-column>
      </el-table>
      <Pagination :total="reviewsTotal" v-model:page="reviewsQuery.pageNum" v-model:limit="reviewsQuery.pageSize" @pagination="fetchPlayerReviews" />
    </el-dialog>
    <el-dialog v-model="freezeVisible" title="冻结打手" width="450px">
      <p v-if="freezeRow" style="margin-bottom:16px">打手：<b>{{ freezeRow.nickname }}</b>（{{ freezeRow.phone || '-' }}）</p>
      <el-form label-width="100px">
        <el-form-item label="冻结时长">
          <el-select v-model="freezeDuration" placeholder="选择冻结时长" style="width:100%">
            <el-option label="1天" :value="1" />
            <el-option label="3天" :value="3" />
            <el-option label="7天" :value="7" />
            <el-option label="15天" :value="15" />
            <el-option label="30天" :value="30" />
            <el-option label="永久冻结" :value="-1" />
            <el-option label="自定义" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="freezeDuration === 0" label="解冻时间">
          <el-date-picker v-model="freezeCustomDate" type="datetime" placeholder="选择解冻时间" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="freezeVisible = false">取消</el-button>
        <el-button type="primary" :loading="freezeSubmitting" @click="handleFreeze">确认冻结</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<script setup>
import { useResponsive } from '@/utils/responsive'
import GrabVerificationStats from '@/components/GrabVerificationStats.vue'
import { ref, reactive, onMounted } from 'vue'
import { adminPlayerList, adminPlayerDetail, adminPlayerTransactions, adminPlayerApprove, adminPlayerReject, adminPlayerUpdateStatus, adminPlayerFreeze, adminPlayerUnfreeze, adminPlayerUpdate, csPlayerList, csPlayerDetail, csPlayerTransactions, csPlayerAudit, csPlayerFreeze, csPlayerUpdateNickname, adminOrderList, csOrderList } from '@/api/business'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminReviewList, adminReviewDelete } from '@/api/business'
import Pagination from '@/components/Pagination.vue'
import PlayerHomepageFields from '@/components/PlayerHomepageFields.vue'
import {playerLevelList} from '@/api/business'
const { isCompact, isNarrow } = useResponsive()

const userStore = useUserStore()
const isAdmin = userStore.role === 'admin'
const levelOptions=ref([]),mediaBusy=ref(false)
function levelLabel(id){return levelOptions.value.find(l=>l.id===id)?.name || `Lv.${id||1}`}
onMounted(async()=>{if(isAdmin)levelOptions.value=(await playerLevelList()).data||[]})
const loading = ref(false), list = ref([]), total = ref(0)
const query = reactive({ pageNum: 1, pageSize: 10, keyword: '', status: '' })
const statusMap = { PENDING: '待审核', ACTIVE: '正常', REJECTED: '已驳回', FROZEN: '已冻结' }
const statusTagMap = { PENDING: 'warning', ACTIVE: 'success', REJECTED: 'danger', FROZEN: 'info' }
function statusText(s) { return statusMap[s] || s }
function statusTagType(s) { return statusTagMap[s] || '' }
async function fetchData() {
  loading.value = true
  try {
    const fn = isAdmin ? adminPlayerList : csPlayerList
    const res = await fn(query)
    list.value = res.data.records; total.value = Number(res.data.total)
  } finally { loading.value = false }
}
async function handleApprove(id) {
  if (isAdmin) await adminPlayerApprove(id)
  else await csPlayerAudit(id, 'ACTIVE', '')
  ElMessage.success('已通过'); fetchData()
}
const rejectDialogVisible = ref(false), rejectId = ref(null), rejectReason = ref('')
function openRejectDialog(id) { rejectId.value = id; rejectReason.value = ''; rejectDialogVisible.value = true }
async function handleReject() {
  if (isAdmin) await adminPlayerReject(rejectId.value, rejectReason.value)
  else await csPlayerAudit(rejectId.value, 'REJECTED', rejectReason.value)
  ElMessage.success('已驳回'); rejectDialogVisible.value = false; fetchData()
}
// 冻结弹窗
const freezeVisible = ref(false), freezeRow = ref(null), freezeDuration = ref(7), freezeCustomDate = ref(''), freezeSubmitting = ref(false)
function openFreezeDialog(row) {
  freezeRow.value = row; freezeDuration.value = 7; freezeCustomDate.value = ''; freezeVisible.value = true
}
async function handleFreeze() {
  let frozenUntil = null
  if (freezeDuration.value === -1) {
    frozenUntil = '2099-12-31 23:59:59'
  } else if (freezeDuration.value === 0) {
    if (!freezeCustomDate.value) return ElMessage.warning('请选择解冻时间')
    frozenUntil = freezeCustomDate.value
  } else {
    const d = new Date(); d.setDate(d.getDate() + freezeDuration.value)
    frozenUntil = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0')
  }
  freezeSubmitting.value = true
  try {
    if (isAdmin) await adminPlayerFreeze(freezeRow.value.id, { frozenUntil })
    else await csPlayerFreeze(freezeRow.value.id)
    ElMessage.success('已冻结'); freezeVisible.value = false; fetchData()
  } finally { freezeSubmitting.value = false }
}
async function handleUnfreeze(id) {
  if (isAdmin) await adminPlayerUnfreeze(id)
  else await adminPlayerUpdateStatus(id, 'ACTIVE')
  ElMessage.success('已解冻'); fetchData()
}
const detailVisible = ref(false), detailData = ref(null), detailLoading = ref(false)
const transactionLoading = ref(false)
const playerTransactions = ref([])
const transactionTotal = ref(0)
const transactionQuery = reactive({ pageNum: 1, pageSize: 5, playerId: null })
const transactionTypeMap = {
  REWARD_PAY:'打赏支出', REWARD_INCOME:'打赏收入', REWARD_REFUND:'打赏退款', REWARD_REVERSAL:'打赏冲正',
  ADMIN_RECHARGE: '管理员充值',
  ADMIN_DEDUCT: '管理员扣款',
  INCOME: '收益入账',
  WITHDRAW: '提现申请',
  WITHDRAW_COMPLETE: '提现完成',
  WITHDRAW_REJECT: '提现驳回',
  CONSUMPTION: '订单扣款',
  REFUND: '退款入账'
}
function transactionTypeLabel(type) {
  return transactionTypeMap[type] || type || '-'
}
function formatTransactionAmount(amount) {
  const value = Number(amount || 0)
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}
function transactionAmountClass(amount) {
  return Number(amount || 0) >= 0 ? 'amount-positive' : 'amount-negative'
}
async function fetchPlayerTransactions() {
  if (!transactionQuery.playerId) return
  transactionLoading.value = true
  try {
    const params = { pageNum: transactionQuery.pageNum, pageSize: transactionQuery.pageSize }
    const fn = isAdmin ? adminPlayerTransactions : csPlayerTransactions
    const res = await fn(transactionQuery.playerId, params)
    playerTransactions.value = res.data?.records || []
    transactionTotal.value = Number(res.data?.total || 0)
  } finally {
    transactionLoading.value = false
  }
}
async function showDetail(id) {
  detailVisible.value = true
  detailLoading.value = true
  detailData.value = null
  transactionQuery.playerId = id
  transactionQuery.pageNum = 1
  playerTransactions.value = []
  transactionTotal.value = 0
  try {
    const detailFn = isAdmin ? adminPlayerDetail : csPlayerDetail
    await Promise.all([
      detailFn(id).then(res => { detailData.value = res.data }),
      fetchPlayerTransactions()
    ])
  } finally {
    detailLoading.value = false
  }
}

// 编辑打手
const editVisible = ref(false)
const editSaving = ref(false)
const editForm = reactive({ id: null, nickname: '', realName: '', level: 1, grabCaptchaOverride:-1, priceIncreaseRate:-1, introduction: '', avatar:'',coverImage:'',albumImages:[],story:'',voiceUrl:'',voiceDuration:0 })
function openEditDialog(row) {
  editForm.id = row.id
  editForm.nickname = row.nickname || ''
  editForm.realName = row.realName || ''
  editForm.level = row.level || 1
  editForm.grabCaptchaOverride=row.grabCaptchaOverride??-1
  editForm.priceIncreaseRate=Number(row.priceIncreaseRate??-1)
  editForm.introduction = row.introduction || ''
  for(const key of ['avatar','coverImage','story','voiceUrl'])editForm[key]=row[key]||''
  editForm.voiceDuration=row.voiceDuration||0
  try{editForm.albumImages=Array.isArray(row.albumImages)?[...row.albumImages]:JSON.parse(row.albumImages||'[]')}catch(_){editForm.albumImages=[]}
  editVisible.value = true
}
async function handleEditSave() {
  if (!editForm.id) return
  editSaving.value = true
  try {
    if (isAdmin) {
      await adminPlayerUpdate(editForm.id, {
        nickname: editForm.nickname,
        realName: editForm.realName,
        level: editForm.level, grabCaptchaOverride:editForm.grabCaptchaOverride, priceIncreaseRate:editForm.priceIncreaseRate,
        introduction: editForm.introduction,avatar:editForm.avatar,coverImage:editForm.coverImage,albumImages:editForm.albumImages.filter(Boolean),story:editForm.story,voiceUrl:editForm.voiceUrl,voiceDuration:editForm.voiceDuration
      })
    } else {
      await csPlayerUpdateNickname(editForm.id, editForm.nickname)
    }
    ElMessage.success('保存成功')
    editVisible.value = false
    fetchData()
    if (detailVisible.value && detailData.value?.id === editForm.id) {
      showDetail(editForm.id)
    }
  } finally {
    editSaving.value = false
  }
}

// 打手订单
const reviewsVisible = ref(false), reviewsLoading = ref(false), reviewsPlayerName = ref('')
const playerReviews = ref([]), reviewsTotal = ref(0)
const reviewsQuery = reactive({ pageNum: 1, pageSize: 10, playerId: null })
function showPlayerReviews(row) {
  reviewsPlayerName.value = row.nickname || ('ID: ' + row.id)
  reviewsQuery.playerId = row.id; reviewsQuery.pageNum = 1
  playerReviews.value = []; reviewsTotal.value = 0; reviewsVisible.value = true
  fetchPlayerReviews()
}
async function fetchPlayerReviews() {
  reviewsLoading.value = true
  try {
    const res = await adminReviewList(reviewsQuery)
    playerReviews.value = res.data?.records || []; reviewsTotal.value = Number(res.data?.total || 0)
  } finally { reviewsLoading.value = false }
}
async function deleteReview(review) {
  try { await ElMessageBox.confirm('删除后该评价将不再公开显示，打手和商品评分会重新计算。', '删除评价', { type: 'warning' }) }
  catch (_) { return }
  await adminReviewDelete(review.id)
  ElMessage.success('评价已删除')
  if (playerReviews.value.length === 1 && reviewsQuery.pageNum > 1) reviewsQuery.pageNum--
  await Promise.all([fetchPlayerReviews(), fetchData()])
  if (detailVisible.value && detailData.value?.id === reviewsQuery.playerId) showDetail(reviewsQuery.playerId)
}
const orderStatusMap = {
  PENDING_PAYMENT: '待支付', PAID: '待接单', ASSIGNED: '已指派', ACCEPTED: '已接单',
  WAITING_TEAMMATE: '组队中', IN_PROGRESS: '进行中', COMPLETED: '待确认',
  CONFIRMED: '已完成', REVIEWED: '已评价', CANCELLED: '已取消',
  REFUNDING: '退款中', REFUNDED: '已退款', DISPUTED: '争议中', ARBITRATED: '已仲裁'
}
const orderTagTypeMap = {
  PENDING_PAYMENT: 'info', PAID: '', ASSIGNED: '', ACCEPTED: '',
  WAITING_TEAMMATE: '', IN_PROGRESS: 'warning', COMPLETED: 'success',
  CONFIRMED: 'success', REVIEWED: 'success', CANCELLED: 'info',
  REFUNDING: 'danger', REFUNDED: 'info', DISPUTED: 'danger', ARBITRATED: 'info'
}
function orderStatusLabel(s) { return orderStatusMap[s] || s }
function orderTagType(s) { return orderTagTypeMap[s] || '' }

const ordersVisible = ref(false), ordersLoading = ref(false)
const playerOrders = ref([]), ordersTotal = ref(0), ordersPlayerName = ref('')
const ordersQuery = reactive({ pageNum: 1, pageSize: 10, playerId: null })

function showPlayerOrders(row) {
  ordersPlayerName.value = row.nickname || ('ID: ' + row.id)
  ordersQuery.playerId = row.id
  ordersQuery.pageNum = 1
  playerOrders.value = []
  ordersVisible.value = true
  fetchPlayerOrders()
}
async function fetchPlayerOrders() {
  ordersLoading.value = true
  try {
    const params = { pageNum: ordersQuery.pageNum, pageSize: ordersQuery.pageSize }
    if (ordersQuery.playerId) params.playerId = ordersQuery.playerId
    const fn = isAdmin ? adminOrderList : csOrderList
    const res = await fn(params)
    playerOrders.value = res.data?.records || []
    ordersTotal.value = Number(res.data?.total || 0)
  } finally { ordersLoading.value = false }
}

onMounted(fetchData)
</script>
<style scoped>
.search-form { margin-bottom: 16px; }</style>

<style scoped>
.player-header{display:flex;justify-content:space-between;align-items:center}
.player-detail {
  padding: 4px 0;
}
.introduction-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.player-detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.player-detail-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.player-detail-name {
  font-size: 16px;
  font-weight: 600;
}
.player-detail-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #73777e;
  display: flex;
  align-items: center;
}
.player-detail-id {
  font-size: 12px;
}
.amount-positive { color: #c94f59; font-weight: 600; }
.amount-negative { color: #347a5b; font-weight: 600; }
@media (max-width: 768px) {
  .player-detail-header { gap: 10px; }
  .player-detail-main { min-width: 0; }
  .player-detail-name, .player-detail-id { overflow-wrap: anywhere; word-break: break-word; }
  .player-detail-sub { flex-wrap: wrap; gap: 6px; }
}
</style>
