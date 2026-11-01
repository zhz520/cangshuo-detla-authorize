<template>
  <view class="detail-page">
    <scroll-view scroll-y class="list" @scrolltolower="loadMore">
      <view v-for="item in records" :key="item.id" class="record-item">
        <view class="left">
          <text class="desc">{{ item.type === 'INCOME' ? '订单收益' : TX_TYPE_MAP[item.type] || item.type }}</text>
          <text class="time">{{ item.createdAt }}</text>
          <text v-if="item.type.startsWith('REWARD_')" class="time">来源订单 {{ item.relatedOrderId }} · {{ item.remark }}</text>
          <view v-if="item.remarkInfo" class="remark-info">
            <text>订单金额: ¥{{ item.remarkInfo.orderAmount }}</text>
            <text>抽成: {{ item.remarkInfo.commissionRate }}% (¥{{ item.remarkInfo.commissionAmount }})</text>
          </view>
        </view>
        <text class="amount" :class="{ income: Number(item.amount) > 0 }">
          {{ Number(item.amount) > 0 ? '+' : '' }}¥{{ Number(item.amount).toFixed(2) }}
        </text>
      </view>
      <view v-if="loading" class="loading-tip">加载中...</view>
<EmptyState v-if="!loading && records.length === 0" text="暂无收益明细" image="/static/icons/暂无纪录.svg" />
    </scroll-view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import EmptyState from '@/components/EmptyState.vue'
import { getEarningsDetail } from '@/api/player'

const TX_TYPE_MAP = { REWARD_PAY:'打赏支出', REWARD_INCOME:'打赏收入', REWARD_REFUND:'打赏退款', REWARD_REVERSAL:'打赏冲正', PAY: '支付', REFUND: '退款', WITHDRAW: '提现', INCOME: '订单收益', RECHARGE: '充值' }
const records = ref([])
const pageNum = ref(1)
const loading = ref(false)
const finished = ref(false)

onLoad(() => { loadData() })

/** 解析 remark 字符串为结构化数据 */
function parseRemark(remark) {
  if (!remark) return null
  try {
    const orderAmount = remark.match(/订单金额:¥([\d.]+)/)?.[1]
    const commissionRate = remark.match(/平台抽成:([\d.]+)%/)?.[1]
    const commissionAmount = remark.match(/抽成金额:¥([\d.]+)/)?.[1]
    const income = remark.match(/实际收入:¥([\d.]+)/)?.[1]
    if (orderAmount) return { orderAmount, commissionRate, commissionAmount, income }
  } catch (e) {}
  return null
}

async function loadData() {
  loading.value = true
  const res = await getEarningsDetail({ pageNum: pageNum.value, pageSize: 20 })
  const list = (res.data?.records || []).map(item => ({
    ...item,
    remarkInfo: parseRemark(item.remark)
  }))
  if (list.length < 20) finished.value = true
  records.value = pageNum.value === 1 ? list : [...records.value, ...list]
  loading.value = false
}
function loadMore() { if (!loading.value && !finished.value) { pageNum.value++; loadData() } }
</script>
<style lang="scss" scoped>
.detail-page { background: #ffffff; min-height: var(--app-page-height, 100vh); }
.list { height: var(--app-page-height, 100vh); }
.record-item { display: flex; justify-content: space-between; align-items: center; padding: 24rpx; background: #f4f5f6; border-bottom: 1rpx solid #f4f5f6;
  .left { flex: 1; .desc { font-size: 28rpx; color: #17191c; display: block; } .time { font-size: 22rpx; color: #73777e; display: block; margin-top: 4rpx; }
    .remark-info { margin-top: 8rpx; text { display: block; font-size: 22rpx; color: #666b73; line-height: 1.6; } }
  }
  .amount { font-size: 30rpx; color: #17191c; font-weight: bold; &.income { color: #347a5b; } }
}
.loading-tip { text-align: center; padding: 32rpx; font-size: 24rpx; color: #73777e; }
</style>
