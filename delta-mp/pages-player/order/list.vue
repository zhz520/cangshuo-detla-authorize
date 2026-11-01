<template>
  <view class="player-order-list tab-page">
    <scroll-view scroll-x class="tabs" :show-scrollbar="false">
      <view class="tabs-inner">
        <view v-for="tab in tabs" :key="tab.value" class="tab" :class="{active:currentTab===tab.value}" @click="switchTab(tab.value)">{{tab.label}}</view>
      </view>
    </scroll-view>
    <scroll-view scroll-y class="list" :show-scrollbar="false" @scrolltolower="loadMore">
      <OrderCard v-for="o in orders" :key="o.id" :order="o" detail-path="/pages-player/order/detail" />
<EmptyState v-if="!loading && orders.length===0" text="暂无订单" image="/static/icons/暂无纪录.svg" />
    </scroll-view>
<CustomTabBar :current="1" />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import CustomTabBar from '@/components/CustomTabBar.vue'
import OrderCard from '@/components/OrderCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getMyWork } from '@/api/player'
import { PLAYER_ORDER_TABS } from '@/utils/constants'
const tabs = PLAYER_ORDER_TABS
const currentTab = ref('')
const orders = ref([])
const pageNum = ref(1)
const loading = ref(false)
const finished = ref(false)
onShow(() => {
  try { uni.hideHomeButton() } catch (_) {}
  refresh()
})
function switchTab(val) { currentTab.value=val; refresh() }
function refresh() { pageNum.value=1; orders.value=[]; finished.value=false; loadData() }
async function loadData() {
  loading.value = true
  const res = await getMyWork({ pageNum:pageNum.value, pageSize:10, status:currentTab.value })
  const list = res.data?.records || []
  if (list.length < 10) finished.value = true
  orders.value = pageNum.value===1 ? list : [...orders.value,...list]
  loading.value = false
}
function loadMore() { if (!loading.value && !finished.value) { pageNum.value++; loadData() } }
</script>
<style lang="scss" scoped>
.player-order-list { width: 100%; overflow: hidden; box-sizing: border-box; background: #ffffff; position: relative; }
.tabs { background: #f4f5f6; border-bottom:1rpx solid #f4f5f6; white-space:nowrap; }
.tabs-inner { display:inline-flex; padding:0 12rpx; }
.tab { padding:24rpx 24rpx; font-size:26rpx; color: #666b73; flex-shrink:0; &.active { color: #17191c; border-bottom:4rpx solid rgba(23, 25, 28, 0.5); } }
.list { height: calc(var(--app-page-height, 100vh) - 190rpx - var(--app-safe-bottom, env(safe-area-inset-bottom))); padding: 20rpx 24rpx; box-sizing: border-box; overflow-x: hidden; }
</style>
