<template>
  <view class="voice-editor">
    <VoicePlayer :src="modelValue" :duration="duration" label="试听我的语音" />
    <view class="voice-actions">
      <button size="mini" :disabled="busy || preparing || choosing || stopping" @click="record">{{ recordLabel }}</button>
      <!-- #ifdef H5 -->
      <button size="mini" :disabled="busy || preparing || recording || choosing || stopping" @click="chooseFile">上传音频</button>
      <!-- #endif -->
      <text v-if="modelValue && !busy && !preparing && !recording && !choosing" @click="clear">删除语音</text>
    </view>
    <text class="voice-tip">最多60秒、10MB，录音结束后自动上传；记得保存主页。</text>
    <text v-if="recordHint" class="voice-tip voice-fallback">{{ recordHint }}</text>
  </view>
</template>
<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import VoicePlayer from './VoicePlayer.vue'
import { uploadProfileAudio } from '@/utils/profile-audio'

defineProps({ modelValue: { type: String, default: '' }, duration: { type: Number, default: 0 } })
const emit = defineEmits(['update:modelValue', 'update:duration', 'busy'])
const busy = ref(false)
const recording = ref(false)
const preparing = ref(false)
const choosing = ref(false)
const stopping = ref(false)
const recordSupported = ref(true)
const recordHint = ref('')
const recordLabel = computed(() => stopping.value ? '正在结束...' : recording.value ? '结束录音' : busy.value ? '上传中...' : preparing.value ? '正在开启...' : recordSupported.value ? '录制一句' : '选择音频')
const MAX_SIZE = 10 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|m4a|wav|aac|ogg|webm)$/i
let recorder, stream, timer
let started = 0
let stoppedAt = 0
let disposed = false
let active = true
let pageShown = true
let operationId = 0
let nativeRecordingId = 0

watch(() => busy.value || recording.value || preparing.value || choosing.value || stopping.value, value => emit('busy', value), { flush: 'sync' })

// #ifdef H5
recordSupported.value = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.isSecureContext !== false)
if (!recordSupported.value) recordHint.value = '当前浏览器无法录音，请上传音频；也可先用系统录音工具录制。'
let fileInput, pickerFocus, pickerTimer, cancelRead
// #endif

function isCurrent(id) { return !disposed && active && id === operationId }

function cleanup() {
  clearTimeout(timer)
  if (stream) {
    stream.getTracks().forEach(track => track.stop())
    stream = null
  }
}

async function save(file, name, seconds, id) {
  if (!isCurrent(id)) return
  busy.value = true
  try {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('语音须为1至60秒')
    const url = await uploadProfileAudio(file, name)
    if (isCurrent(id)) {
      emit('update:modelValue', url)
      emit('update:duration', seconds)
      uni.showToast({ title: '语音已上传' })
    }
  } catch (error) {
    if (isCurrent(id)) uni.showToast({ title: error.message || '上传失败', icon: 'none' })
  } finally {
    if (isCurrent(id)) busy.value = false
  }
}

function clear() {
  if (busy.value || preparing.value || recording.value || choosing.value || stopping.value) return
  emit('update:modelValue', '')
  emit('update:duration', 0)
}

function recordingFailed(error, id) {
  if (!isCurrent(id)) return
  operationId++
  // #ifdef H5
  releaseH5Recorder()
  recordHint.value = '无法开启录音时，可点击“上传音频”选择已录好的文件。'
  // #endif
  cleanup()
  preparing.value = false
  recording.value = false
  stopping.value = false
  uni.showToast({ title: error?.message || '录音失败，请检查麦克风权限', icon: 'none' })
}

function stopRecording() {
  if (!recording.value || stopping.value) return
  stopping.value = true
  stoppedAt = Date.now()
  try { recorder.stop() } catch (error) { recordingFailed(error, operationId) }
}

