<template>
  <div class="list-footer"><span role="status">共 {{ total }} 条<span v-if="total"> · 第 {{ state.page }} / {{ Math.max(1,Math.ceil(total/state.size)) }} 页</span></span><el-pagination v-if="total>state.size" v-model:current-page="state.page" :page-size="state.size" :total="total" layout="prev, pager, next" :pager-count="5" background /></div>
</template>
<script setup>
defineProps({ total: Number, state: Object })
</script>
