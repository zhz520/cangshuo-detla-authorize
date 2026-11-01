<template>
  <div class="page-container">
    <el-card>
      <template #header><span>操作日志</span></template>
      <el-form :inline="true" :model="query" class="search-form">
        <el-form-item>
          <el-select v-model="query.module" placeholder="模块" clearable>
            <el-option v-for="item in modules" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.operatorType" placeholder="操作者类型" clearable>
            <el-option label="管理员" value="ADMIN" /><el-option label="客服" value="CS" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="fetchData">查询</el-button><el-button @click="query.module='';query.operatorType='';fetchData()">重置</el-button></el-form-item>
      </el-form>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="module" label="模块" width="110"><template #default="{ row }">{{ moduleLabel(row.module) }}</template></el-table-column>
        <el-table-column prop="operation" label="操作" width="150" />
        <el-table-column prop="operatorType" label="操作者类型" width="100"><template #default="{ row }">{{ operatorLabel(row.operatorType) }}</template></el-table-column>
        <el-table-column prop="operatorName" label="操作者" width="120" />
        <el-table-column prop="targetType" label="目标类型" width="100" />
        <el-table-column prop="targetId" label="目标ID" width="80" />
        <el-table-column prop="detail" label="详情" show-overflow-tooltip />
        <el-table-column prop="ip" label="IP" width="130" />
        <el-table-column prop="createdAt" label="时间" width="170" />
      </el-table>
      <Pagination :total="total" v-model:page="query.pageNum" v-model:limit="query.pageSize" @pagination="fetchData" />
    </el-card>
  </div>
</template>
<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getOperationLogList } from '@/api/system'
import Pagination from '@/components/Pagination.vue'
const loading = ref(false), list = ref([]), total = ref(0)
const query = reactive({ pageNum: 1, pageSize: 20, module: '', operatorType: '' })
const modules = [
  { label: '商品', value: 'product' }, { label: '订单', value: 'order' },
  { label: '用户', value: 'user' }, { label: '打手', value: 'player' },
  { label: '打手等级', value: 'player-level' }, { label: '提现', value: 'withdraw' },
  { label: '投诉', value: 'complaint' }, { label: '接力', value: 'relay' },
  { label: '评价', value: 'review' }, { label: '打赏与抢单', value: 'reward-grab' },
  { label: '系统', value: 'system' }, { label: '登录', value: 'auth' }
]
const moduleLabel = value => modules.find(item => item.value === value)?.label || value || '-'
const operatorLabel = value => ({ ADMIN: '管理员', CS: '客服', UNKNOWN: '未知' }[value] || value || '-')
async function fetchData() {
  loading.value = true
  try {
    const res = await getOperationLogList({
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      ...(query.module ? { module: query.module } : {}),
      ...(query.operatorType ? { operatorType: query.operatorType } : {})
    })
    list.value = res.data.records
    total.value = Number(res.data.total)
  }
  finally { loading.value = false }
}
onMounted(fetchData)
</script>
<style scoped>.search-form { margin-bottom: 16px; }</style>
