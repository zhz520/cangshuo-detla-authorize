<template>
  <el-container class="layout-container">
    <el-aside v-if="!isCompact" :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <SidebarNavigation :collapsed="isCollapse" :active="activeMenu" :routes="menuRoutes" :title="siteStore.adminTitle" :initial="logoInitial" :logo="siteStore.logo" />
    </el-aside>

    <el-drawer v-model="navigationOpen" direction="ltr" size="300px" :with-header="false" title="主导航" append-to-body class="mobile-navigation">
      <SidebarNavigation :active="activeMenu" :routes="menuRoutes" :title="siteStore.adminTitle" :initial="logoInitial" :logo="siteStore.logo" @select="navigationOpen = false">
        <template #action><button class="navigation-close" type="button" aria-label="关闭导航" @click="navigationOpen = false"><el-icon><Close /></el-icon></button></template>
      </SidebarNavigation>
    </el-drawer>

    <el-container class="layout-body">
      <el-header class="layout-header">
        <div class="header-left">
          <button class="collapse-btn" type="button" :aria-label="isCompact ? '打开导航' : (isCollapse ? '展开导航' : '收起导航')" :aria-expanded="isCompact ? navigationOpen : !isCollapse" @click="toggleNavigation">
            <Fold v-if="!isCompact && !isCollapse" />
            <Expand v-else />
          </button>
          <!-- 面包屑 -->
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="item in breadcrumbs" :key="item.path">
              {{ item.meta?.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <button class="chat-notify" type="button" @click="goChat" title="客服消息" :aria-label="`客服消息，${chatStore.globalUnread || 0}条未读`">
            <el-icon :size="20"><ChatDotRound /></el-icon>
            <span v-if="chatStore.globalUnread > 0" class="notify-badge">{{ chatStore.globalUnread > 99 ? '99+' : chatStore.globalUnread }}</span>
          </button>
          <el-tag :type="role === 'admin' ? 'danger' : 'warning'" size="small" class="role-tag">
            {{ role === 'admin' ? '管理员' : '客服' }}
          </el-tag>
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar v-if="userStore.avatar" :src="userStore.avatar" :size="28" style="margin-right:8px" />
              <span class="user-name" :title="nickname">{{ nickname }}</span> <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">编辑资料</el-dropdown-item>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 编辑资料弹窗 -->
    <ProfileEditDialog v-model="profileDialogVisible" @saved="onProfileSaved" />
  </el-container>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Fold, Expand, ArrowDown, ChatDotRound, Close } from '@element-plus/icons-vue'
import SidebarNavigation from './SidebarNavigation.vue'
import { useResponsive } from '@/utils/responsive'
import { useUserStore } from '@/stores/user'
import ProfileEditDialog from '@/components/ProfileEditDialog.vue'
import { useChatStore } from '@/stores/chat'
import { useSiteStore } from '@/stores/site'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const chatStore = useChatStore()
const siteStore = useSiteStore()

const isCollapse = ref(false)
const navigationOpen = ref(false)
const { isCompact } = useResponsive()
function toggleNavigation() {
  if (isCompact.value) navigationOpen.value = !navigationOpen.value
  else isCollapse.value = !isCollapse.value
}
watch(() => route.fullPath, () => { navigationOpen.value = false })
watch(isCompact, compact => { if (!compact) navigationOpen.value = false })
const nickname = computed(() => userStore.nickname)
const role = computed(() => userStore.role)
const logoInitial = computed(() => {
  const title = siteStore.adminTitle || siteStore.siteName || '护'
  return title.trim().slice(0, 1)
})

const activeMenu = computed(() => route.path)
const breadcrumbs = computed(() => route.matched.filter((r) => r.meta?.title))

// 根据角色过滤路由，生成菜单
const menuRoutes = computed(() => {
  return router.options.routes.filter((r) => {
    if (!r.children) return false
    if (r.path === '/login' || r.path === '/403' || r.path.includes(':pathMatch')) return false
    const roles = r.meta?.roles || r.children?.[0]?.meta?.roles
    return !roles || roles.includes(role.value)
  })
})

const profileDialogVisible = ref(false)

function handleCommand(cmd) {
  if (cmd === 'profile') {
    profileDialogVisible.value = true
  } else if (cmd === 'logout') {
    chatStore.stop()
    userStore.logout()
    router.push('/login')
  }
}

function onProfileSaved(data) {
  userStore.updateProfile(data)
}

function goChat() {
  chatStore.clearUnread()
  router.push('/chat/service')
}

onMounted(() => {
  chatStore.start()
})
onUnmounted(() => {
  chatStore.stop()
})
</script>

<style lang="scss" scoped>
.layout-container {
  height: var(--app-viewport-height);
  min-height: 0;
  background: #f5f6f7;
}
.layout-body { min-width: 0; min-height: 0; }
.layout-aside {
  background: #17191c;
  box-shadow: 1px 0 0 rgba(23, 25, 28, 0.08);
  transition: width 0.24s ease;
  overflow: hidden;
}
.layout-header {
  height: 64px;
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid #eceef0;
  box-shadow: none;
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
    .collapse-btn {
      width: 34px;
      height: 34px;
      border: 1px solid #e6e7e9;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #555b63;
      background: #fff;
      cursor: pointer;
      transition: all 0.18s ease;
      &:hover {
        color: #17191c;
        border-color: #d8dadd;
        background: #f4f5f6;
      }
      svg {
        width: 18px;
        height: 18px;
      }
    }
    :deep(.el-breadcrumb__inner) {
      color: #666b73;
      font-weight: 500;
    }
    :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
      color: #17191c;
      font-weight: 700;
    }
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    .chat-notify {
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border: 1px solid #e6e7e9;
      border-radius: 8px;
      background: #fff;
      transition: background 0.2s;
      color: #555b63;
      &:hover {
        background: #f4f5f6;
        color: #17191c;
      }
      .notify-badge {
        position: absolute;
        top: -4px;
        right: -8px;
        min-width: 16px;
        height: 16px;
        line-height: 16px;
        padding: 0 4px;
        font-size: 10px;
        color: #fff;
        background: #c94f59;
        border-radius: 10px;
        text-align: center;
      }
    }
    .role-tag {
      margin-right: 4px;
      color: #555b63;
      border-color: #e6e7e9;
      background: #f5f6f7;
    }
    .user-info {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 10px 0 6px;
      border-radius: 999px;
      color: #17191c;
      background: #f7f8f9;
      border: 1px solid #e6e7e9;
    }
  }
}
.layout-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(245, 246, 247, 0.82) 0%, rgba(245, 246, 247, 0) 210px),
    #f5f6f7;
  padding: 22px 24px 28px;
}
.user-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.navigation-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  color: #f7f8f9;
  background: transparent;
  border: 1px solid #555b63;
  border-radius: 8px;
  cursor: pointer;
}
@media (max-width: 1024px) {
  .layout-header {
    height: auto;
    min-height: calc(56px + var(--app-safe-top));
    padding: calc(6px + var(--app-safe-top)) calc(12px + var(--app-safe-right)) 6px calc(12px + var(--app-safe-left));
    gap: 8px;
  }
  .layout-header .header-left { min-width: 0; gap: 10px; flex: 1; }
  .header-left :deep(.el-breadcrumb) { min-width: 0; font-size: 13px; line-height: 1.5; }
  .header-left :deep(.el-breadcrumb__item) { float: none; display: inline; overflow-wrap: anywhere; }
  .layout-header .header-left .collapse-btn { width: 40px; height: 40px; flex-shrink: 0; }
  .layout-header .header-right { min-width: 0; gap: 6px; }
  .header-right :deep(.el-dropdown) { min-width: 0; max-width: calc(100% - 104px); }
  .layout-header .header-right .chat-notify { width: 38px; height: 38px; flex-shrink: 0; }
  .layout-header .header-right .role-tag { margin-right: 0; }
  .layout-header .header-right .user-info { min-height: 38px; max-width: 150px; padding: 0 6px; }
  .layout-header .header-right .user-info { min-width: 0; }
  .user-info :deep(.el-avatar), .user-info :deep(.el-icon) { flex-shrink: 0; }
  .layout-main {
    padding: 12px calc(12px + var(--app-safe-right)) calc(12px + var(--app-safe-bottom)) calc(12px + var(--app-safe-left));
  }
}
@media (max-width: 480px) {
  .layout-header { flex-wrap: wrap; }
  .layout-header .header-left { flex-basis: 100%; }
  .layout-header .header-right { width: 100%; justify-content: flex-end; }
  .layout-header .header-right .user-info { max-width: 220px; }
}
@media (max-width: 1024px) and (max-height: 500px) {
  .layout-header { flex-wrap: nowrap; min-height: 48px; }
  .layout-header .header-left { flex-basis: auto; }
  .layout-header .header-right { width: auto; }
  .layout-main { padding-top: 8px; padding-bottom: calc(8px + var(--app-safe-bottom)); }
}
</style>
