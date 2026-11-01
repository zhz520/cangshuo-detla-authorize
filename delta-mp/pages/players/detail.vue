<template>
  <view class="homepage">
    <scroll-view scroll-y class="player-detail" @scrolltolower="activeTab==='reviews' && loadReviews()">
      <view v-if="loading" class="hint">加载中...</view>
      <view v-else-if="!player" class="hint" @click="loadPlayer">{{ errorMessage || '打手暂未开放展示' }}，点击重试</view>
      <template v-else>
        <view class="cover"><AppImage :width="160" :src="player.coverImage || player.avatar || '/static/images/default-avatar.png'" mode="aspectFill"/><view class="cover-shade"/><text class="cover-label">{{ player.levelName || `Lv.${player.level||1}` }} · 打手主页</text></view>
        <view class="profile-card">
          <view class="profile-row"><view class="profile-info"><text class="name">{{ player.nickname || '打手' }}</text><view class="badges"><text class="level">{{ player.levelName || `Lv.${player.level||1}` }}</text><text class="online" :class="{available:player.isOnline===1}">● {{ player.isOnline===1?'在线接单':'暂时离线' }}</text></view></view><AppImage :width="160" class="avatar" :src="player.avatar || '/static/images/default-avatar.png'" mode="aspectFill"/></view>
          <view class="voice-wrap"><VoicePlayer :src="player.voiceUrl" :duration="player.voiceDuration || 0"/><text v-if="!player.voiceUrl" class="muted">TA还没有留下语音</text></view>
          <text class="intro-title">个人简介</text><text class="introduction">{{ player.introduction || '这位打手暂未填写个人简介' }}</text>
          <view v-if="player.skillTags || player.gameLevel" class="skills"><text v-if="player.gameLevel">{{ player.gameLevel }}</text><text v-if="player.skillTags">{{ player.skillTags }}</text></view>
          <view class="stats"><view><text class="stat-value">{{ Number(player.avgRating||0).toFixed(1) }}</text><text>服务评分</text></view><view><text class="stat-value">{{ player.orderCount||0 }}</text><text>累计接单</text></view><view><text class="stat-value">{{ Number(player.completeRate||0).toFixed(0) }}%</text><text>完成率</text></view></view>
        </view>
        <view class="profile-tabs"><text :class="{active:activeTab==='story'}" @click="activeTab='story'">TA的故事</text><text :class="{active:activeTab==='album'}" @click="activeTab='album'">TA的相册</text><text :class="{active:activeTab==='reviews'}" @click="activeTab='reviews'">用户评价</text></view>
        <view v-if="activeTab==='story'" class="section-card"><text class="section-title">TA的故事</text><text v-if="player.story" class="story-text">{{ player.story }}</text><view v-else class="empty-content">TA的故事，等你来了解</view></view>
        <view v-if="activeTab==='album'" class="section-card"><view class="section-header"><text class="section-title">TA的相册</text><text class="muted">{{ album.length }} 张</text></view><view v-if="album.length" class="album-grid"><AppImage v-for="(img,index) in album" :key="index" :src="img" mode="aspectFill" @click="previewAlbum(index)"/></view><view v-else class="empty-content">TA还没有上传相片</view></view>
        <view v-if="activeTab==='reviews'" class="section-card reviews-section">
          <view class="section-header"><text class="section-title">用户评价（{{ reviewTotal }}）</text><text class="review-action" @click="writeReview">写评价</text></view>
          <text class="review-tip">完成该打手的订单后可评价，每个订单限一次</text>
        <view v-for="review in reviews" :key="review.id" class="review-item">
          <view class="review-top"><AppImage :width="160" class="review-avatar" :src="review.userAvatar || '/static/images/default-avatar.png'" mode="aspectFill" /><view class="review-user"><text>{{ review.userNickname || '匿名用户' }}</text><text class="time">{{ formatTime(review.createdAt) }}</text></view><StarRating :model-value="review.rating" readonly :size="24" /></view>
          <text class="review-content">{{ review.content }}</text>
          <view v-if="review.images" class="review-images"><AppImage v-for="(image, index) in review.images.split(',')" :key="index" :src="image" mode="aspectFill" @click="previewImages(review.images, index)" /></view>
          <text v-if="review.productName" class="product-name">{{ review.productName }}</text>
        </view>
        <view v-if="reviewLoading" class="hint">加载评价中...</view>
        <view v-else-if="reviewError" class="hint" @click="loadReviews">评价加载失败，点击重试</view>
        <view v-else-if="!reviews.length" class="hint">暂无评价</view>
        <view v-else-if="reviewFinished" class="hint">没有更多评价了</view>
        </view>
        <view class="page-bottom"/>
      </template>
    </scroll-view>
    <view v-if="player" class="profile-actions"><view v-if="rewardOrders.length" class="action-button secondary" @click="rewardPlayer">打赏</view><view class="action-button secondary" @click="privateChat">{{ chatting?'连接中...':'私聊' }}</view><view class="action-button primary" :class="{unavailable:!player.canOrder}" @click="placeOrder">点单<text> {{ player.canOrder?'指定TA服务':'暂不可接单' }}</text></view></view>
  </view>
