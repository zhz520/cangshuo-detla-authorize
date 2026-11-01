<template>
  <view class="image-uploader">
    <view v-for="(img, index) in modelValue" :key="index" class="preview-item">
      <AppImage :src="img" mode="aspectFit" @click="previewImage(index)" />
      <view class="remove-btn" @click.stop="removeImage(index)">×</view>
    </view>
    <view v-if="modelValue.length < max" class="add-btn" :class="{ uploading }" @click="chooseImage">
      <text class="add-icon">+</text>
      <text class="add-text">{{ uploading ? '上传中...' : '上传图片' }}</text>
    </view>
  </view>
</template>

<script setup>
import AppImage from '@/components/AppImage.vue'
import { ref, onUnmounted } from 'vue'
import { upload } from '@/api/file'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 9 }
})

const emit = defineEmits(['update:modelValue'])

const uploading = ref(false)
let disposed = false
onUnmounted(() => { disposed = true })

function showUploadError(error) {
  if (disposed) return
  const message = String(error?.errMsg || error?.message || error?.msg || '')
  if (/cancel/i.test(message)) return
  uni.showToast({ title: message && !message.includes(':fail') ? message : '图片上传失败，请重试', icon: 'none' })
}

function chooseImage() {
  const remain = props.max - props.modelValue.length
  if (remain <= 0 || uploading.value || disposed) return
  // 直接在点击中调用选择器，保留 PC 文件选择及手机相册/相机入口。
  // 选择成功后才锁定上传，旧浏览器取消选择时不派发事件也不会卡住。
  uni.chooseImage({
    count: Math.min(9, remain),
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: result => uploadImages((result.tempFilePaths || []).slice(0, remain)),
    fail: showUploadError
  })
}

async function uploadImages(paths) {
  if (uploading.value || disposed || !paths.length) return
  uploading.value = true
  const urls = []
  try {
    for (const path of paths) {
      if (disposed || urls.length >= props.max - props.modelValue.length) break
      urls.push(await upload(path))
    }
  } catch (error) {
    showUploadError(error)
  } finally {
    if (!disposed && urls.length) {
      const remain = Math.max(0, props.max - props.modelValue.length)
      emit('update:modelValue', [...props.modelValue, ...urls.slice(0, remain)])
    }
    uploading.value = false
  }
}

function removeImage(index) {
  const list = [...props.modelValue]
  list.splice(index, 1)
  emit('update:modelValue', list)
}

function previewImage(index) {
  uni.previewImage({
    urls: props.modelValue,
    current: props.modelValue[index]
  })
}
</script>

<style lang="scss" scoped>
.image-uploader {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;

  .preview-item {
    position: relative;
    width: 160rpx;
    height: 160rpx;

    :is(image, .app-image) {
      width: 100%;
      height: 100%;
      border-radius: 8rpx;
    }

    .remove-btn {
      position: absolute;
      top: -12rpx;
      right: -12rpx;
      width: 36rpx;
      height: 36rpx;
      line-height: 34rpx;
      text-align: center;
      font-size: 28rpx;
      color: #fff;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 50%;
    }
  }

  .add-btn {
    width: 160rpx;
    height: 160rpx;
    flex-shrink: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 2rpx dashed rgba(23, 25, 28, 0.3);
    border-radius: 8rpx;

    &.uploading { opacity: 0.6; cursor: wait; }

    .add-icon { font-size: 48rpx; color: rgba(23, 25, 28, 0.5); }
    .add-text { font-size: 22rpx; color: #73777e; margin-top: 4rpx; }
  }
}
</style>
