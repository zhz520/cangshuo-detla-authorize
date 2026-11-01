<template><div><h4>抢单验证记录</h4><p v-if="failed">暂时无法读取验证记录</p><template v-else><p>验证码刷新 {{ counters.refreshes||0 }} 次 · 验证失败 {{ counters.failures||0 }} 次 · 验证通过 {{ counters.verified||0 }} 次</p><p class="tip">计数保留至最近活动后30天，最近接单记录取最新10笔。</p><el-table :data="orders" size="small"><el-table-column prop="orderNo" label="订单号"/><el-table-column prop="status" label="状态"/><el-table-column prop="acceptTime" label="接单时间"/></el-table></template></div></template>
<script setup>
import {ref,watch} from 'vue'
import {getGrabMetrics} from '@/api/reward'
const props=defineProps({playerId:[String,Number]})
const counters=ref({}),orders=ref([]),failed=ref(false)
watch(()=>props.playerId,async id=>{if(!id)return;try{const {data}=await getGrabMetrics(id);counters.value=data.counters;orders.value=data.recentOrders;failed.value=false}catch(_){failed.value=true}},{immediate:true})
</script>
<style scoped>.tip{color:#858992;font-size:12px}</style>
