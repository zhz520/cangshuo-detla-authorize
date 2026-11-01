<template>
 <scroll-view scroll-y class="homepage-editor">
  <view v-if="loadError" class="editor-card retry" @click="load">加载失败，点击重试</view>
  <template v-else>
   <view class="editor-card"><view class="editor-heading"><text>我的打手主页</text><text class="level-name">{{ levelName }}</text></view><text class="tip">等级分类由管理员设置，下面的资料会展示给用户。</text><text class="field-label">头像</text><ImageUploader v-model="avatarImages" :max="1"/><text class="field-label">昵称</text><input v-model="form.nickname" maxlength="32" placeholder="请输入昵称"/><text class="field-label">主页封面</text><ImageUploader v-model="coverImages" :max="1"/><text class="tip">用于主页顶部和打手卡片，建议上传清晰的个人形象图。</text></view>
   <view class="editor-card"><text class="field-label first">个人简介</text><textarea v-model="form.introduction" maxlength="1000" placeholder="介绍你擅长的游戏和服务特点"/><text class="counter">{{ form.introduction.length }}/1000</text></view>
   <view class="editor-card"><text class="field-label first">一句语音</text><ProfileVoiceUploader v-model="form.voiceUrl" v-model:duration="form.voiceDuration" @busy="voiceBusy=$event"/></view>
   <view class="editor-card"><text class="field-label first">TA的相册</text><text class="tip">最多9张，按上传顺序展示，可点击图片预览。</text><ImageUploader v-model="form.albumImages" :max="9"/></view>
   <view class="editor-card"><text class="field-label first">TA的故事</text><textarea v-model="form.story" maxlength="5000" class="story-input" placeholder="分享你的游戏经历、接单故事和个人风格"/><text class="counter">{{ form.story.length }}/5000</text></view>
   <view class="editor-buttons"><button :disabled="saving||loading||voiceBusy" @click="save(false)">保存主页</button><button class="preview" :disabled="saving||loading||voiceBusy" @click="save(true)">保存并预览</button></view>
  </template><view class="editor-bottom"/>
 </scroll-view>
</template>
<script setup>
import {ref,reactive} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import {getPlayerProfile,updatePlayerHomepage} from '@/api/player'
import ImageUploader from '@/components/ImageUploader.vue'
import ProfileVoiceUploader from '@/components/ProfileVoiceUploader.vue'
import {usePlayerStore} from '@/store/player'
const form=reactive({nickname:'',introduction:'',albumImages:[],story:'',voiceUrl:'',voiceDuration:0})
const avatarImages=ref([]),coverImages=ref([]),levelName=ref(''),loading=ref(true),loadError=ref(false),saving=ref(false),voiceBusy=ref(false)
let playerId,status
onLoad(load)
async function load(){loading.value=true;loadError.value=false;try{const {data}=await getPlayerProfile();playerId=data.id;status=data.status;levelName.value=data.levelName||`Lv.${data.level||1}`;for(const key of Object.keys(form))form[key]=data[key]??(key==='albumImages'?[]:key==='voiceDuration'?0:'');avatarImages.value=data.avatar?[data.avatar]:[];coverImages.value=data.coverImage?[data.coverImage]:[]}catch(_){loadError.value=true}finally{loading.value=false}}
async function save(preview){if(saving.value||loading.value||voiceBusy.value)return;saving.value=true;try{if(!form.nickname.trim())return uni.showToast({title:'请输入昵称',icon:'none'});await updatePlayerHomepage({...form,nickname:form.nickname.trim(),avatar:avatarImages.value[0]||'',coverImage:coverImages.value[0]||''});await usePlayerStore().fetchProfile();if(preview&&status==='ACTIVE')uni.navigateTo({url:`/pages/players/detail?id=${playerId}`});else uni.showToast({title:preview?'已保存，审核通过后主页可见':'主页已保存',icon:'none'})}finally{saving.value=false}}
</script>
<style lang="scss" scoped>
.homepage-editor{height:var(--app-page-height, 100vh);background:#f7f8f9;box-sizing:border-box}.editor-card{margin:24rpx;padding:28rpx;background:#fff;border:1rpx solid #eeeff1;border-radius:20rpx}.editor-heading{display:flex;align-items:center;justify-content:space-between;gap:16rpx;font-size:32rpx;font-weight:700}.level-name{background:#17191c;color:#fff;font-size:22rpx;border-radius:999rpx;padding:8rpx 20rpx}.tip{display:block;color:#858992;font-size:23rpx;line-height:1.7;margin:16rpx 0 22rpx}.field-label{display:block;font-size:28rpx;font-weight:600;margin:28rpx 0 18rpx;&.first{margin-top:0}}input,textarea{width:100%;box-sizing:border-box;background:#f7f8f9;border:1rpx solid #eeeff1;border-radius:12rpx;font-size:27rpx;padding:20rpx;line-height:1.7}input{height:80rpx}textarea{height:240rpx}.story-input{height:400rpx}.counter{display:block;text-align:right;color:#969aa1;font-size:22rpx;margin-top:12rpx}.editor-buttons{display:flex;gap:16rpx;padding:0 24rpx;button{flex:1;border-radius:999rpx;font-size:27rpx;background:#17191c;color:#fff;&.preview{color:#17191c;background:#fff;border:1rpx solid #e6e7e9}}}.retry{text-align:center;color:#858992}.editor-bottom{height:calc(50rpx + var(--app-safe-bottom, env(safe-area-inset-bottom)))}
</style>
