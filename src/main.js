const app = document.getElementById('app')
import('./authority-ui.js').catch(() => { app.textContent='页面加载失败，请刷新重试。'; app.setAttribute('role','alert') })
