<template>
  <div class="page-container"><el-card v-loading="loading">
    <template #header><div class="header"><span>打赏与抢单设置</span><el-button type="primary" :loading="saving" @click="save">保存设置</el-button></div></template>
    <el-form v-if="form" label-width="210px" class="rules-form">
      <h3>打赏规则</h3>
      <el-form-item label="开启打赏"><el-switch v-model="form.rewardEnabled" /></el-form-item>
      <el-form-item label="最低打赏金额（元）"><el-input-number v-model="form.minAmount" :min="0.01" :max="10000" :precision="2" /></el-form-item>
      <el-form-item label="最高打赏金额（元）"><el-input-number v-model="form.maxAmount" :min="0.01" :max="10000" :precision="2" /></el-form-item>
      <el-form-item v-for="field in limits" :key="field.key" :label="field.label"><el-input-number v-model="form[field.key]" :min="1" :max="field.max" :precision="0" /></el-form-item>
      <el-form-item label="平台打赏服务费（%）"><el-input-number v-model="form.feePercent" :min="0" :max="100" :precision="2" /><span class="tip">0 表示全额归打手</span></el-form-item>
      <h3>抢单图形验证码</h3>
      <el-form-item label="验证码有效期（秒）"><el-input-number v-model="form.captchaSeconds" :min="30" :max="600" :precision="0" /></el-form-item>
      <el-form-item label="单个验证码最多错误次数"><el-input-number v-model="form.captchaAttempts" :min="1" :max="10" :precision="0" /></el-form-item>
      <el-form-item label="刷新间隔（秒）"><el-input-number v-model="form.captchaRefreshSeconds" :min="3" :max="120" :precision="0" /></el-form-item>
      <el-alert title="在打手等级分类中设置是否验证；在打手管理中设置个人例外。保存后对新请求生效。" type="info" :closable="false" />
    </el-form>
  </el-card></div>
</template>
<script setup>
import {ref,onMounted} from 'vue'
import {ElMessage} from 'element-plus'
import {getRewardGrabSettings,saveRewardGrabSettings} from '@/api/reward'
const loading=ref(false),saving=ref(false),form=ref(null)
const limits=[{key:'validDays',label:'完成后可打赏天数',max:365},{key:'userDailyLimit',label:'每客户每日打赏次数',max:1000},{key:'playerDailyLimit',label:'每打手每日接收次数',max:1000},{key:'pairDailyLimit',label:'同客户对同打手每日次数',max:1000}]
onMounted(async()=>{loading.value=true;try{form.value=(await getRewardGrabSettings()).data}finally{loading.value=false}})
async function save(){if(!form.value)return;if(form.value.minAmount>form.value.maxAmount)return ElMessage.warning('最低金额不能高于最高金额');saving.value=true;try{await saveRewardGrabSettings(form.value);ElMessage.success('已保存，新请求立即使用新规则')}finally{saving.value=false}}
</script>
<style scoped>.header{display:flex;align-items:center;justify-content:space-between}.rules-form{max-width:780px}.tip{margin-left:14px;color:#858992}h3{margin:20px 0 24px}</style>
