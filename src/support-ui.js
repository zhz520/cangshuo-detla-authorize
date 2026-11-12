import { createApp } from 'vue'
import SupportChat from './SupportChat.vue'
export function mountSupport(slug,agent) {
  document.documentElement.classList.add('support-viewport')
  document.body.classList.add('support-body')
  createApp(SupportChat,{ slug,agent }).mount('#app')
}
