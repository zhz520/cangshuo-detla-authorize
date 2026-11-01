<template>
  <view class="product-list">
    <view v-if="designatedPlayer" class="designation-note">正在为 {{ designatedPlayer.nickname }} 点单，请选择服务</view>
    <view class="search-bar">
      <input v-model="keyword" placeholder="搜索商品" confirm-type="search" @confirm="doSearch" :focus="autoFocus" />
    </view>
    <!-- 排序栏 -->
    <view class="sort-bar"><ProductSortPicker v-model="currentSort" @update:model-value="refresh" /></view>
    <scroll-view scroll-y class="list" @scrolltolower="loadMore">
      <view class="product-grid">
        <ProductCard v-for="p in products" :key="p.id" :product="p" :designated-player-id="designatedPlayerId" />
      </view>
      <view v-if="loading" class="loading-tip">加载中...</view>
<EmptyState v-if="!loading && products.length===0" text="暂无商品" image="/static/icons/购物车空空如也.svg" />
    </scroll-view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ProductCard from '@/components/ProductCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProductSortPicker from '@/components/ProductSortPicker.vue'
import { productSortParams } from '@/utils/product-sort'
import { getProductList } from '@/api/product'
import {getPublicPlayer} from '@/api/player'

const designatedPlayerId = ref(''), designatedPlayer = ref(null)
const keyword = ref('')
const products = ref([])
const pageNum = ref(1)
const loading = ref(false)
const finished = ref(false)
const categoryId = ref('')
const parentCategoryId = ref('')
const autoFocus = ref(false)
const currentSort = ref('default')
let generation = 0

onLoad((opts) => {
  if(opts.playerId) {designatedPlayerId.value=opts.playerId;getPublicPlayer(opts.playerId).then(res=>designatedPlayer.value=res.data).catch(()=>{})}
  if (opts.categoryId) categoryId.value = opts.categoryId
  if (opts.parentCategoryId) parentCategoryId.value = opts.parentCategoryId
  if (opts.keyword) keyword.value = opts.keyword
  if (opts.focus) autoFocus.value = true
  loadData()
})

function doSearch() { refresh() }
function refresh() { generation++; pageNum.value = 1; products.value = []; finished.value = false; loadData() }
async function loadData() {
  const request = generation, page = pageNum.value
  loading.value = true
  const params = { pageNum: page, pageSize: 10, ...productSortParams(currentSort.value) }
  if (keyword.value) params.keyword = keyword.value
  if (categoryId.value) params.categoryId = categoryId.value
  if (parentCategoryId.value) params.parentCategoryId = parentCategoryId.value
  try {
    const res = await getProductList(params)
    if (request !== generation) return
    const list = res.data?.records || res.data?.rows || []
    finished.value = list.length < 10
    products.value = page === 1 ? list : [...products.value, ...list]
  } catch {
    if (request === generation && page > 1) pageNum.value = page - 1
  } finally { if (request === generation) loading.value = false }
}
function loadMore() { if (!loading.value && !finished.value) { pageNum.value++; loadData() } }
</script>
<style lang="scss" scoped>
.designation-note{padding:24rpx;background:#fff;color:#17191c;font-size:26rpx;border-bottom:1rpx solid #eeeff1}
.product-list { background: #f7f8f9; height: var(--app-page-height, 100vh); display: flex; flex-direction: column; }
.search-bar { padding: 20rpx 24rpx; background: #f7f8f9; input { height: 72rpx; background: #ffffff; border-radius: 999rpx; padding: 0 32rpx; font-size: 28rpx; color: #17191c; box-shadow: 0 2rpx 12rpx rgba(23, 25, 28, 0.04); } }
.sort-bar { display: flex; background: #ffffff; margin: 0 24rpx; border-radius: 12rpx; padding: 0 12rpx; box-shadow: 0 2rpx 12rpx rgba(23, 25, 28, 0.04); margin-bottom: 16rpx; }
.sort-item { flex: 1; text-align: center; padding: 20rpx 0; font-size: 26rpx; color: #73777e; &.active { color: #17191c; font-weight: 500; } .sort-arrow { font-size: 22rpx; margin-left: 4rpx; } }
.list { flex: 1; height: 0; min-height: 0; padding: 20rpx 24rpx; box-sizing: border-box; }
.product-grid {
  display: flex;
  flex-direction: column;
  row-gap: 20rpx;
}
.loading-tip { text-align: center; padding: 32rpx; font-size: 24rpx; color: #73777e; }
</style>
