import { createApp, defineComponent, h } from 'vue'
import { ElMessage, ElRow, ElCol, ElAlert, ElButton, ElCard, ElCheckbox, ElCheckboxGroup, ElDatePicker, ElDialog, ElDrawer, ElForm, ElFormItem, ElInput, ElInputNumber, ElLoading, ElOption, ElPagination, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTabs, ElTabPane, ElTag, ElUpload, ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/es/components/alert/style/css.mjs'
import 'element-plus/es/components/row/style/css.mjs'
import 'element-plus/es/components/col/style/css.mjs'
import 'element-plus/es/components/button/style/css.mjs'
import 'element-plus/es/components/card/style/css.mjs'
import 'element-plus/es/components/checkbox/style/css.mjs'
import 'element-plus/es/components/checkbox-group/style/css.mjs'
import 'element-plus/es/components/date-picker/style/css.mjs'
import 'element-plus/es/components/dialog/style/css.mjs'
import 'element-plus/es/components/drawer/style/css.mjs'
import 'element-plus/es/components/form/style/css.mjs'
import 'element-plus/es/components/form-item/style/css.mjs'
import 'element-plus/es/components/input/style/css.mjs'
import 'element-plus/es/components/input-number/style/css.mjs'
import 'element-plus/es/components/loading/style/css.mjs'
import 'element-plus/es/components/message/style/css.mjs'
import 'element-plus/es/components/message-box/style/css.mjs'
import 'element-plus/es/components/option/style/css.mjs'
import 'element-plus/es/components/pagination/style/css.mjs'
import 'element-plus/es/components/select/style/css.mjs'
import 'element-plus/es/components/switch/style/css.mjs'
import 'element-plus/es/components/table/style/css.mjs'
import 'element-plus/es/components/table-column/style/css.mjs'
import 'element-plus/es/components/tabs/style/css.mjs'
import 'element-plus/es/components/tab-pane/style/css.mjs'
import 'element-plus/es/components/tag/style/css.mjs'
import 'element-plus/es/components/upload/style/css.mjs'
import App from './App.vue'
import './style.css'
import './styles/redesign.css'
const messageSeen = new Map()
const messageDurations = { success: 3000, info: 4000, warning: 5000, error: 6000 }
for (const type of Object.keys(messageDurations)) {
  const original = ElMessage[type]
  if (typeof original !== 'function') continue
  ElMessage[type] = (message, options = {}) => {
    const payload = message && typeof message === 'object' && !Array.isArray(message) ? { ...message } : { message }
    const text = String(payload.message || '')
    const key = type + ':' + text
    const now = Date.now()
    if (messageSeen.get(key) > now - 1200) return
    messageSeen.set(key, now)
    if (messageSeen.size > 80) messageSeen.delete(messageSeen.keys().next().value)
    return original({ ...payload, ...(options && typeof options === 'object' ? options : {}), showClose: true, duration: payload.duration ?? messageDurations[type] })
  }
}
const app = createApp({ render: () => h(ElConfigProvider, { locale: zhCn }, () => h(App)) })
const appendOverlayToBody = (component, name) => defineComponent({
  name,
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h(component, { ...attrs, appendToBody: attrs.appendToBody ?? true }, slots)
  }
})
const Dialog = appendOverlayToBody(ElDialog, 'ElDialog')
const Drawer = appendOverlayToBody(ElDrawer, 'ElDrawer')
for (const component of [ElRow, ElCol, ElAlert, ElButton, ElCard, ElCheckbox, ElCheckboxGroup, ElDatePicker, Dialog, Drawer, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElPagination, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTabs, ElTabPane, ElTag, ElUpload]) app.component(component.name, component)
app.use(ElLoading).mount('#app')
