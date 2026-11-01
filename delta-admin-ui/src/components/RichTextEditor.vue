<template>
  <div class="rich-text-editor">
    <div class="toolbar" @mousedown="saveSelection">
      <template v-if="mode === 'visual'">
        <label class="toolbar-field">字号
          <select aria-label="字号" :value="fontSize" @change="setFontSize($event.target.value)">
            <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</option>
          </select>
        </label>
        <label class="toolbar-field">文字颜色<input type="color" aria-label="文字颜色" :value="textColor" @input="setColor('foreColor', $event.target.value)" /></label>
        <label class="toolbar-field">底色<input type="color" aria-label="文字底色" :value="backgroundColor" @input="setColor('hiliteColor', $event.target.value)" /></label>
        <el-button-group>
          <el-button size="small" title="加粗" @mousedown.prevent @click="exec('bold')"><strong>B</strong></el-button>
          <el-button size="small" title="斜体" @mousedown.prevent @click="exec('italic')"><em>I</em></el-button>
          <el-button size="small" title="下划线" @mousedown.prevent @click="exec('underline')"><u>U</u></el-button>
          <el-button size="small" title="删除线" @mousedown.prevent @click="exec('strikeThrough')"><s>S</s></el-button>
        </el-button-group>
        <el-button-group>
          <el-button size="small" @mousedown.prevent @click="exec('formatBlock', 'h2')">标题</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('formatBlock', 'p')">正文</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('justifyLeft')">居左</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('justifyCenter')">居中</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('justifyRight')">居右</el-button>
        </el-button-group>
        <el-button-group>
          <el-button size="small" @mousedown.prevent @click="exec('insertUnorderedList')">● 列表</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('insertOrderedList')">1. 列表</el-button>
          <el-button size="small" @mousedown.prevent @click="insertLink">链接</el-button>
          <el-button size="small" :loading="uploading" @mousedown.prevent @click="insertImage">图片</el-button>
          <el-button size="small" @mousedown.prevent @click="exec('removeFormat')">清除格式</el-button>
        </el-button-group>
      </template>
      <el-button-group>
        <el-button size="small" :type="mode === 'visual' ? 'primary' : ''" @click="setMode('visual')">可视化</el-button>
        <el-button size="small" :type="mode === 'source' ? 'primary' : ''" @click="setMode('source')">源代码</el-button>
      </el-button-group>
    </div>
    <div v-show="mode === 'visual'" ref="editorRef" class="editor-content" contenteditable="true" role="textbox" aria-label="公告内容" aria-multiline="true"
      @input="onInput" @blur="onInput" @keyup="saveSelection" @mouseup="saveSelection" @touchend="saveSelection" @paste="paste" />
    <el-input v-show="mode === 'source'" v-model="source" type="textarea" :rows="rows" @input="publishSource" />
  </div>
