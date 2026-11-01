<template>
  <view v-if="visible" class="grab-mask" @click="close">
    <view class="grab-dialog" @click.stop>
      <text class="title">确认接单</text>
      <text class="hint">{{ required ? '输入图形验证码后接单' : '确定接受该订单？' }}</text>
      <template v-if="required">
        <AppImage v-if="challenge.image" :src="challenge.image" class="captcha" mode="aspectFit" @click="refresh" />
        <text v-else class="hint">{{ retryIn ? `${retryIn} 秒后可刷新` : '请刷新验证码' }}</text>
        <view class="refresh" @click="refresh">{{ retryIn ? `${retryIn} 秒后可刷新` : '看不清，换一张' }}</view>
        <input :value="code" type="number" maxlength="6" class="input" placeholder="请输入图中 6 位数字" @input="code=$event.detail.value" />
      </template>
      <text v-if="error" class="error">{{ error }}</text>
      <view class="buttons"><button :disabled="busy" @click="close">取消</button><button class="confirm" :disabled="busy || (required && (!challenge.image || code.length!==6))" @click="submit">{{ busy?'处理中...':'确认接单' }}</button></view>
    </view>
  </view>
</template>
<script setup>
import { clientStorage } from '@/utils/client-storage'

import AppImage from '@/components/AppImage.vue'
import { ref, onBeforeUnmount } from 'vue'
import { getAcceptChallenge, acceptOrder } from '@/api/player'
const emit=defineEmits(['accepted'])
const visible=ref(false),busy=ref(false),required=ref(false),challenge=ref({}),code=ref(''),error=ref(''),retryIn=ref(0)
let orderId=null,device='',nextRefresh=0,timer=null,generation=0
function deviceId(){if(!device){device=clientStorage.get('grab_device_id');if(!device){device=`device-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;clientStorage.set('grab_device_id',device)}}return device}
function close(){if(busy.value)return;visible.value=false;generation++;clearInterval(timer);timer=null}
function tick(){retryIn.value=Math.max(0,Math.ceil((nextRefresh-Date.now())/1000))}
async function open(id){if(busy.value||visible.value)return;orderId=id;nextRefresh=0;retryIn.value=0;error.value='';challenge.value={};code.value='';required.value=false;visible.value=true;await refresh()}
async function refresh(){
  if(busy.value||Date.now()<nextRefresh)return
  const run=++generation;busy.value=true;error.value='';code.value=''
  try{const {data}=await getAcceptChallenge(orderId,deviceId());if(run!==generation)return;challenge.value=data;required.value=data.required;nextRefresh=Date.now()+Number(data.refreshSeconds||10)*1000;tick();clearInterval(timer);timer=setInterval(tick,1000)}
  catch(e){if(run!==generation)return;challenge.value={};required.value=true;error.value=e?.msg||'验证码加载失败';nextRefresh=Date.now()+10000;tick();clearInterval(timer);timer=setInterval(tick,1000);if(e?.code===409)visible.value=false}
  finally{busy.value=false}
}
async function submit(){
  if(busy.value)return
  busy.value=true;error.value=''
  try{await acceptOrder(orderId,{captchaId:challenge.value.captchaId,captchaCode:code.value,deviceId:deviceId()});visible.value=false;clearInterval(timer);emit('accepted');uni.showToast({title:'接单成功'})}
  catch(e){error.value=e?.msg||'接单失败，请刷新后重试';code.value='';challenge.value={};required.value=true;if(e?.code===409){visible.value=false;emit('accepted')}else{const run=generation;const delay=Math.max(0,nextRefresh-Date.now());setTimeout(()=>{if(visible.value&&run===generation)refresh()},delay+50)}}
  finally{busy.value=false}
}
onBeforeUnmount(()=>{generation++;clearInterval(timer);visible.value=false})
defineExpose({open})
</script>
<style scoped>
.grab-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:40rpx}.grab-dialog{width:100%;max-width:580rpx;box-sizing:border-box;background:#fff;border-radius:24rpx;padding:36rpx}.title{display:block;font-size:34rpx;font-weight:700}.hint{display:block;color:#73777e;font-size:26rpx;margin:24rpx 0}.captcha{width:100%;height:120rpx}.refresh{text-align:center;font-size:24rpx;color:#666b73;padding:16rpx}.input{height:84rpx;border:1rpx solid #e6e7e9;background:#f7f8f9;border-radius:12rpx;padding:0 20rpx;letter-spacing:6rpx}.error{display:block;color:#d44955;font-size:24rpx;margin-top:20rpx}.buttons{display:flex;gap:20rpx;margin-top:28rpx}.buttons button{flex:1;font-size:28rpx;border-radius:999rpx}.buttons .confirm{background:#17191c;color:#fff}.buttons button[disabled]{opacity:.5}
</style>
