<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>管理员管理</span>
          <el-button type="primary" @click="openDialog()">新增管理员</el-button>
        </div>
      </template>
      <el-form :inline="true" :model="query" class="search-form">
        <el-form-item label="搜索">
          <el-input v-model="query.username" placeholder="用户名" clearable @keyup.enter="fetchData" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchData">查询</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
        <el-table-column prop="nickname" label="昵称" />
        <el-table-column prop="role" label="角色">
          <template #default="{ row }">
            <el-tag :type="isAdminRole(row.role) ? 'danger' : 'warning'" size="small">{{ roleLabel(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" />
        <el-table-column prop="status" label="状态">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" width="170">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" :fixed="isCompact ? false : 'right'">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
            <el-popconfirm title="确认删除该管理员？" @confirm="handleDelete(row.id)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <Pagination :total="total" v-model:page="query.pageNum" v-model:limit="query.pageSize" @pagination="fetchData" />
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑管理员' : '新增管理员'" width="500px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-form-item label="用户名" prop="username"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password maxlength="32" :placeholder="editingId ? '留空则不修改，填写须为8～32位' : '请输入8～32位密码，包含字母和数字'" />
        </el-form-item>
        <el-form-item><span class="password-tip">管理员和客服密码均为8～32位，须同时包含字母和数字。</span></el-form-item>
        <el-form-item label="昵称" prop="nickname"><el-input v-model="form.nickname" /></el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role">
            <el-option label="管理员" value="ADMIN" />
            <el-option label="客服" value="CS" />
            <el-option v-if="form.role === 'BOTH'" label="管理员兼客服（旧版）" value="BOTH" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { useResponsive } from '@/utils/responsive'
import { ref, reactive, onMounted } from 'vue'
import { getAdminList, addAdmin, updateAdmin, deleteAdmin } from '@/api/system'
import { formatDateTime } from '@/utils'
import { ElMessage } from 'element-plus'
import Pagination from '@/components/Pagination.vue'

const { isCompact } = useResponsive()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ pageNum: 1, pageSize: 10, username: '' })

async function fetchData() {
  loading.value = true
  try {
    const res = await getAdminList(query)
    list.value = res.data.records
    total.value = Number(res.data.total)
  } finally { loading.value = false }
}

const dialogVisible = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const formRef = ref(null)
const form = reactive({ username: '', password: '', nickname: '', role: 'CS', phone: '', status: 1 })
const formRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ validator: (rule, value, callback) => {
    if (!value && editingId.value) return callback()
    if (!value) return callback(new Error('请输入密码'))
    if (!/^(?=.*[A-Za-z])(?=.*[0-9]).{8,32}$/.test(value)) return callback(new Error('密码须8～32位，包含字母和数字'))
    callback()
  }, trigger: 'blur' }],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

function openDialog(row) {
  editingId.value = row?.id || null
  Object.assign(form, row ? {
    username: row.username || '', password: '', nickname: row.nickname || '',
    role: normalizeRole(row.role), phone: row.phone || '', status: row.status ?? 1
  } : { username: '', password: '', nickname: '', role: 'CS', phone: '', status: 1 })
  dialogVisible.value = true
}

function normalizeRole(role) {
  const value = String(role || '').trim().toUpperCase()
  return ['ADMIN', 'CS', 'BOTH'].includes(value) ? value : 'CS'
}

function isAdminRole(role) {
  return ['ADMIN', 'BOTH'].includes(normalizeRole(role))
}

function roleLabel(role) {
  return isAdminRole(role) ? '管理员' : '客服'
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      const data = {
        id: editingId.value, username: form.username.trim(), nickname: form.nickname.trim(),
        role: normalizeRole(form.role), phone: form.phone.trim(), status: form.status
      }
      if (form.password) data.password = form.password
      await updateAdmin(data)
    } else {
      await addAdmin({
        username: form.username.trim(), password: form.password, nickname: form.nickname.trim(),
        role: normalizeRole(form.role), phone: form.phone.trim(), status: form.status
      })
    }
    ElMessage.success(editingId.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    fetchData()
  } finally { submitting.value = false }
}

async function handleDelete(id) {
  await deleteAdmin(id)
  ElMessage.success('删除成功')
  fetchData()
}

onMounted(fetchData)
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
.search-form { margin-bottom: 16px; }
.password-tip { font-size: 12px; color: #858992; line-height: 1.7; }
</style>
