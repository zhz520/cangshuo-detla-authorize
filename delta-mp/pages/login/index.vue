<template>
  <view class="login-page">
    <view class="logo-area">
      <AppImage class="logo" :src="siteStore.logo || '/static/images/logo.png'" mode="aspectFit" />
      <text class="title">{{ siteStore.siteName }}</text>
      <text class="subtitle">{{ siteStore.subtitle }}</text>
    </view>

    <!-- 登录方式切换 -->
    <view v-if="!setupToken" class="tab-bar">
      <view class="tab-item" :class="{ active: loginMode === 'wechat' }" @click="switchWechatMode">{{ quickLoginTitle }}</view>
      <view class="tab-item" :class="{ active: loginMode === 'password' }" @click="loginMode = 'password';loadCaptcha()">密码登录</view>
    </view>

    <view v-if="setupToken" class="login-area setup-area">
      <text class="setup-title">设置登录密码</text>
      <text class="setup-hint">手机号已验证。设置后可使用手机号和密码登录。</text>
      <input v-model="newPassword" :password="true" maxlength="32" placeholder="请输入8～32位密码，包含字母和数字" class="input" />
      <input v-model="confirmPassword" :password="true" maxlength="32" placeholder="请再次输入密码" class="input" />
      <view class="login-btn account-btn" @click="submitPasswordSetup">{{ loggingIn?'设置中...':'设置密码并登录' }}</view>
      <view class="setup-back" @click="restartPhoneLogin">重新验证手机号</view>
    </view>
    <view v-else class="login-area">
      <!-- 快速登录 -->
      <template v-if="loginMode === 'wechat'">
        <template v-if="canUseWechatLogin">
          <button v-if="!needPhoneAuth" class="login-btn wechat-btn" @click="handleWechatLogin">快速登录</button>
          <button v-else class="login-btn wechat-btn" open-type="getPhoneNumber" @getphonenumber="handlePhoneAuthorize">
            首次登录请授权手机号
          </button>
          <view v-if="needPhoneAuth" class="wechat-tip">检测到是首次登录，授权手机号后即可完成注册</view>
        </template>
        <template v-else>
          <input v-model="phone" type="number" maxlength="11" placeholder="请输入手机号" class="input" />
          <view class="verification-row">
            <input v-model="captchaCode" maxlength="6" placeholder="请输入图形验证码" class="input" />
            <AppImage :src="captchaImage" class="captcha-image" mode="aspectFit" @click="loadCaptcha" />
          </view>
          <view class="verification-row">
            <input v-model="verifyCode" type="number" maxlength="6" placeholder="请输入短信验证码" class="input" />
            <button class="send-code" :disabled="sendingCode || codeCountdown > 0" @click="sendCode">{{ codeCountdown ? `${codeCountdown}秒后重试` : '获取验证码' }}</button>
          </view>
          <view class="login-btn wechat-btn" @click="handleH5Login">登录</view>
        </template>
      </template>

      <template v-else-if="loginMode === 'password'">
        <input v-model="phone" type="number" maxlength="11" placeholder="请输入手机号" class="input" />
        <input v-model="userPassword" :password="true" maxlength="72" placeholder="请输入登录密码" class="input" />
        <view class="verification-row"><input v-model="captchaCode" maxlength="6" placeholder="请输入图形验证码" class="input" /><AppImage :src="captchaImage" class="captcha-image" mode="aspectFit" @click="loadCaptcha" /></view>
        <view class="login-btn account-btn" @click="handleUserPasswordLogin">{{ loggingIn?'登录中...':'登录' }}</view>
        <view class="setup-hint">忘记密码可使用手机验证码登录，或联系客服重置。</view>
      </template>
      <view class="agreement">
        <view class="agree-row">
          <view class="checkbox" :class="{ checked: agreed }" @click="toggleAgree">
            <text v-if="agreed" class="check-icon">✔</text>
          </view>
          <text class="text">我已阅读并同意</text>
          <text class="link" @click="goPage('/pages/agreement/user')">《用户协议》</text>
          <text class="text">和</text>
          <text class="link" @click="goPage('/pages/agreement/privacy')">《隐私政策》</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { clientStorage } from '@/utils/client-storage'

import AppImage from '@/components/AppImage.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import { useUserStore } from '@/store/user'
import { useAppStore } from '@/store/app'
import { useSiteStore } from '@/store/site'
import { useChatStore } from '@/store/chat'
import { getLoginCaptcha, sendLoginCode } from '@/api/auth'
import { isMpWeixin } from '@/utils/platform'

