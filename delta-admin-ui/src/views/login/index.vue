<template>
  <div class="login-container">
    <canvas ref="canvasRef" class="particle-canvas" />
    <div class="login-box">
      <img :src="siteStore.logo" :alt="siteStore.siteName" style="display:block;width:88px;height:88px;object-fit:cover;border-radius:14px;margin:0 auto 20px" />
      <h2 class="login-title">{{ siteStore.siteName }}</h2>
      <p class="login-subtitle">管理员与客服统一登录</p>
      <el-form ref="formRef" :model="form" :rules="rules" size="large">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" prefix-icon="Lock" show-password @keyup.enter="handleLogin" />
        </el-form-item>
        <el-form-item>
          <el-button class="login-btn" :loading="loading" @click="handleLogin">登 录</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useSiteStore } from '@/stores/site'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const siteStore = useSiteStore()

const formRef = ref(null)
const loading = ref(false)
const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  if (loading.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await userStore.login(form)
    ElMessage.success('登录成功')
    const redirect = route.query.redirect || '/'
    router.push(redirect)
  } catch (e) {
    // error handled by request interceptor
  } finally {
    loading.value = false
  }
}

/* ---- 金色粒子动画 ---- */
const canvasRef = ref(null)
let animId = 0
let resizeCanvas
class Particle {
  constructor(w, h) { this.reset(w, h, true) }
  reset(w, h, init = false) {
    this.x = Math.random() * w
    this.y = init ? Math.random() * h : h + 10
    this.r = Math.random() * 2 + 0.5
    this.vx = (Math.random() - 0.5) * 0.6
    this.vy = -(Math.random() * 0.8 + 0.3)
    this.life = 1
    this.decay = Math.random() * 0.006 + 0.002
    const gold = [212, 175, 55]
    const bright = [201, 164, 74]
    const t = Math.random()
    this.r_ = Math.round(gold[0] * t + bright[0] * (1 - t))
    this.g_ = Math.round(gold[1] * t + bright[1] * (1 - t))
    this.b_ = Math.round(gold[2] * t + bright[2] * (1 - t))
  }
  update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay }
  draw(ctx) {
    ctx.globalAlpha = this.life * 0.8
    ctx.fillStyle = `rgb(${this.r_},${this.g_},${this.b_})`
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill()
  }
}
onMounted(() => {
  const canvas = canvasRef.value; if (!canvas) return
  const ctx = canvas.getContext('2d')
  let w, h, particles = []
  resizeCanvas = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight }
  resizeCanvas(); window.addEventListener('resize', resizeCanvas)
  for (let i = 0; i < 120; i++) particles.push(new Particle(w, h))
  function loop() {
    ctx.clearRect(0, 0, w, h)
    for (const p of particles) {
      p.update(); p.draw(ctx)
      if (p.life <= 0) p.reset(w, h)
    }
    animId = requestAnimationFrame(loop)
  }
  loop()
})
onUnmounted(() => { cancelAnimationFrame(animId); window.removeEventListener('resize', resizeCanvas) })
</script>

<style lang="scss" scoped>
.login-container {
  width: 100%;
  min-height: var(--app-viewport-height);
  padding: calc(24px + var(--app-safe-top)) calc(16px + var(--app-safe-right)) calc(24px + var(--app-safe-bottom)) calc(16px + var(--app-safe-left));
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 20%, #ffffff 0%, #f5f6f7 62%, #eceef0 100%);
  position: relative;
  overflow: auto;
}
.particle-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  opacity: 0.06;
  filter: grayscale(1);
}
.login-box {
  position: relative;
  z-index: 1;
  width: 420px;
  max-width: 100%;
  flex-shrink: 0;
  padding: 44px 40px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e6e7e9;
  border-radius: 16px;
  box-shadow: 0 16px 56px rgba(23, 25, 28, 0.06);
  backdrop-filter: blur(12px);
}
.login-title {
  text-align: center;
  font-size: 26px;
  font-weight: 800;
  color: #17191c;
  margin-bottom: 4px;
  letter-spacing: 2px;
}
.login-subtitle {
  text-align: center;
  color: #73777e;
  margin-bottom: 32px;
  font-size: 14px;
}
.login-btn {
  width: 100%;
  background: #17191c;
  border: none;
  color: #ffffff;
  font-weight: bold;
  font-size: 16px;
  letter-spacing: 4px;
  border-radius: 999px;
  &:hover { background: #30343a; color: #ffffff; }
}
:deep(.el-input__wrapper) {
  background: #fafafb;
  border: 1px solid #e6e7e9;
  box-shadow: none !important;
  &:hover { border-color: #b9bdc4; }
  &.is-focus { border-color: #17191c; }
}
:deep(.el-input__inner) {
  color: #17191c;
  &::placeholder { color: #73777e; }
}
:deep(.el-input__prefix .el-icon) { color: #73777e; }
:deep(.el-form-item__error) { color: #c94f59; }
@media (max-width: 480px) {
  .login-box { padding: 28px 22px; }
  .login-title { font-size: 24px; overflow-wrap: anywhere; word-break: break-word; }
}
@media (max-height: 500px) {
  .login-container { padding-top: calc(12px + var(--app-safe-top)); padding-bottom: calc(12px + var(--app-safe-bottom)); }
  .login-box { padding-top: 20px; padding-bottom: 20px; }
  .login-subtitle { margin-bottom: 16px; }
}
</style>
