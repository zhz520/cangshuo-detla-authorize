<template>
  <view class="chat-bubble" :class="{ 'is-self': isSelf }">
    <!-- 自己的头像：有则用图，无则显示昵称首字 -->
    <AppImage :width="160" v-if="isSelf && selfAvatar" class="avatar" :src="selfAvatar" mode="aspectFill" />
    <view v-else-if="isSelf" class="avatar avatar-placeholder">{{ firstChar(selfName) }}</view>
    <!-- 对方头像：有则用图，无则显示名字首字 -->
    <AppImage :width="160" v-else-if="avatar" class="avatar" :src="avatar" mode="aspectFill" />
    <view v-else class="avatar avatar-placeholder">{{ firstChar(name) }}</view>
    <view class="bubble-content" :class="{ self: isSelf }">
      <text v-if="msg.type === 'TEXT'" class="text-msg">{{ msg.content }}</text>
      <AppImage v-else-if="msg.type === 'IMAGE'" class="msg-image" :src="msg.content" mode="widthFix" @click="previewImage" />
      <!-- 商品卡片 -->
      <view v-else-if="msg.type === 'PRODUCT'" class="card-msg product-card" @click="goProduct(cardData)">
        <AppImage class="card-cover" :src="cardData.coverImage || cardData.image" mode="aspectFit" />
        <view class="card-info">
          <text class="card-name text-ellipsis">{{ cardData.name }}</text>
          <text class="card-price">¥{{ Number(cardData.price || 0).toFixed(2) }}</text>
        </view>
        <view class="card-tag">商品</view>
      </view>
      <!-- 订单卡片 -->
      <view v-else-if="msg.type === 'ORDER'" class="card-msg order-card" @click="goOrder(cardData)">
        <view class="card-info" style="flex:1">
          <text class="card-name text-ellipsis">{{ cardData.productName || cardData.orderNo }}</text>
          <view class="card-meta">
            <text class="card-price">¥{{ Number(cardData.amount || 0).toFixed(2) }}</text>
            <text class="card-status">{{ statusText }}</text>
          </view>
          <text class="card-order-no">{{ cardData.orderNo }}</text>
        </view>
        <view class="card-tag">订单</view>
      </view>
      <text v-else class="system-msg">{{ msg.content }}</text>
    </view>
  </view>
</template>

<script setup>
import AppImage from '@/components/AppImage.vue'
import { computed } from 'vue'
import { ORDER_STATUS_TEXT } from '@/utils/constants'

const props = defineProps({
  msg: { type: Object, required: true },
  isSelf: { type: Boolean, default: false },
  avatar: { type: String, default: '' },
  selfAvatar: { type: String, default: '' },
  name: { type: String, default: '' },
  selfName: { type: String, default: '' }
})

function firstChar(str) {
  if (!str || typeof str !== 'string') return '?'
  const s = str.trim()
  return s.length ? s[0] : '?'
}

const cardData = computed(() => {
  if (props.msg.type === 'PRODUCT' || props.msg.type === 'ORDER') {
    try { return JSON.parse(props.msg.content) } catch { return {} }
  }
  return {}
})

const statusText = computed(() => ORDER_STATUS_TEXT[cardData.value?.status] || cardData.value?.status || '')

function previewImage() {
  uni.previewImage({ urls: [props.msg.content], current: 0 })
}
function goProduct(d) {
  if (d?.id) uni.navigateTo({ url: '/pages/product/detail?id=' + d.id })
}
function goOrder(d) {
  if (d?.id) uni.navigateTo({ url: '/pages/order/detail?id=' + d.id })
}
</script>

<style lang="scss" scoped>
.chat-bubble {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24rpx;
  padding: 0 24rpx;

  &.is-self {
    flex-direction: row-reverse;
  }

  .avatar {
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #73777e, #666b73);
    color: #fff;
    font-size: 32rpx;
    font-weight: bold;
  }

  .bubble-content {
    max-width: 70%;
    margin: 0 16rpx;
    padding: 20rpx 24rpx;
    background: #e6e7e9;
    border: 1rpx solid #f4f5f6;
    border-radius: 12rpx;
    font-size: 28rpx;
    color: #17191c;
    word-break: break-all;

    &.self {
      background: linear-gradient(135deg, #17191c, #30343a);
      border-color: transparent;
      color: #ffffff;

      /* Some older WebViews do not inherit text colour inside uni-text. */
      .text-msg {
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }
      .system-msg { color: #ffffff; opacity: 0.82; }

      .card-msg { background: #f4f5f6; border-color: #e6e7e9; }
      .card-name { color: #17191c; }
      .card-price { color: #17191c; }
      .card-status { color: #666b73; }
      .card-order-no { color: #666b73; }
      .card-tag { background: #e6e7e9; color: #666b73; }
    }

    .text-msg {
      color: inherit;
      -webkit-text-fill-color: currentColor;
      line-height: 1.55;
    }

    .msg-image {
      max-width: 400rpx;
      border-radius: 8rpx;
    }

    .system-msg {
      color: #73777e;
      font-size: 24rpx;
    }
  }
}

/* 卡片消息通用样式 */
.card-msg {
  display: flex;
  padding: 0;
  background: #f4f5f6;
  border: 1rpx solid #e6e7e9;
  border-radius: 12rpx;
  overflow: hidden;
  position: relative;
  width: 400rpx;
  max-width: 100%;
  min-width: 0;
}
.card-cover {
  width: 160rpx;
  height: 160rpx;
  flex-shrink: 0;
}
.card-info {
  flex: 1;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}
.card-name {
  font-size: 26rpx;
  color: #17191c;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-price {
  font-size: 28rpx;
  color: #17191c;
  font-weight: bold;
  margin-top: 8rpx;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
}
.card-status {
  font-size: 22rpx;
  color: #73777e;
}
.card-order-no {
  font-size: 20rpx;
  color: #73777e;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-tag {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 18rpx;
  padding: 2rpx 12rpx;
  background: #e6e7e9;
  color: #17191c;
  border-radius: 0 12rpx 0 8rpx;
}
</style>
