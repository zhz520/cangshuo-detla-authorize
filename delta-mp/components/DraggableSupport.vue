<template>
  <view class="support-float" :style="positionStyle" role="button" aria-label="在线客服，可拖动位置" tabindex="0"
    @touchstart.stop="startTouch" @touchmove.stop.prevent="moveTouch" @touchend.stop="finish" @touchcancel.stop="cancel"
    @mousedown.prevent="startMouse" @click.stop="activate" @keydown.enter="activate">
    <image src="/static/icons/客服.svg" mode="aspectFit" class="support-icon" :draggable="false" />
  </view>
</template>
<script setup>
import { clientStorage } from '@/utils/client-storage'

import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
const emit = defineEmits(['activate'])
const position = ref(null)
let bounds, gesture, suppressUntil = 0
const key = 'customerServicePosition'
const positionStyle = computed(() => position.value ? { left: `${position.value.x}px`, top: `${position.value.y}px`, right: 'auto', bottom: 'auto' } : {})
const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
function measure() {
  const info = uni.getSystemInfoSync()
  const size = uni.upx2px(100), gap = uni.upx2px(24)
  const width = info.windowWidth, height = info.windowHeight
  const left = Math.max(0, (width - Math.min(width, 540)) / 2)
  const safeBottom = info.safeAreaInsets?.bottom || 0
  let top = info.safeAreaInsets?.top || 0
  // #ifdef H5
  top = Math.max(top, document.querySelector('uni-page-head .uni-page-head')?.getBoundingClientRect().bottom || 0)
  // #endif
  bounds = { minX: left + gap, maxX: Math.max(left + gap, width - left - gap - size), minY: gap + top, maxY: Math.max(gap + top, height - uni.upx2px(110) - safeBottom - gap - size) }
  return bounds
}
function restore() {
  const b = measure(), saved = clientStorage.get(key)
  position.value = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: b.minX + clamp(saved.x, 0, 1) * (b.maxX - b.minX), y: b.minY + clamp(saved.y, 0, 1) * (b.maxY - b.minY) }
    : { x: b.maxX, y: b.maxY }
}
function begin(point) {
  if (!point) return
  measure()
  gesture = { x: point.clientX, y: point.clientY, start: { ...position.value }, moved: false }
}
function move(point) {
  if (!gesture || !point) return
  const dx = point.clientX - gesture.x, dy = point.clientY - gesture.y
  if (Math.hypot(dx, dy) > 6) gesture.moved = true
  if (!gesture.moved) return
  position.value = { x: clamp(gesture.start.x + dx, bounds.minX, bounds.maxX), y: clamp(gesture.start.y + dy, bounds.minY, bounds.maxY) }
}
function startTouch(event) { if (event.touches?.length === 1) begin(event.touches[0]) }
function moveTouch(event) { move(event.touches?.[0]) }
function startMouse(event) { if (event.button === 0) begin(event) }
function mouseMove(event) { if (gesture) { event.preventDefault(); move(event) } }
function finish() {
  if (!gesture) return
  if (gesture.moved) {
    suppressUntil = Date.now() + 500
    const b = bounds
    clientStorage.set(key, { x: (position.value.x - b.minX) / (b.maxX - b.minX || 1), y: (position.value.y - b.minY) / (b.maxY - b.minY || 1) })
  }
  gesture = null
}
function cancel() { if (gesture) { suppressUntil = Date.now() + 500; gesture = null } }
function activate() { if (Date.now() > suppressUntil) emit('activate') }
onMounted(() => {
  restore()
  uni.onWindowResize(restore)
  // #ifdef H5
  window.addEventListener('mousemove', mouseMove)
  window.addEventListener('mouseup', finish)
  window.addEventListener('blur', cancel)
  // #endif
})
onBeforeUnmount(() => {
  uni.offWindowResize(restore)
  // #ifdef H5
  window.removeEventListener('mousemove', mouseMove)
  window.removeEventListener('mouseup', finish)
  window.removeEventListener('blur', cancel)
  // #endif
})
</script>
<style scoped>
.support-float { position: fixed; right: calc(var(--app-content-left, 0px) + 24rpx); bottom: calc(150rpx + var(--app-safe-bottom, 0px)); width: 100rpx; height: 100rpx; border-radius: 50%; background: linear-gradient(135deg, #17191c, #30343a); display: flex; align-items: center; justify-content: center; box-shadow: 0 8rpx 24rpx rgba(23,25,28,.12); z-index: 100; touch-action: none; user-select: none; cursor: grab; }
.support-float:active { cursor: grabbing; }
.support-icon { width: 52rpx; height: 52rpx; filter: brightness(0) saturate(100%) invert(100%); pointer-events: none; }
</style>
