<template>
  <view class="product-card" :class="{ dense }" @click="goDetail">
    <AppImage class="cover" :src="product.coverImage" mode="aspectFit" :style="{ height: coverHeight + 'rpx' }" />
    <view class="info">
      <text class="name text-ellipsis-2">{{ product.name }}</text>
      <view v-if="product.subtitle" class="subtitle-wrap">
        <text class="subtitle text-ellipsis">{{ product.subtitle }}</text>
      </view>
      <view class="bottom">
        <text class="price">¥{{ displayPrice }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import AppImage from '@/components/AppImage.vue'
import { computed } from 'vue'

const props = defineProps({
  product: { type: Object, required: true },
  coverHeight: { type: Number, default: 340 },
  dense: { type: Boolean, default: false },
  designatedPlayerId: { type: [String,Number], default: '' }
})

const displayPrice = computed(() => {
  return Number(props.product.price || 0).toFixed(2)
})

function goDetail() {
  uni.navigateTo({ url: `/pages/product/detail?id=${props.product.id}${props.designatedPlayerId ? `&playerId=${props.designatedPlayerId}` : ''}` })
}
</script>

<style lang="scss" scoped>
.product-card {
  background: #ffffff;
  border-radius: 20rpx;
  overflow: hidden;
  min-width: 0;
  border: 1rpx solid #eeeff1;
  box-shadow: 0 8rpx 24rpx rgba(23, 25, 28, 0.04);

  .cover {
    width: 100%;
    height: 340rpx;
  }

  .info {
    padding: 16rpx 20rpx 20rpx;
    overflow: hidden;
    min-width: 0;

    .name {
      font-size: 26rpx;
      font-weight: bold;
      color: #17191c;
      line-height: 1.4;
    }

    .subtitle-wrap {
      min-width: 0;
      overflow: hidden;
      margin-top: 4rpx;
    }
    .subtitle {
      font-size: 22rpx;
      color: #73777e;
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      width: 100%;
      max-width: 100%;
    }

    .bottom {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-top: 12rpx;

      .price {
        font-size: 32rpx;
        font-weight: bold;
        color: #17191c;
      }
      .sales {
        font-size: 22rpx;
        color: #73777e;
      }
    }
  }

  &.dense {
    .info { padding: 14rpx 16rpx 16rpx; }
    .info .name { font-size: 24rpx; }
    .info .bottom { margin-top: 10rpx; }
    .info .bottom .price { font-size: 30rpx; color: #17191c; }
    .info .bottom .sales { font-size: 20rpx; }
  }
}
</style>
