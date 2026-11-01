<template>
  <view class="review-page">
    <view class="rating-area"><text>评分</text>
      <view class="stars"><text v-for="i in 5" :key="i" class="star" :class="{active:rating>=i}" @click="rating=i">★</text></view>
    </view>
    <textarea v-model="content" placeholder="请输入评价内容" :maxlength="500" />
    <ImageUploader v-model="images" :max="3" />
    <view class="btn" :class="{ submitting }" @click="submit">{{ submitting ? '提交中...' : '提交评价' }}</view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImageUploader from '@/components/ImageUploader.vue'
import { addReview } from '@/api/review'
const orderId = ref(0)
const rating = ref(5)
const content = ref('')
const images = ref([])
const submitting = ref(false)
onLoad((opts) => { orderId.value = opts.orderId })
async function submit() {
  if (submitting.value) return
  if (!content.value.trim()) return uni.showToast({title:'请输入评价',icon:'none'})
  submitting.value = true
  try {
    await addReview({ orderId: orderId.value, rating: rating.value, content: content.value.trim(), images: images.value.join(',') })
    uni.showToast({title:'评价成功'})
    setTimeout(() => uni.navigateBack(), 1500)
  } catch (_) { submitting.value = false }
}
</script>
<style lang="scss" scoped>
.review-page { padding:24rpx; background:#ffffff; min-height:var(--app-page-height, 100vh); }
.rating-area { display:flex; align-items:center; gap:20rpx; margin-bottom:24rpx; background:#ffffff; border:1rpx solid #eeeff1; padding:24rpx; border-radius:16rpx; color:#17191c; }
.stars { display:flex; gap:8rpx; }
.star { font-size:48rpx; color:#b9bdc4; &.active { color:#996b30; } }
textarea { width:100%; height:240rpx; background:#f7f8f9; border:1rpx solid #eeeff1; border-radius:12rpx; padding:24rpx; font-size:28rpx; margin-bottom:24rpx; color:#17191c; }
.btn { height:88rpx; line-height:88rpx; text-align:center; background:linear-gradient(135deg, #17191c, #30343a); color:#ffffff; font-weight:bold; font-size:32rpx; border-radius:999rpx; margin-top:40rpx; }
</style>