const userStore = useUserStore()
const chatStore = useChatStore()
const appStore = useAppStore()
const siteStore = useSiteStore()

const loginMode = ref('wechat')
const phone = ref('')
const setupToken=ref(''),newPassword=ref(''),confirmPassword=ref(''),userPassword=ref(''),loggingIn=ref(false)
const verifyCode = ref('')
const captchaCode=ref(''),captchaId=ref(''),captchaImage=ref(''),smsRequestId=ref('')
const sendingCode=ref(false),codeCountdown=ref(0)
let countdownTimer
async function loadCaptcha() {
  if (isMpWeixin()) return
  try {const {data}=await getLoginCaptcha();captchaId.value=data.captchaId;captchaImage.value=data.image;captchaCode.value=''} catch (_) {}
}
async function sendCode() {
  if(sendingCode.value || codeCountdown.value) return
  if(!/^1\d{10}$/.test(phone.value) || !captchaCode.value) return uni.showToast({title:'请填写手机号和图形验证码',icon:'none'})
  sendingCode.value=true
  try {
    const {data}=await sendLoginCode({phone:phone.value,captchaId:captchaId.value,captchaCode:captchaCode.value})
    smsRequestId.value=data.requestId;codeCountdown.value=data.retryAfter||60
    clearInterval(countdownTimer);countdownTimer=setInterval(()=>{if(--codeCountdown.value<=0)clearInterval(countdownTimer)},1000)
    uni.showToast({title:'验证码已发送',icon:'none'})
  } catch (_) {} finally {sendingCode.value=false;loadCaptcha()}
}
onMounted(loadCaptcha)
onUnmounted(()=>clearInterval(countdownTimer))
const agreed = ref(false)
const needPhoneAuth = ref(false)
const canUseWechatLogin = isMpWeixin()
const quickLoginTitle = canUseWechatLogin ? '快速登录' : '手机登录'

async function handleWechatLogin() {
  if (!agreed.value) {
    return uni.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' })
  }
  const result = await userStore.login()
  if (result.success) {
    completeWechatLogin()
    return
  }
  if (result.code === 1006) {
    needPhoneAuth.value = true
  }
}

async function handlePhoneAuthorize(e) {
  if (!agreed.value) {
    return uni.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' })
  }
  if (e.detail.errMsg && e.detail.errMsg.indexOf('deny') > -1) {
    return uni.showToast({ title: '首次登录需授权手机号', icon: 'none' })
  }
  const phoneCode = e.detail.code || ''
  const result = await userStore.login(phoneCode)
  if (result.success) completeWechatLogin()
}

async function handleH5Login() {
  if(loggingIn.value)return
  if (!agreed.value) {
    return uni.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' })
  }
  if (!/^1\d{10}$/.test(phone.value)) {
    return uni.showToast({ title: '请输入正确的手机号', icon: 'none' })
  }
  if (!verifyCode.value) {
    return uni.showToast({ title: '请输入验证码', icon: 'none' })
  }
  if(!smsRequestId.value) return uni.showToast({title:'请先获取短信验证码',icon:'none'})
  loggingIn.value=true
  try {
    const result = await userStore.loginByPhone(phone.value, verifyCode.value, smsRequestId.value)
    if(result.passwordSetupRequired){setupToken.value=result.data.setupToken;newPassword.value='';confirmPassword.value='';smsRequestId.value='';verifyCode.value='';return}
    if (result.success) completeWechatLogin()
  } finally {loggingIn.value=false}
}

async function submitPasswordSetup(){
  if(loggingIn.value)return
  if(!/^(?=.*[A-Za-z])(?=.*[0-9]).{8,32}$/.test(newPassword.value))return uni.showToast({title:'密码需8～32位，包含字母和数字',icon:'none'})
  if(newPassword.value!==confirmPassword.value)return uni.showToast({title:'两次输入的密码不一致',icon:'none'})
  loggingIn.value=true
  try{await userStore.completePasswordSetup({setupToken:setupToken.value,password:newPassword.value,confirmation:confirmPassword.value});setupToken.value='';newPassword.value='';confirmPassword.value='';completeWechatLogin()}
  catch(e){if(e?.code===401||e?.code===403||e?.code===409)restartPhoneLogin()}
  finally{loggingIn.value=false}
}
function restartPhoneLogin(){setupToken.value='';newPassword.value='';confirmPassword.value='';loginMode.value='wechat';smsRequestId.value='';verifyCode.value='';loadCaptcha()}
async function handleUserPasswordLogin(){
  if(loggingIn.value)return
  if(!agreed.value)return uni.showToast({title:'请先阅读并同意协议',icon:'none'})
  if(!/^1\d{10}$/.test(phone.value)||!userPassword.value||!captchaCode.value)return uni.showToast({title:'请填写手机号、密码和图形验证码',icon:'none'})
  loggingIn.value=true
  try{await userStore.loginWithPassword({phone:phone.value,password:userPassword.value,captchaId:captchaId.value,captchaCode:captchaCode.value});userPassword.value='';completeWechatLogin()}
  catch(_){await loadCaptcha()}
  finally{loggingIn.value=false}
}

