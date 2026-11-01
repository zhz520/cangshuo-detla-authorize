<template>
  <nav class="admin-navigation" aria-label="主导航">
    <div class="logo">
      <div class="logo-mark"><img v-if="logo" :src="logo" :alt="title" style="width:100%;height:100%;object-fit:cover;border-radius:10px" /><span v-else>{{ initial }}</span></div>
      <h1 v-if="!collapsed" :title="title">{{ title }}</h1>
      <slot name="action" />
    </div>
    <el-menu :default-active="active" :collapse="collapsed" router class="layout-menu" @select="$emit('select')">
      <template v-for="route in routes" :key="route.path">
        <el-menu-item v-if="route.children?.length === 1 && !route.children[0].children" :index="resolvePath(route.path, route.children[0].path)">
          <el-icon><component :is="route.children[0].meta?.icon || route.meta?.icon" /></el-icon>
          <template #title>{{ route.children[0].meta?.title }}</template>
        </el-menu-item>
        <el-sub-menu v-else :index="route.path">
          <template #title>
            <el-icon><component :is="route.meta?.icon" /></el-icon>
            <span>{{ route.meta?.title }}</span>
          </template>
          <el-menu-item v-for="child in visibleChildren(route.children)" :key="child.path" :index="resolvePath(route.path, child.path)">
            {{ child.meta?.title }}
          </el-menu-item>
        </el-sub-menu>
      </template>
    </el-menu>
  </nav>
</template>

<script setup>
defineProps({
  collapsed: Boolean,
  active: String,
  routes: { type: Array, default: () => [] },
  title: String,
  logo: String,
  initial: String
})
defineEmits(['select'])
function resolvePath(parent, child) { return child ? (parent + '/' + child).replace(/\/+/g, '/') : parent }
function visibleChildren(children) { return (children || []).filter(child => !child.meta?.hidden) }
</script>

<style lang="scss" scoped>
.admin-navigation {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #17191c;
}
.logo {
  flex-shrink: 0;
  min-height: 64px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #f7f8f9;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #17191c;
  font-size: 17px;
  font-weight: 800;
  background: linear-gradient(135deg, #ffffff, #eceef0);
}
h1 {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.2;
  font-weight: 700;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layout-menu {
  flex: 1;
  min-height: 0;
  border-right: none;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 10px calc(18px + var(--app-safe-bottom));
  background: transparent;
  :deep(.el-menu) { background: transparent; }
  :deep(.el-menu-item), :deep(.el-sub-menu__title) {
    height: 42px;
    margin: 4px 0;
    border-radius: 9px;
    color: #b8bbc1;
    transition: background 0.18s ease, color 0.18s ease;
  }
  :deep(.el-menu-item:hover), :deep(.el-sub-menu__title:hover) { color: #fff; background: rgba(255, 255, 255, 0.08); }
  :deep(.el-menu-item.is-active) {
    color: #17191c;
    font-weight: 700;
    background: linear-gradient(135deg, #fff, #eceef0);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  :deep(.el-sub-menu .el-menu-item) { padding-left: 42px !important; }
}
@media (max-width: 1024px) {
  .logo { padding-top: calc(12px + var(--app-safe-top)); }
  .layout-menu :deep(.el-menu-item), .layout-menu :deep(.el-sub-menu__title) { min-height: 44px; }
}
</style>
