<template>
  <div class="page-container">
    <el-card>
      <template #header><div class="card-header"><span>轮播图管理</span><el-button type="primary" @click="openDialog()">新增</el-button></div></template>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="图片" width="120"><template #default="{ row }"><el-image lazy :src="row.imageUrl" style="width:80px;height:60px" fit="contain" :preview-src-list="[row.imageUrl]" preview-teleported /></template></el-table-column>
        <el-table-column label="点击行为"><template #default="{ row }">{{ !row.linkValue || row.linkType === 'none' ? '放大图片' : row.linkType === 'product' ? '跳转商品' : '跳转链接' }}</template></el-table-column>
        <el-table-column prop="linkValue" label="跳转地址 / 商品ID" show-overflow-tooltip />
        <el-table-column prop="sortOrder" label="排序" width="80" />
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '显示' : '隐藏' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
            <el-popconfirm title="确认删除？" @confirm="handleDelete(row.id)"><template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <Pagination :total="total" v-model:page="query.pageNum" v-model:limit="query.pageSize" @pagination="fetchData" />
    </el-card>
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑' : '新增'" width="500px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="图片" prop="imageUrl"><ImageUpload v-model="form.imageUrl" /></el-form-item>
        <el-form-item label="点击行为"><el-select v-model="form.linkType"><el-option label="放大图片" value="none" /><el-option label="跳转链接" value="url" /><el-option label="跳转商品" value="product" /></el-select></el-form-item>
        <el-form-item v-if="form.linkType !== 'none'" :label="form.linkType === 'product' ? '商品ID' : '链接'" prop="linkValue"><el-input v-model="form.linkValue" :placeholder="form.linkType === 'product' ? '填写商品ID' : 'https://网址 或 /pages/站内页面路径'" /><div class="link-tip">不填写跳转地址时，点击轮播图会放大图片。</div></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sortOrder" :min="0" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" :active-value="1" :inactive-value="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getBannerList, addBanner, updateBanner, deleteBanner } from '@/api/system'
import { ElMessage } from 'element-plus'
import Pagination from '@/components/Pagination.vue'
import ImageUpload from '@/components/ImageUpload.vue'
const loading = ref(false), list = ref([]), total = ref(0)
const query = reactive({ pageNum: 1, pageSize: 10 })
const rules = { imageUrl: [{ required: true, message: '请上传图片', trigger: 'change' }], linkValue: [{ validator: (_rule, value, done) => {
  const link = String(value || '').trim()
  if (!link || form.linkType === 'none') return done()
  if (form.linkType === 'product') return /^\d+$/.test(link) ? done() : done(new Error('请填写数字商品ID'))
  if (/^\/pages(?:-player|-cs)?\/[\w/-]+(?:\?[^\s]*)?$/.test(link)) return done()
  try { const url = new URL(link); if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return done() } catch {}
  done(new Error('请填写有效的 http/https 链接或站内页面路径'))
}, trigger: 'blur' }] }
async function fetchData() { loading.value = true; try { const res = await getBannerList(query); list.value = res.data.records; total.value = Number(res.data.total) } finally { loading.value = false } }
const dialogVisible = ref(false), editingId = ref(null), submitting = ref(false), formRef = ref(null)
const defaultForm = { imageUrl: '', linkType: 'none', linkValue: '', sortOrder: 0, status: 1 }
const form = reactive({ ...defaultForm })
function openDialog(row) { editingId.value = row?.id || null; Object.assign(form, defaultForm, row || {}); if (!form.linkType) form.linkType = form.linkValue ? 'url' : 'none'; dialogVisible.value = true }
async function handleSubmit() { const valid = await formRef.value.validate().catch(() => false); if (!valid) return; submitting.value = true; try { const payload = { ...form, linkValue: form.linkType === 'none' ? '' : String(form.linkValue || '').trim() }; editingId.value ? await updateBanner({ ...payload, id: editingId.value }) : await addBanner(payload); ElMessage.success('操作成功'); dialogVisible.value = false; fetchData() } finally { submitting.value = false } }
async function handleDelete(id) { await deleteBanner(id); ElMessage.success('删除成功'); fetchData() }
onMounted(fetchData)
</script>
<style scoped>.card-header { display: flex; justify-content: space-between; align-items: center; }.link-tip { font-size: 12px; color: #73777e; line-height: 1.6; margin-top: 6px; }</style>