function goPage(url) {
  uni.navigateTo({ url })
}

function switchWechatMode() {
  loginMode.value = 'wechat'
}

function completeWechatLogin() {
  needPhoneAuth.value = false
  clientStorage.set('app_role','user');appStore.restoreRole();chatStore.disconnect()
  chatStore.connect()
  uni.reLaunch({ url: '/pages/index/index' })
}

function toggleAgree() {
  agreed.value = !agreed.value
}
</script>

<style lang="scss" scoped>
.setup-title{display:block;font-size:34rpx;font-weight:700;margin-bottom:20rpx}.setup-hint{display:block;font-size:24rpx;color:#73777e;line-height:1.7;margin:16rpx 0 28rpx}.setup-back{text-align:center;color:#73777e;font-size:25rpx;padding:24rpx}
.verification-row { display:flex; align-items:center; gap:12rpx; margin-bottom:24rpx; .input {flex:1;min-width:0;margin-bottom:0;} }
.captcha-image {width:180rpx;height:70rpx;flex-shrink:0;}
.send-code {padding:0 16rpx;line-height:70rpx;font-size:24rpx;color:#17191c;background:#eceef0;white-space:nowrap;}
.login-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: var(--app-page-height, 100vh);
  background: #f7f8f9;
  padding: 0 60rpx;
  position: relative;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 80rpx;
  position: relative;
  z-index: 1;

  .logo { width: 160rpx; height: 160rpx; margin-bottom: 24rpx; border-radius: 24rpx; }
  .title { font-size: 44rpx; font-weight: bold; color: #17191c; }
  .subtitle { font-size: 26rpx; color: #73777e; margin-top: 12rpx; }
}

.tab-bar {
  display: flex;
  width: 100%;
  margin-bottom: 60rpx;
  border-bottom: 2rpx solid #e6e7e9;
  position: relative;
  z-index: 1;

  .tab-item {
    flex: 1;
    text-align: center;
    font-size: 30rpx;
    color: #73777e;
    padding-bottom: 20rpx;
    position: relative;
    transition: color 0.2s;

    &.active {
      color: #17191c;
      font-weight: bold;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 48rpx;
        height: 4rpx;
        background: linear-gradient(90deg, #17191c, #30343a);
        border-radius: 2rpx;
      }
    }
  }
}

.login-area {
  width: 100%;
  position: relative;
  z-index: 1;

  .input {
    height: 88rpx;
    background: #f7f8f9;
    border: 1rpx solid #e6e7e9;
    border-radius: 12rpx;
    padding: 0 32rpx;
    font-size: 30rpx;
    color: #17191c;
    margin-bottom: 32rpx;
  }

  .login-btn {
    width: 100%;
    height: 88rpx;
    line-height: 88rpx;
    text-align: center;
    color: #ffffff;
    font-size: 32rpx;
    font-weight: bold;
    border-radius: 999rpx;
    border: none;

    &::after { border: none; }
  }

  .wechat-btn {
    background: linear-gradient(135deg, #17191c, #30343a);
    color: #ffffff;
  }

  .wechat-tip {
    margin-top: 20rpx;
    font-size: 24rpx;
    line-height: 1.6;
    color: #73777e;
    text-align: center;
  }

  .account-btn {
    background: linear-gradient(135deg, #17191c, #30343a);
    margin-top: 8rpx;
  }

  .agreement {
    margin-top: 32rpx;
    font-size: 24rpx;
    display: flex;
    justify-content: center;

    .agree-row {
      display: flex;
      align-items: center;
      gap: 8rpx;
    }

    .checkbox {
      width: 32rpx;
      height: 32rpx;
      border-radius: 6rpx;
      border: 2rpx solid rgba(23, 25, 28, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }

    .checkbox.checked {
      background: linear-gradient(135deg, #17191c, #30343a);
      border-color: transparent;
    }

    .check-icon {
      font-size: 22rpx;
      color: #ffffff;
    }

    .text { color: #73777e; }
    .link { color: #17191c; }
  }
}
</style>
