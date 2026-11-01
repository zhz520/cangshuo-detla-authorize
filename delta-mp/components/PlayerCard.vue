<template>
  <view class="player-card" @click="$emit('click', player)">
    <AppImage :width="160" class="avatar" :src="player.avatar" mode="aspectFill" />
    <view class="info">
      <text class="name">{{ player.nickname }}</text>
      <view class="meta">
        <text v-if="player.level" class="level">Lv.{{ player.level }}</text>
        <text class="rating">⭐{{ player.avgRating || '暂无' }}</text>
        <text class="orders">接单{{ player.completedOrders || 0 }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import AppImage from '@/components/AppImage.vue'
defineProps({
  player: { type: Object, required: true }
})
defineEmits(['click'])
</script>

<style lang="scss" scoped>
.player-card {
  display: flex;
  align-items: center;
  background: #f4f5f6;
  border: 1rpx solid #e6e7e9;
  padding: 24rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;

  .avatar {
    width: 88rpx;
    height: 88rpx;
    border-radius: 50%;
    margin-right: 20rpx;
    border: 2rpx solid #b9bdc4;
  }

  .info {
    flex: 1;

    .name {
      font-size: 30rpx;
      color: #17191c;
      font-weight: 500;
    }

    .meta {
      margin-top: 8rpx;
      font-size: 24rpx;
      color: #73777e;
      display: flex;
      gap: 20rpx;

      .level {
        color: #996b30;
        font-weight: 500;
      }
    }
  }
}
</style>