</template>
<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadFile } from '@/api/business'
import { sanitizeRichText } from '@/utils/rich-text'
const props = defineProps({ modelValue: { type: String, default: '' }, rows: { type: Number, default: 10 } })
const emit = defineEmits(['update:modelValue'])
const editorRef = ref(null), mode = ref('visual'), source = ref(props.modelValue), uploading = ref(false)
const fontSizes = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48]
const fontSize = ref(16), textColor = ref('#17191c'), backgroundColor = ref('#ffffff')
let savedRange, lastEmitted
function publish(html) { lastEmitted = sanitizeRichText(html); emit('update:modelValue', lastEmitted) }
watch(() => props.modelValue, value => {
  if (value === lastEmitted) return
  source.value = value
  if (editorRef.value) editorRef.value.innerHTML = sanitizeRichText(value)
})
function saveSelection() {
  const selection = window.getSelection()
  if (selection?.rangeCount && editorRef.value?.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange()
}
function restoreSelection() {
  editorRef.value?.focus()
  const selection = window.getSelection()
  if (savedRange && editorRef.value?.contains(savedRange.commonAncestorContainer)) { selection.removeAllRanges(); selection.addRange(savedRange) }
}
function onInput() { if (editorRef.value) { saveSelection(); publish(editorRef.value.innerHTML) } }
function exec(command, value) { restoreSelection(); document.execCommand(command, false, value ?? null); onInput() }
function setFontSize(value) {
  fontSize.value = Number(value)
  restoreSelection()
  document.execCommand('styleWithCSS', false, false)
  document.execCommand('fontSize', false, '7')
  editorRef.value.querySelectorAll('font[size="7"]').forEach(element => { element.removeAttribute('size'); element.style.fontSize = `${fontSize.value}px` })
  onInput()
}
function setColor(command, value) {
  if (command === 'foreColor') textColor.value = value; else backgroundColor.value = value
  restoreSelection()
  document.execCommand('styleWithCSS', false, true)
  document.execCommand(command, false, value)
  onInput()
}
function publishSource() { publish(source.value) }
async function setMode(value) {
  if (mode.value === value) return
  if (value === 'source') source.value = sanitizeRichText(editorRef.value.innerHTML)
  mode.value = value
  await nextTick()
  if (value === 'visual') { editorRef.value.innerHTML = sanitizeRichText(source.value); savedRange = null; onInput() }
}
function paste(event) {
  event.preventDefault()
  const clipboard = event.clipboardData, html = clipboard?.getData('text/html')
  if (html) exec('insertHTML', sanitizeRichText(html))
  else exec('insertText', clipboard?.getData('text/plain') || '')
}
function insertLink() {
  const value = prompt('请输入链接地址', 'https://')
  if (!value) return
  if (!/^https?:\/\/[^\s]+$/i.test(value.trim())) { ElMessage.warning('请填写 http 或 https 链接'); return }
  exec('createLink', value.trim())
}
async function insertImage() {
  saveSelection()
  const input = document.createElement('input')
  input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif'
  input.onchange = async event => {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { ElMessage.warning('图片须在10MB以内'); return }
    uploading.value = true
    try {
      const res = await uploadFile(file), url = res.data
      if (typeof url !== 'string' || !/^(?:https?:\/\/|\/file\/)/i.test(url)) throw new Error('无效的图片地址')
      exec('insertImage', url)
    } catch { ElMessage.error('图片上传失败，请重试') }
    finally { uploading.value = false }
  }
  input.click()
}
onMounted(() => { editorRef.value.innerHTML = sanitizeRichText(props.modelValue); document.addEventListener('selectionchange', saveSelection) })
onBeforeUnmount(() => document.removeEventListener('selectionchange', saveSelection))
</script>
<style scoped>
.rich-text-editor { min-width: 0; width: 100%; border: 1px solid #e1e3e6; border-radius: 6px; overflow: hidden; }
.toolbar { padding: 8px; background: #f5f6f7; border-bottom: 1px solid #e1e3e6; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; line-height: 1.5; }
.toolbar-field { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #555b63; white-space: nowrap; }
.toolbar-field select { height: 28px; border: 1px solid #d4d6da; border-radius: 4px; background: #fff; color: #17191c; }
.toolbar-field input[type=color] { width: 30px; height: 28px; padding: 2px; border: 1px solid #d4d6da; background: #fff; border-radius: 4px; cursor: pointer; }
.editor-content { min-height: 240px; padding: 12px 16px; outline: none; font-size: 16px; line-height: 1.6; overflow: auto; max-height: 500px; overflow-wrap: anywhere; color: #17191c; background: #fff; }
.editor-content :deep(img) { max-width: 100%; height: auto; }
.editor-content :deep(a) { text-decoration: underline; }
.editor-content :deep(ul), .editor-content :deep(ol) { padding-left: 24px; }
.editor-content :deep(table) { display: block; max-width: 100%; overflow-x: auto; }
@media (max-width: 768px) { .toolbar { gap: 6px; padding: 6px; } .toolbar .el-button { min-height: 32px; padding: 5px 9px; } .editor-content { padding: 10px; } }
</style>