</template>
<script setup>
import AppImage from '@/components/AppImage.vue'
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import StarRating from '@/components/StarRating.vue'
import VoicePlayer from '@/components/VoicePlayer.vue'
import { getPublicPlayer, getPublicPlayerReviews, getPlayerReviewableOrders, createPlayerChat } from '@/api/player'
import { useUserStore } from '@/store/user'
import { getRewardableOrders } from '@/api/reward'
const rewardOrders=ref([])
async function loadRewardOrders(){rewardOrders.value=[];if(!useUserStore().isLoggedIn)return;try{rewardOrders.value=(await getRewardableOrders(playerId.value)).data||[]}catch(_){}}
function rewardPlayer(){const open=o=>uni.navigateTo({url:`/pages/order/detail?id=${o.id}&reward=1`});if(rewardOrders.value.length===1)return open(rewardOrders.value[0]);uni.showActionSheet({itemList:rewardOrders.value.slice(0,6).map(o=>`${o.productName} · ${o.orderNo}`),success:r=>open(rewardOrders.value[r.tapIndex])})}
const activeTab = ref('story'), chatting = ref(false)
const album = computed(() => player.value?.albumImages || [])
const playerId = ref(null), player = ref(null), loading = ref(true), errorMessage = ref('')
const reviews = ref([]), reviewTotal = ref(0), reviewLoading = ref(false), reviewFinished = ref(false), reviewError = ref(false)
let reviewPage = 1, choosingOrder = false, reviewGeneration = 0
onLoad(options => { playerId.value = Number(options.id) || null })
onShow(() => { loadRewardOrders(); loadPlayer(); reviewGeneration++; reviews.value = []; reviewPage = 1; reviewFinished.value = false; reviewLoading.value = false; loadReviews() })
async function loadPlayer() {
  loading.value = true
  try { player.value = (await getPublicPlayer(playerId.value)).data; errorMessage.value = '' }
  catch (e) { player.value = null; errorMessage.value = e?.msg || '加载失败' }
  finally { loading.value = false }
}
async function loadReviews() {
  if (!playerId.value || reviewLoading.value || reviewFinished.value) return
  reviewLoading.value = true; reviewError.value = false
  const generation = reviewGeneration
  try {
    const { data } = await getPublicPlayerReviews(playerId.value, { pageNum: reviewPage, pageSize: 10 })
    if (generation !== reviewGeneration) return
    const records = data?.records || []
    reviews.value.push(...records); reviewTotal.value = Number(data?.total || 0)
    reviewFinished.value = records.length < 10 || reviews.value.length >= reviewTotal.value
    reviewPage++
  } catch (_) { if (generation === reviewGeneration) reviewError.value = true }
  finally { if (generation === reviewGeneration) reviewLoading.value = false }
}
async function writeReview() {
  if (!useUserStore().checkLogin() || choosingOrder) return
  choosingOrder = true
  try {
    const orders = (await getPlayerReviewableOrders(playerId.value)).data || []
    if (!orders.length) return uni.showToast({ title: '暂无已完成且未评价的该打手订单', icon: 'none' })
    const open = order => uni.navigateTo({ url: `/pages/review/create?orderId=${order.id}` })
    if (orders.length === 1) return open(orders[0])
    uni.showActionSheet({ itemList: orders.slice(0,6).map(o => `${o.productName} · ${o.orderNo}`), success: result => open(orders[result.tapIndex]) })
  } finally { choosingOrder = false }
}
async function privateChat() {
  if (!useUserStore().checkLogin() || chatting.value) return
  chatting.value = true
  try { const { data } = await createPlayerChat(playerId.value); uni.navigateTo({url:`/pages/chat/room?sessionId=${data.id}&name=${encodeURIComponent(player.value.nickname || '打手')}`}) }
  catch(e) { uni.showToast({title:e?.msg || '暂时无法发起私聊',icon:'none'}) }
  finally { chatting.value = false }
}
function placeOrder() {
  if (!useUserStore().checkLogin()) return
  if (!player.value.canOrder) return uni.showToast({title:player.value.orderUnavailableReason || '暂不可接单',icon:'none'})
  uni.navigateTo({url:`/pages/product/list?playerId=${playerId.value}`})
}
function previewAlbum(index) { uni.previewImage({urls:album.value,current:index}) }
function formatTime(time) { return String(time || '').replace('T',' ').slice(0,16) }
function previewImages(images,index) { uni.previewImage({ urls: images.split(','), current: index }) }
</script>
<style lang="scss" scoped>
.homepage{height:var(--app-page-height, 100vh);background:#f7f8f9}.player-detail{height:100%;box-sizing:border-box}.cover{height:400rpx;position:relative;background:#dfe1e5;.app-image{height:100%;width:100%}.cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.12),transparent 40%,rgba(0,0,0,.35))}.cover-label{position:absolute;left:32rpx;top:28rpx;color:#fff;font-size:24rpx;text-shadow:0 1rpx 6rpx rgba(0,0,0,.25)}}.profile-card{position:relative;margin:-68rpx 24rpx 0;padding:28rpx;background:#fff;border-radius:26rpx;border:1rpx solid #eeeff1;box-shadow:0 8rpx 28rpx rgba(23,25,28,.04)}.profile-row{display:flex;align-items:center;gap:24rpx}.profile-info{flex:1;min-width:0}.name{font-size:38rpx;font-weight:800;word-break:break-all;display:block}.avatar{height:140rpx;width:140rpx;border-radius:50%;border:6rpx solid #fff;background:#f4f5f6;margin-top:-64rpx;flex-shrink:0}.badges{display:flex;flex-wrap:wrap;gap:12rpx;align-items:center;margin-top:16rpx}.level{background:#17191c;color:#fff;border-radius:999rpx;font-size:21rpx;padding:6rpx 16rpx}.online{font-size:22rpx;color:#858992;&.available{color:#347a5b}}.voice-wrap{margin:24rpx 0}.intro-title{display:block;font-size:24rpx;font-weight:600;margin-bottom:12rpx}.introduction,.story-text{display:block;white-space:pre-wrap;word-break:break-word;font-size:27rpx;line-height:1.8;color:#555b63}.story-text{margin-top:24rpx}.skills{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:20rpx;text{background:#f4f5f6;padding:8rpx 16rpx;border-radius:8rpx;font-size:22rpx;color:#666b73}}.stats{display:flex;padding-top:24rpx;margin-top:24rpx;border-top:1rpx solid #eeeff1;>view{flex:1;text-align:center;font-size:22rpx;color:#858992}.stat-value{display:block;font-size:32rpx;font-weight:700;color:#17191c;margin-bottom:8rpx}}.profile-tabs{display:flex;gap:12rpx;margin:24rpx;padding:8rpx;border:1rpx solid #eeeff1;background:#fff;border-radius:16rpx;>text{flex:1;text-align:center;padding:20rpx 6rpx;font-size:26rpx;color:#73777e;border-radius:12rpx;&.active{background:#17191c;color:#fff;font-weight:600}}}.section-card{margin:0 24rpx 24rpx;padding:28rpx;background:#fff;border:1rpx solid #eeeff1;border-radius:22rpx}.section-title{font-size:28rpx;font-weight:700;display:block}.section-header{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.muted{color:#969aa1;font-size:22rpx}.empty-content{padding:70rpx 10rpx;text-align:center;font-size:25rpx;color:#969aa1}.album-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12rpx;margin-top:24rpx;.app-image{width:100%;height:200rpx;border-radius:12rpx}}.review-action{background:#17191c;color:#fff;border-radius:999rpx;padding:12rpx 24rpx;font-size:24rpx}.review-tip{font-size:22rpx;color:#858992;display:block;margin-top:16rpx;line-height:1.6}.review-item{padding:28rpx 0;border-bottom:1rpx solid #eeeff1}.review-top{display:flex;align-items:center;gap:12rpx}.review-avatar{height:64rpx;width:64rpx;border-radius:50%}.review-user{flex:1;min-width:0;font-size:25rpx;text{display:block}.time{font-size:20rpx;color:#969aa1;margin-top:6rpx}}.review-content{display:block;margin-top:20rpx;line-height:1.7;font-size:27rpx;white-space:pre-wrap;word-break:break-word}.review-images{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:16rpx;.app-image{height:140rpx;width:140rpx;border-radius:10rpx}}.product-name{display:block;font-size:22rpx;color:#969aa1;margin-top:16rpx}.hint{padding:40rpx 0;color:#969aa1;font-size:24rpx;text-align:center}.page-bottom{height:calc(150rpx + var(--app-safe-bottom, env(safe-area-inset-bottom)))}.profile-actions{position:fixed;bottom:0;left:0;right:0;display:flex;gap:20rpx;padding:20rpx 28rpx calc(20rpx + var(--app-safe-bottom, env(safe-area-inset-bottom)));background:rgba(255,255,255,.98);border-top:1rpx solid #eeeff1;z-index:20}.action-button{height:84rpx;display:flex;align-items:center;justify-content:center;border-radius:999rpx;font-size:30rpx;font-weight:600;&.secondary{flex:1;background:#f2f3f5;border:1rpx solid #e6e7e9}&.primary{flex:2;background:#17191c;color:#fff;text{font-size:21rpx;font-weight:400;margin-left:12rpx;opacity:.7}}&.unavailable{background:#71757c}}
</style>
