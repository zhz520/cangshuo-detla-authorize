<template>
  <view class="agreement-page">
    <rich-text :nodes="content" />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getAgreement } from '@/api/agreement'
const content = ref('')
onLoad(async (opts) => { const res = await getAgreement(opts.type||'user_agreement'); content.value = res.data?.content || '' })
</script>
<style lang="scss" scoped>
.agreement-page { padding:24rpx; background:#f4f5f6; min-height:var(--app-page-height, 100vh); font-size:28rpx; color:#17191c; line-height:1.8; }
</style>