<template>
  <view class="reward-action">
    <view v-if="options?.eligible" class="reward-button" @click="open">打赏打手</view>
    <view v-else-if="options?.reward" class="reward-status">打赏 ¥{{ Number(options.reward.amount).toFixed(2) }} · {{ statusText[options.reward.status] || options.reward.status }}</view>
    <view v-if="visible" class="reward-mask" @click="close"><view class="reward-dialog" @click.stop>
      <text class="title">打赏打手</text><text class="hint">余额支付 · 每单限一次 · {{ options.minAmount }}～{{ options.maxAmount }} 元</text>
      <view class="presets"><view v-for="value in presets" :key="value" :class="{selected:Number(amount)===value}" @click="setAmount(value)">¥{{ value }}</view></view>
      <input :value="amount" type="digit" maxlength="8" class="input" placeholder="自定义金额（元）" @input="onAmountInput" />
      <textarea v-model="remark" maxlength="200" class="remark" placeholder="说句感谢的话（选填）" />
      <text class="hint">可用余额 ¥{{ Number(options.balance||0).toFixed(2) }} · 打手实收 ¥{{ netAmount }}</text>
      <text v-if="error" class="error">{{ error }}</text>
      <view v-if="Number(amount)>Number(options.balance)" class="recharge" @click="recharge">余额不足，去充值</view>
      <view class="buttons"><button :disabled="busy" @click="close">取消</button><button class="confirm" :disabled="busy" @click="submit">{{ busy?'支付中...':'确认打赏' }}</button></view>
    </view></view>
  </view>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { getRewardOptions, payReward } from '@/api/reward'
const props=defineProps({orderId:[Number,String],refreshKey:Number,autoOpen:Boolean})
const options=ref(null),visible=ref(false),busy=ref(false),amount=ref(''),remark=ref(''),error=ref('')
const statusText={PAID:'已到账',REVERSAL_PENDING:'冲正处理中',REVERSED:'已冲正退款'}
const presets=computed(()=>[5,10,20].filter(v=>v>=Number(options.value?.minAmount)&&v<=Number(options.value?.maxAmount)))
const netAmount=computed(()=>Math.max(0,Number(amount.value||0)*(1-Number(options.value?.feePercent||0)/100)).toFixed(2))
let requestId='',opened=false
function newRequest(){requestId=''}
function onAmountInput(e){amount.value=e.detail.value;newRequest()}
function setAmount(v){amount.value=String(v);newRequest()}
async function reload(){if(!props.orderId)return;try{options.value=(await getRewardOptions(props.orderId)).data;if(props.autoOpen&&!opened&&options.value?.eligible){opened=true;open()}}catch(_){options.value=null}}
watch(()=>[props.orderId,props.refreshKey],reload,{immediate:true})
function open(){visible.value=true;error.value='';if(!amount.value)amount.value=String(presets.value[0]||options.value.minAmount)}
function close(){if(!busy.value)visible.value=false}
function recharge(){if(busy.value)return;visible.value=false;uni.navigateTo({url:'/pages/wallet/recharge'})}
async function submit(){
  if(busy.value)return
  if(!/^\d+(\.\d{1,2})?$/.test(amount.value)||Number(amount.value)<Number(options.value.minAmount)||Number(amount.value)>Number(options.value.maxAmount))return uni.showToast({title:'请输入限额内的金额，最多两位小数',icon:'none'})
  if(Number(amount.value)>Number(options.value.balance))return recharge()
  if(!requestId)requestId=`reward-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  busy.value=true;error.value=''
  try{await payReward(props.orderId,{amount:amount.value,remark:remark.value,requestId});visible.value=false;uni.showToast({title:'打赏成功'});await reload()}
  catch(e){error.value=e?.msg||'支付结果未确认，可重试查询；请勿重复操作';await reload();if(options.value?.reward)visible.value=false}
  finally{busy.value=false}
}
</script>
<style scoped>
.reward-button{background:#17191c;color:#fff;text-align:center;padding:26rpx;border-radius:999rpx;margin:24rpx}.reward-status{color:#73777e;text-align:center;padding:24rpx;font-size:26rpx}.reward-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:40rpx}.reward-dialog{width:100%;max-width:600rpx;box-sizing:border-box;background:#fff;border-radius:24rpx;padding:32rpx}.title{display:block;font-size:34rpx;font-weight:700}.hint{display:block;font-size:24rpx;color:#73777e;line-height:1.7;margin:20rpx 0}.presets{display:flex;gap:16rpx;margin:24rpx 0}.presets view{flex:1;text-align:center;padding:20rpx 0;border:1rpx solid #e6e7e9;border-radius:12rpx}.presets .selected{background:#17191c;color:#fff}.input,.remark{box-sizing:border-box;width:100%;background:#f7f8f9;border:1rpx solid #e6e7e9;border-radius:12rpx;padding:20rpx;font-size:27rpx}.input{height:84rpx}.remark{height:140rpx;margin-top:20rpx}.buttons{display:flex;gap:20rpx;margin-top:24rpx}.buttons button{flex:1;font-size:28rpx;border-radius:999rpx}.buttons .confirm{background:#17191c;color:#fff}.buttons button[disabled]{opacity:.5}.error{display:block;color:#d44955;font-size:24rpx}.recharge{font-size:26rpx;text-align:center;padding:20rpx;text-decoration:underline}
</style>
