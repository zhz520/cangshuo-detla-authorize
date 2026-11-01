<template>
  <picker class="product-sort-picker" :range="options" range-key="label" :value="selectedIndex" @change="change">
    <view class="sort-label"><text>{{ options[selectedIndex].label }}</text><text class="sort-chevron">⌄</text></view>
  </picker>
</template>
<script setup>
import { computed } from 'vue'
import { productSortOptions } from '@/utils/product-sort'
const props = defineProps({ modelValue: { type: String, default: 'default' } })
const emit = defineEmits(['update:modelValue'])
const options = productSortOptions
const selectedIndex = computed(() => Math.max(0, options.findIndex(item => item.value === props.modelValue)))
function change(event) { emit('update:modelValue', options[Number(event.detail.value)]?.value || 'default') }
</script>
<style scoped>
.product-sort-picker { flex-shrink: 0; min-width: 0; }
.sort-label { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 18rpx 24rpx; background: #fff; border: 1rpx solid #eeeff1; border-radius: 12rpx; color: #17191c; font-size: 24rpx; }
.sort-chevron { color: #73777e; }
</style>
