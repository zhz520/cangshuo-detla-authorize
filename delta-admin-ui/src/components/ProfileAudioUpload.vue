<template><div class="audio-editor"><audio v-if="modelValue" :src="modelValue" controls preload="metadata"/><div class="buttons"><el-button :loading="loading" @click="fileInput.click()">上传一句语音</el-button><el-button v-if="modelValue" @click="remove">删除语音</el-button><span class="tip">最多60秒、10MB</span></div><input ref="fileInput" type="file" accept=".mp3,.m4a,.wav,.aac,.ogg,.webm" hidden @change="choose"/></div></template>
<script setup>
import {ref,onUnmounted} from 'vue'
import {ElMessage} from 'element-plus'
import {uploadProfileAudio} from '@/api/business'
defineProps({modelValue:{type:String,default:''},duration:{type:Number,default:0}})
const emit=defineEmits(['update:modelValue','update:duration','busy'])
const fileInput=ref(),loading=ref(false)
let disposed=false
onUnmounted(()=>disposed=true)
function remove(){emit('update:modelValue','');emit('update:duration',0)}
function getDuration(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),audio=new Audio();const timer=setTimeout(()=>{URL.revokeObjectURL(url);reject(new Error('读取音频超时'))},10000);const clean=()=>{clearTimeout(timer);URL.revokeObjectURL(url)};audio.onloadedmetadata=()=>{const d=Math.ceil(audio.duration);clean();resolve(d)};audio.onerror=()=>{clean();reject(new Error('无法读取音频，请更换文件'))};audio.src=url})}
async function choose(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>10*1024*1024)return ElMessage.error('语音文件不能超过10MB');loading.value=true;emit('busy',true);try{const duration=await getDuration(file);if(!Number.isFinite(duration)||duration<1||duration>60)throw new Error('请选择1至60秒的音频');const {data}=await uploadProfileAudio(file);if(!disposed){emit('update:modelValue',data);emit('update:duration',duration);ElMessage.success('语音已上传')}}catch(error){ElMessage.error(error.message||'上传失败')}finally{loading.value=false;emit('busy',false)}}
</script>
<style scoped>.audio-editor{width:100%}audio{display:block;width:100%;max-width:400px;margin-bottom:12px}.buttons{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.tip{font-size:12px;color:#969aa1}</style>
