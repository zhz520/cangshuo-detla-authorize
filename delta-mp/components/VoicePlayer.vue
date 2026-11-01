<template>
  <view v-if="src" class="voice-pill" role="button" tabindex="0" :aria-label="playing ? '暂停语音' : label" @click="toggle" @keydown.enter.prevent="toggle" @keydown.space.prevent="toggle">
    <text>{{ playing ? 'Ⅱ' : '▶' }}</text>
    <text class="voice-label">{{ pending ? '正在加载...' : playing ? '播放中，点击暂停' : label }}</text>
    <text v-if="duration" class="voice-duration">{{ duration }}″</text>
    <view class="wave"><view v-for="n in 5" :key="n" class="bar" :class="{ playing }" /></view>
  </view>
</template>
<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'

const props = defineProps({
  src: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  label: { type: String, default: '听TA说一句' }
})
const playing = ref(false)
const pending = ref(false)
let audio
let playAttempt = 0
let failedAttempt = -1
let disposed = false

function playbackFailed(error, attempt) {
  if (disposed || attempt !== playAttempt || failedAttempt === attempt) return
  failedAttempt = attempt
  pending.value = false
  playing.value = false
  uni.showToast({
    title: error?.name === 'NotAllowedError' ? '请再次点击播放，或在系统浏览器中打开' : '语音暂时无法播放，请重试',
    icon: 'none'
  })
}

function createAudio() {
  // H5 的 uni 音频包装没有返回 play() 的 Promise，无法捕获浏览器的手势拦截。
  // #ifdef H5
  audio = new Audio()
  audio.preload = 'metadata'
  audio.onplaying = () => { pending.value = false; playing.value = true }
  audio.onpause = () => { pending.value = false; playing.value = false }
  audio.onended = () => { pending.value = false; playing.value = false }
  audio.onerror = () => { if (pending.value || playing.value) playbackFailed(audio?.error, playAttempt) }
  // #endif
  // #ifndef H5
  audio = uni.createInnerAudioContext()
  audio.autoplay = false
  audio.onPlay(() => { pending.value = false; playing.value = true })
  audio.onPause(() => { pending.value = false; playing.value = false })
  audio.onStop(() => { pending.value = false; playing.value = false })
  audio.onEnded(() => { pending.value = false; playing.value = false })
  audio.onError(error => { if (pending.value || playing.value) playbackFailed(error, playAttempt) })
  // #endif
}

function stop() {
  playAttempt++
  pending.value = false
  playing.value = false
  if (!audio) return
  try {
    // #ifdef H5
    audio.pause()
    audio.currentTime = 0
    // #endif
    // #ifndef H5
    audio.stop()
    // #endif
  } catch (_) {}
}

function toggle() {
  if (!props.src || disposed) return
  const attempt = ++playAttempt
  try {
    if (!audio) createAudio()
    if (playing.value || pending.value) {
      audio.pause()
      playing.value = false
      pending.value = false
      return
    }
    // 只有更换来源才重新赋值，暂停后继续播放不会回到开头。
    if (audioSource !== props.src) {
      audio.src = props.src
      audioSource = props.src
    }
    pending.value = true
    // 必须在本次点击中直接播放；不等待 canplay，也不自动重试。
    const result = audio.play()
    if (result && typeof result.catch === 'function') {
      result.catch(error => playbackFailed(error, attempt))
    }
  } catch (error) {
    playbackFailed(error, attempt)
  }
}

let audioSource = ''
function destroyAudio() {
  stop()
  if (!audio) return
  // #ifdef H5
  audio.onplaying = audio.onpause = audio.onended = audio.onerror = null
  audio.removeAttribute('src')
  audio.load()
  // #endif
  // #ifndef H5
  audio.destroy()
  // #endif
  audio = null
  audioSource = ''
}

// #ifdef H5
function onVisibilityChange() { if (document.hidden) stop() }
// #endif
watch(() => props.src, destroyAudio)
onHide(stop)
onMounted(() => {
  // #ifdef H5
  document.addEventListener('visibilitychange', onVisibilityChange)
  // #endif
})
onUnmounted(() => {
  disposed = true
  destroyAudio()
  // #ifdef H5
  document.removeEventListener('visibilitychange', onVisibilityChange)
  // #endif
})
</script>
<style lang="scss" scoped>
.voice-pill { display: flex; align-items: center; gap: 14rpx; width: fit-content; max-width: 100%; box-sizing: border-box; background: #f2f3f5; color: #17191c; border: 1rpx solid #e6e7e9; border-radius: 999rpx; padding: 16rpx 24rpx; font-size: 24rpx; cursor: pointer; touch-action: manipulation; }
.voice-label { min-width: 0; overflow-wrap: anywhere; }
.voice-duration, .wave { flex-shrink: 0; }
.wave { display: flex; align-items: center; gap: 4rpx; .bar { width: 4rpx; height: 16rpx; background: #17191c; border-radius: 4rpx; &:nth-child(even) { height: 26rpx; } &.playing { animation: pulse .7s infinite alternate; &:nth-child(even) { animation-delay: .2s; } } } }
@keyframes pulse { to { transform: scaleY(.3); } }
</style>
