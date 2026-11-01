<template>
  <div class="error-page">
    <h1>404</h1>
    <p>抱歉，您访问的页面不存在</p>
    <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
  </div>
</template>
<style scoped>
.error-page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: var(--app-viewport-height); padding: calc(16px + var(--app-safe-top)) calc(16px + var(--app-safe-right)) calc(16px + var(--app-safe-bottom)) calc(16px + var(--app-safe-left)); text-align: center; }
.error-page h1 { font-size: 120px; color: #e1e3e6; margin: 0; }
.error-page p { font-size: 18px; color: #555b63; margin: 20px 0; }
</style>
