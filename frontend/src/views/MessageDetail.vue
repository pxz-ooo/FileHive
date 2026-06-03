<template>
  <div v-if="loading" style="text-align: center; padding: 80px">
    <el-icon class="is-loading" :size="32"><Loading /></el-icon>
  </div>
  <div v-else-if="error" style="text-align: center; padding: 80px; color: #999">
    <p>{{ error }}</p>
    <el-button @click="$router.push('/messages')" style="margin-top: 12px">返回列表</el-button>
  </div>
  <div v-else>
    <!-- 基本信息 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>
            <el-tag :type="typeTag" size="small" effect="dark" style="margin-right: 8px">{{ typeLabel }}</el-tag>
            消息详情
          </span>
          <div>
            <el-button size="small" @click="handleReanalyze" :loading="reanalyzing">
              <el-icon><Refresh /></el-icon>
              重新分析
            </el-button>
            <el-button size="small" @click="$router.push('/messages')">返回列表</el-button>
          </div>
        </div>
      </template>

      <div style="font-size: 14px; line-height: 2">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="消息ID" :span="2">{{ msg.message.msgid }}</el-descriptions-item>
          <el-descriptions-item label="消息类型">{{ typeLabel }}</el-descriptions-item>
          <el-descriptions-item label="发送时间">{{ formatTime(msg.message.send_time) }}</el-descriptions-item>
          <el-descriptions-item label="发送来源">{{ originLabel }}</el-descriptions-item>
          <el-descriptions-item label="客户ID" v-if="msg.message.external_userid">{{ msg.message.external_userid }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-card>

    <!-- 原始内容 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <template #header>
        <span>原始内容</span>
      </template>
      <div style="font-size: 14px; line-height: 1.8; white-space: pre-wrap; word-break: break-all">
        {{ contentText }}
      </div>
      <!-- 链接预览 -->
      <div v-if="msg.message.msg_type === 'link' && linkData" style="margin-top: 12px; padding: 12px; background: #f5f7fa; border-radius: 6px">
        <div style="font-weight: 600">{{ linkData.title }}</div>
        <div style="color: #666; font-size: 13px; margin-top: 4px">{{ linkData.desc }}</div>
        <el-link type="primary" :href="linkData.url" target="_blank" style="margin-top: 4px">{{ linkData.url }}</el-link>
      </div>
    </el-card>

    <!-- AI 分析结果 -->
    <el-card shadow="never">
      <template #header>
        <span>AI 分析结果</span>
      </template>
      <div v-if="!msg.analysis" style="text-align: center; padding: 30px; color: #999">
        等待分析...
      </div>
      <div v-else>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="分类">
            <el-tag type="warning" effect="dark">{{ msg.analysis.category }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="置信度">
            <el-tag :type="confidenceLevel" size="small">{{ msg.analysis.confidence }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="摘要" :span="2" content-style="font-size: 15px; font-weight: 500">
            {{ msg.analysis.summary }}
          </el-descriptions-item>
          <el-descriptions-item label="标签" :span="2">
            <el-tag
              v-for="tag in tags"
              :key="tag"
              style="margin-right: 6px; margin-bottom: 4px"
              size="small"
              effect="plain"
            >
              {{ tag }}
            </el-tag>
            <span v-if="tags.length === 0" style="color: #999">无标签</span>
          </el-descriptions-item>
        </el-descriptions>
        <div style="margin-top: 12px; font-size: 12px; color: #999">
          使用模型: {{ msg.analysis.model_used || '未知' }}
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchMessage, reanalyzeMessage } from '../api/index.js'
import { ElMessage } from 'element-plus'

const route = useRoute()
const msg = ref({ message: {}, analysis: null })
const loading = ref(true)
const error = ref('')
const reanalyzing = ref(false)
const rawData = ref(null)

const typeLabel = computed(() => {
  const map = { text: '文本', voice: '语音', video: '视频', link: '链接', image: '图片', file: '文件', location: '位置', miniprogram: '小程序' }
  return map[msg.value.message?.msg_type] || msg.value.message?.msg_type || ''
})

const typeTag = computed(() => {
  const map = { text: '', voice: 'success', video: 'warning', link: 'info', image: 'danger', file: 'primary' }
  return map[msg.value.message?.msg_type] || ''
})

const originLabel = computed(() => {
  const map = { 3: '微信客户', 4: '系统事件', 5: '接待人员' }
  return map[msg.value.message?.origin] || '未知'
})

const contentText = computed(() => {
  const type = msg.value.message?.msg_type
  if (type === 'text') {
    try {
      const parsed = JSON.parse(msg.value.message?.raw_content || '{}')
      return parsed.text?.content || '(空)'
    } catch { return msg.value.message?.raw_content || '(空)' }
  }
  if (type === 'voice') return '[语音消息] (已保存音频文件)'
  if (type === 'video') return '[视频消息] (已保存视频文件)'
  if (type === 'image') return '[图片消息] (已保存图片文件)'
  if (type === 'file') return '[文件消息] (已保存文件)'
  return msg.value.message?.raw_content || '(空)'
})

const linkData = computed(() => {
  if (msg.value.message?.msg_type !== 'link') return null
  try {
    const parsed = JSON.parse(msg.value.message?.raw_content || '{}')
    return parsed.link || null
  } catch { return null }
})

const tags = computed(() => {
  if (!msg.value.analysis?.tags) return []
  try { return JSON.parse(msg.value.analysis.tags) }
  catch { return [] }
})

const confidenceLevel = computed(() => {
  const c = msg.value.analysis?.confidence
  if (c >= 0.8) return 'success'
  if (c >= 0.5) return 'warning'
  return 'danger'
})

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

async function loadMessage() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchMessage(route.params.msgid)
    if (res.data?.error) {
      error.value = '消息不存在'
    } else {
      msg.value = res.data
    }
  } catch (e) {
    error.value = '加载失败: ' + (e.response?.data?.error || e.message)
  } finally {
    loading.value = false
  }
}

async function handleReanalyze() {
  reanalyzing.value = true
  try {
    const res = await reanalyzeMessage(route.params.msgid)
    if (res.data?.error) {
      ElMessage.error(res.data.error)
    } else {
      msg.value.analysis = res.data
      ElMessage.success('重新分析完成')
    }
  } catch (e) {
    ElMessage.error('重新分析失败')
  } finally {
    reanalyzing.value = false
  }
}

onMounted(loadMessage)
</script>
