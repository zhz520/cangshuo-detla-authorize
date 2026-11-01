<template>
  <view class="showcase-card" @click="open">
    <view class="portrait"><AppImage :width="160" :src="player.coverImage || player.avatar || '/static/images/default-avatar.png'" mode="aspectFill" /><text class="presence" :class="{online:player.isOnline===1}">{{ player.isOnline===1?'在线':'离线' }}</text></view>
    <view class="card-info"><text class="card-name">{{ player.nickname || '打手' }}</text><text class="card-level">{{ player.levelName || `Lv.${player.level||1}` }}</text><text class="card-meta">★ {{ Number(player.avgRating||0).toFixed(1) }} · {{ player.orderCount||0 }} 单</text></view>
  </view>
</template>
<script setup>
import AppImage from '@/components/AppImage.vue'
const props=defineProps({player:{type:Object,required:true}})
function open(){uni.navigateTo({url:`/pages/players/detail?id=${props.player.id}`})}
</script>
<style lang="scss" scoped>
.showcase-card{min-width:0;background:#fff;border:1rpx solid #eeeff1;border-radius:18rpx;overflow:hidden;box-shadow:0 6rpx 18rpx rgba(23,25,28,.035)}
.portrait{height:240rpx;position:relative;background:#f0f1f3;.app-image{width:100%;height:100%}.presence{position:absolute;left:12rpx;bottom:12rpx;padding:4rpx 12rpx;border-radius:999rpx;font-size:18rpx;color:#fff;background:rgba(23,25,28,.6);&.online{background:#347a5b}}}
.card-info{padding:16rpx 14rpx;display:flex;flex-direction:column;gap:8rpx}.card-name{font-size:26rpx;font-weight:700;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.card-level{font-size:20rpx;color:#555b63;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.card-meta{font-size:20rpx;color:#858992}
</style>
