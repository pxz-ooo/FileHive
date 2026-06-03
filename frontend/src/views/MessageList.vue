<template>
  <div>
    <!-- 筛选栏 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="分类">
          <el-select v-model="filters.category" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="消息类型">
          <el-select v-model="filters.msg_type" placeholder="全部" clearable style="width: 120px">
            <el-option v-for="t in msgTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadMessages">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 结果列表 -->
    <el-card shadow="never">
      <div v-if="loading" style="text-align: center; padding: 60px">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      </div>
      <div v-else-if="items.length === 0" style="text-align: center; padding: 60px; color: #999">
        暂无消息
      </div>
      <div v-else>
        <div v-for="item in items" :key="item.message.msgid" style="margin-bottom: 8px">
          <el-card
            shadow="hover"
            :body-style="{ padding: '14px 20px' }"
            style="cursor: pointer"
            @click="$router.push(`/messages/${item.message.msgid}`)"
          >
            <div style="display: flex; align-items: center; gap: 12px">
              <!-- 类型图标 -->
              <el-tag :type="typeTag(item.message.msg_type)" size="small" effect="dark" style="min-width: 48px; text-align: center">
                {{ typeLabel(item.message.msg_type) }}
              </el-tag>

              <!-- 分类标签 -->
              <el-tag v-if="item.analysis" size="small" type="warning" effect="plain">
                {{ item.analysis.category }}
              </el-tag>

              <!-- AI 摘要 -->
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px">
                {{ item.analysis ? item.analysis.summary : '等待分析...' }}
              </span>

              <!-- 时间 -->
              <span style="color: #999; font-size: 12px; white-space: nowrap">
                {{ formatTime(item.message.send_time) }}
              </span>

              <el-icon><ArrowRight /></el-icon>
            </div>
          </el-card>
        </div>

        <!-- 分页 -->
        <div style="text-align: center; margin-top: 16px" v-if="total > limit">
          <el-pagination
            v-model:current-page="page"
            :page-size="limit"
            :total="total"
            layout="prev, pager, next"
            @current-change="onPageChange"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { fetchMessages } from '../api/index.js'
import { useRouter } from 'vue-router'

const router = useRouter()

const categories = ['工作文档', '技术资料', '学习笔记', '生活记录', '金融财务', '社交人脉', '待办事项', '消费购物', '娱乐休闲', '其他']
const msgTypes = [
  { label: '文本', value: 'text' },
  { label: '语音', value: 'voice' },
  { label: '视频', value: 'video' },
  { label: '链接', value: 'link' },
  { label: '图片', value: 'image' },
  { label: '文件', value: 'file' },
  { label: '位置', value: 'location' },
  { label: '小程序', value: 'miniprogram' },
]

const filters = ref({ category: '', msg_type: '' })
const items = ref([])
const loading = ref(true)
const total = ref(0)
const page = ref(1)
const limit = 50

function typeLabel(type) {
  const map = { text: '文本', voice: '语音', video: '视频', link: '链接', image: '图片', file: '文件', location: '位置', miniprogram: '小程序' }
  return map[type] || type
}

function typeTag(type) {
  const map = { text: '', voice: 'success', video: 'warning', link: 'info', image: 'danger', file: 'primary' }
  return map[type] || ''
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function loadMessages() {
  loading.value = true
  try {
    const params = { limit, offset: (page.value - 1) * limit }
    if (filters.value.category) params.category = filters.value.category
    if (filters.value.msg_type) params.msg_type = filters.value.msg_type
    const res = await fetchMessages(params)
    items.value = res.data?.items || []
    total.value = res.data?.total || 0
  } catch (e) {
    console.error('Failed to load messages:', e)
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.value = { category: '', msg_type: '' }
  page.value = 1
  loadMessages()
}

function onPageChange(p) {
  page.value = p
  loadMessages()
}

onMounted(loadMessages)
</script>
