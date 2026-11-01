<template>
  <image ref="imageRef" :src="displaySource" :mode="mode" :lazy-load="!eager" class="app-image" :class="{ 'image-loading': !loaded, 'image-failed': failed }" @load="onLoad" @error="onError" />
</template>
<script setup>
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { thumbnailUrl } from '@/utils/image'
const props = defineProps({ src: { type: String, default: '' }, mode: { type: String, default: 'aspectFill' }, width: { type: Number, default: 640 }, eager: Boolean })
const emit = defineEmits(['load', 'error'])
const imageRef = ref(null), loaded = ref(false), failed = ref(false), original = ref(false)
const visible = ref(true)
let observer
// #ifdef H5
visible.value = props.eager || typeof IntersectionObserver === 'undefined'
// #endif
const criticalSource = computed(() => {
  const source = String(props.src || '').trim()
  return Boolean(props.eager) || source.startsWith('/static/') || /^(data|blob):/i.test(source)
})
const displaySource = computed(() => failed.value
  ? '/static/icons/图片.svg'
  : !visible.value && !criticalSource.value
    ? ''
    : original.value ? props.src : thumbnailUrl(props.src, props.width))
function hints() {
  // #ifdef H5
  const element = imageRef.value?.$el || imageRef.value
  const img = element?.querySelector?.('img')
  if (img) { img.decoding = 'async'; img.fetchPriority = props.eager ? 'high' : 'auto' }
  // #endif
}
watch(() => props.src, () => { loaded.value = false; failed.value = false; original.value = false; nextTick(hints) })
function onLoad(event) { loaded.value = true; hints(); emit('load', event) }
function onError(event) {
  if (!original.value && displaySource.value !== props.src) { original.value = true; return }
  if (!failed.value) { failed.value = true; loaded.value = true; emit('error', event) }
}
onMounted(() => {
  // #ifdef H5
  if (!visible.value) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { visible.value = true; observer.disconnect(); nextTick(hints) }
    }, { rootMargin: '160px' })
    observer.observe(imageRef.value?.$el || imageRef.value)
  }
  // #endif
  nextTick(hints)
})
onBeforeUnmount(() => observer?.disconnect())
</script>
<style scoped>
.app-image { background-color: #f0f1f3; }
.image-loading { background-color: #f0f1f3; }
.image-failed { background-color: #f0f1f3; }
</style>