async function record() {
  if (recording.value) { stopRecording(); return }
  if (disposed || !active || busy.value || preparing.value || choosing.value || stopping.value) return
  // #ifdef H5
  if (!recordSupported.value) { chooseFile(); return }
  // #endif
  const id = ++operationId
  preparing.value = true
  recordHint.value = ''
  stoppedAt = 0
  // #ifdef H5
  try {
    // 授权期间也锁定操作；离页后才返回的麦克风流立即释放。
    const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!isCurrent(id)) { acquiredStream.getTracks().forEach(track => track.stop()); return }
    stream = acquiredStream
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
    const type = typeof MediaRecorder.isTypeSupported === 'function' ? types.find(value => MediaRecorder.isTypeSupported(value)) : ''
    const currentRecorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    recorder = currentRecorder
    const chunks = []
    let size = 0
    let recordError = ''
    currentRecorder.ondataavailable = event => {
      if (!isCurrent(id) || !event.data?.size) return
      size += event.data.size
      if (size > MAX_SIZE) {
        recordError = '音频不能超过10MB'
        stopRecording()
      } else {
        chunks.push(event.data)
      }
    }
    currentRecorder.onerror = () => recordingFailed(new Error('录音失败，请上传音频或检查麦克风权限'), id)
    currentRecorder.onstop = () => {
      if (!isCurrent(id)) return
      const seconds = Math.max(1, Math.round(((stoppedAt || Date.now()) - started) / 1000))
      const mime = currentRecorder.mimeType || chunks[0]?.type || type || ''
      const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('aac') ? 'aac' : ''
      cleanup()
      recorder = null
      if (recordError || !extension || !chunks.length) {
        recordingFailed(new Error(recordError || '未获得可用录音，请上传音频'), id)
        return
      }
      // save 同步进入忙碌状态后才退出录音状态，保持父页面保存按钮锁定。
      save(new Blob(chunks, { type: mime }), 'voice.' + extension, seconds, id)
      recording.value = false
      stopping.value = false
    }
    started = Date.now()
    currentRecorder.start(1000)
    recording.value = true
    preparing.value = false
    timer = setTimeout(stopRecording, 60000)
  } catch (error) {
    recordingFailed(new Error(error?.name === 'NotAllowedError' ? '麦克风权限未开启，可改用上传音频' : '无法开启录音，可改用上传音频'), id)
  }
  // #endif
  // #ifndef H5
  try {
    if (nativeRecordingId) throw new Error('上一段录音正在结束，请稍后重试')
    if (typeof uni.getRecorderManager !== 'function') throw new Error('当前环境不支持录音，请在手机浏览器中上传音频')
    if (!recorder) {
      recorder = uni.getRecorderManager()
      recorder.onStart(() => {
        if (!isCurrent(nativeRecordingId)) return
        clearTimeout(timer)
        preparing.value = false
        recording.value = true
      })
      recorder.onStop(result => {
        const currentId = nativeRecordingId
        nativeRecordingId = 0
        if (!isCurrent(currentId)) return
        cleanup()
        const seconds = Math.max(1, Math.round(Number(result.duration) / 1000))
        save(result.tempFilePath, 'voice.mp3', seconds, currentId)
        preparing.value = false
        recording.value = false
        stopping.value = false
      })
      recorder.onError(() => {
        const currentId = nativeRecordingId
        nativeRecordingId = 0
        recordingFailed(new Error('录音失败，请检查麦克风权限'), currentId)
      })
    }
    nativeRecordingId = id
    started = Date.now()
    timer = setTimeout(() => {
      if (isCurrent(id) && preparing.value) {
        recordingFailed(new Error('无法开启录音，请检查麦克风权限'), id)
        try { recorder.stop() } catch (_) {}
      }
    }, 10000)
    recorder.start({ duration: 60000, format: 'mp3' })
  } catch (error) {
    if (nativeRecordingId === id) nativeRecordingId = 0
    recordingFailed(error, id)
  }
  // #endif
}

// #ifdef H5
function releaseH5Recorder() {
  if (!recorder) return
  const previous = recorder
  recorder = null
  previous.ondataavailable = previous.onstop = previous.onerror = null
  try { if (previous.state !== 'inactive') previous.stop() } catch (_) {}
}

function cleanupPicker() {
  clearTimeout(pickerTimer)
  if (pickerFocus) window.removeEventListener('focus', pickerFocus)
  pickerFocus = null
  if (fileInput) {
    fileInput.onchange = fileInput.oncancel = null
    fileInput.remove()
    fileInput = null
  }
  choosing.value = false
}

function readDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const objectUrl = URL.createObjectURL(file)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('无法读取音频，请更换mp3或m4a文件')), 10000)
    const cancel = () => finish(new Error('已取消'))
    cancelRead = cancel
    function finish(error, seconds) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      audio.onloadedmetadata = audio.ondurationchange = audio.ontimeupdate = audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(objectUrl)
      if (cancelRead === cancel) cancelRead = null
      error ? reject(error) : resolve(seconds)
    }
    function checkDuration() {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      const seconds = Math.ceil(audio.duration)
      if (seconds > 60) finish(new Error('请选择60秒以内的音频'))
      else finish(null, seconds)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      if (audio.duration === Infinity) {
        // 部分 WebM 不带时长，触发尾部读取；仍无法确定时长则拒绝上传。
        try { audio.currentTime = 1e10 } catch (_) {}
      }
      checkDuration()
    }
    audio.ondurationchange = audio.ontimeupdate = checkDuration
    audio.onerror = () => finish(new Error('无法读取音频，请更换mp3或m4a文件'))
    try { audio.src = objectUrl; audio.load() } catch (error) { finish(error) }
  })
}

function chooseFile() {
  if (disposed || !active || busy.value || preparing.value || recording.value || choosing.value || stopping.value) return
  const id = ++operationId
  choosing.value = true
  const input = document.createElement('input')
  fileInput = input
  input.type = 'file'
  input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.webm'
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  input.tabIndex = -1
  const select = async () => {
    if (fileInput !== input) return
    const file = input.files?.[0]
    // 先进入读取状态，再清理选择状态，避免父页面短暂解锁。
    if (file) busy.value = true
    cleanupPicker()
    if (!file || !isCurrent(id)) return
    try {
      if (!AUDIO_EXTENSION.test(file.name)) throw new Error('请选择mp3、m4a、wav、aac、ogg或webm音频')
      if (!file.size || file.size > MAX_SIZE) throw new Error('音频文件须非空且不超过10MB')
      const seconds = await readDuration(file)
      if (isCurrent(id)) await save(file, file.name, seconds, id)
    } catch (error) {
      if (isCurrent(id)) uni.showToast({ title: error.message || '无法读取音频', icon: 'none' })
    } finally {
      if (isCurrent(id)) busy.value = false
    }
  }
  input.onchange = select
  input.oncancel = cleanupPicker
  // 兼容尚不派发 cancel 的旧内置浏览器，返回窗口后也能释放选择锁。
  pickerFocus = () => { pickerTimer = setTimeout(select, 1000) }
  window.addEventListener('focus', pickerFocus, { once: true })
  document.body.appendChild(input)
  try { input.click() } catch (_) {
    cleanupPicker()
    uni.showToast({ title: '无法打开文件选择，请在系统浏览器中重试', icon: 'none' })
  }
}

function onVisibilityChange() {
  if (document.hidden && (recording.value || preparing.value)) leave()
  else if (!document.hidden && pageShown && !disposed) active = true
}
document.addEventListener('visibilitychange', onVisibilityChange)
// #endif

function leave() {
  operationId++
  active = false
  // #ifdef H5
  cleanupPicker()
  cancelRead?.()
  releaseH5Recorder()
  // #endif
  // #ifndef H5
  if (nativeRecordingId) { try { recorder.stop() } catch (_) {} }
  // #endif
  cleanup()
  preparing.value = false
  recording.value = false
  stopping.value = false
  busy.value = false
}
onShow(() => { pageShown = true; active = true })
onHide(() => { pageShown = false; leave() })
onUnmounted(() => {
  disposed = true
  leave()
  // #ifdef H5
  document.removeEventListener('visibilitychange', onVisibilityChange)
  // #endif
})
</script>
<style lang="scss" scoped>
.voice-editor { min-width: 0; max-width: 100%; }
.voice-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 20rpx; margin: 20rpx 0;
  button { margin: 0; max-width: 100%; border-radius: 999rpx; background: #f2f3f5; color: #17191c; font-size: 24rpx; }
  text { font-size: 24rpx; color: #c94f59; }
}
.voice-tip { display: block; font-size: 22rpx; line-height: 1.6; color: #858992; overflow-wrap: anywhere; }
.voice-fallback { margin-top: 8rpx; }
</style>
