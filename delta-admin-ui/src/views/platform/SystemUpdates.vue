<template>
  <div class="updates-page" v-loading="loading">
    <el-card shadow="never">
      <template #header><div class="heading"><h2>系统更新</h2><el-button @click="load">刷新版本信息</el-button></div></template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <template v-if="info && overview">
        <el-descriptions :column="isCompact ? 1 : 2" border>
          <el-descriptions-item label="当前版本">{{ info.version }}</el-descriptions-item>
          <el-descriptions-item label="发布通道">{{ info.channel === 'preview' ? '预览验证' : info.channel }}</el-descriptions-item>
          <el-descriptions-item label="客户编号">{{ overview.customerId }}</el-descriptions-item>
          <el-descriptions-item label="更新方式">维护人员手动部署</el-descriptions-item>
        </el-descriptions>
        <el-alert class="notice" :title="info.message" type="info" :closable="false" show-icon />
        <p>当前显示本实例内置的版本记录；尚未连接 GitHub 正式发布源，不能据此判断是否有更新版本。</p>
      </template>
    </el-card>
    <el-card v-if="info" shadow="never">
      <template #header>本版本变更</template>
      <ul><li v-for="note in info.releaseNotes" :key="note">{{ note }}</li></ul>
    </el-card>
    <el-card shadow="never">
      <template #header>更新保护范围</template>
      <p>品牌、域名、Logo、支付配置、上传文件和业务数据属于本实例配置，后续版本更新应独立保留。</p>
      <p>自助升级将在正式版本源、实例备份、数据库迁移与回退验证接入后开放。当前页面不执行安装操作。</p>
      <el-button @click="$router.push('/platform/features')">查看功能与授权</el-button>
    </el-card>
  </div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { useResponsive } from '@/utils/responsive'
import { getPlatformOverview, getPlatformUpdates } from '@/api/platform'
const { isCompact } = useResponsive()
const info = ref(null), overview = ref(null), loading = ref(false), error = ref('')
async function load() {
  loading.value = true; error.value = ''
  try { const [status, identity] = await Promise.all([getPlatformUpdates(), getPlatformOverview()]); info.value = status.data; overview.value = identity.data }
  catch { error.value = '版本信息加载失败，请刷新重试。'; info.value = null; overview.value = null }
  finally { loading.value = false }
}
onMounted(load)
</script>
<style scoped>
.updates-page { display: grid; gap: 18px; }
.heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 20px; }
p, li { color: #555b63; line-height: 1.9; font-size: 14px; }
ul { padding-left: 22px; margin: 0; }
.notice { margin-top: 18px; }
</style>
