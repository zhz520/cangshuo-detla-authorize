<template>
  <view class="tech-support-footer">
    <text :class="{ link: safeSupportUrl }" @click="openSupportLink">{{ supportText }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { useSiteStore } from '@/store/site'

const siteStore = useSiteStore()
const supportText = computed(() => siteStore.techSupportText || '斜阳电竞提供技术支持')
const safeSupportUrl = computed(() => {
  const value = String(siteStore.techSupportUrl || '').trim()
  return /^https?:\/\/[^\s]+$/i.test(value) ? value : ''
})

function openSupportLink() {
  if (!safeSupportUrl.value) return
  // #ifdef H5
  window.open(safeSupportUrl.value, '_blank', 'noopener,noreferrer')
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: safeSupportUrl.value,
    success: () => uni.showToast({ title: '链接已复制', icon: 'none' })
  })
  // #endif
}
</script>

<style lang="scss" scoped>
.tech-support-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx 24rpx calc(16rpx + var(--app-safe-bottom, env(safe-area-inset-bottom)));
  color: #969aa1;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  line-height: 1.6;
  text-align: center;
  position: relative;
  z-index: 1;
}

.tech-support-footer text {
  overflow-wrap: anywhere;
}

.tech-support-footer text.link {
  color: #73777e;
  text-decoration: underline;
  text-underline-offset: 4rpx;
  cursor: pointer;
}
</style>
