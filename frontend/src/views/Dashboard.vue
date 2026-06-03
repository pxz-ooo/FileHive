<template>
  <div>
    <el-row :gutter="20">
      <!-- 分类统计卡片 -->
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>
            <span>分类统计</span>
          </template>
          <div v-if="loading" style="text-align: center; padding: 40px">
            <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          </div>
          <div v-else-if="Object.keys(categoryStats).length === 0" style="text-align: center; padding: 40px; color: #999">
            暂无数据
          </div>
          <div v-else>
            <el-row :gutter="12">
              <el-col :span="8" v-for="(count, cat) in categoryStats" :key="cat" style="margin-bottom: 12px">
                <el-card shadow="hover" :body-style="{ padding: '16px' }">
                  <div style="display: flex; justify-content: space-between; align-items: center">
                    <span>{{ cat }}</span>
                    <el-tag type="primary" effect="plain">{{ count }}</el-tag>
                  </div>
                </el-card>
              </el-col>
            </el-row>
          </div>
        </el-card>
      </el-col>

      <!-- 快捷操作 -->
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>
            <span>快捷操作</span>
          </template>
          <div style="display: flex; flex-direction: column; gap: 12px">
            <el-button type="primary" @click="handleSync" :loading="syncing" style="width: 100%">
              <el-icon style="margin-right: 6px"><Refresh /></el-icon>
              手动同步消息
            </el-button>
            <el-button @click="$router.push('/messages')" style="width: 100%">
              <el-icon style="margin-right: 6px"><Message /></el-icon>
              查看消息列表
            </el-button>
          </div>
        </el-card>

        <!-- 使用说明 -->
        <el-card shadow="never" style="margin-top: 16px">
          <template #header>
            <span>使用说明</span>
          </template>
          <div style="font-size: 13px; line-height: 1.8; color: #666">
            <p>1. 在微信中将消息<strong>转发</strong>给企业微信客服</p>
            <p>2. 系统自动接收并处理消息</p>
            <p>3. AI 自动<strong>分类 + 摘要 + 打标签</strong></p>
            <p>4. 在消息列表中查看整理结果</p>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { fetchCategoryStats, triggerSync } from '../api/index.js'
import { ElMessage } from 'element-plus'

const categoryStats = ref({})
const loading = ref(true)
const syncing = ref(false)

async function loadStats() {
  try {
    const res = await fetchCategoryStats()
    categoryStats.value = res.data?.categories || {}
  } catch (e) {
    console.error('Failed to load stats:', e)
  } finally {
    loading.value = false
  }
}

async function handleSync() {
  syncing.value = true
  try {
    const res = await triggerSync()
    const count = res.data?.processed || 0
    ElMessage.success(`同步完成，处理 ${count} 条消息`)
    await loadStats()
  } catch (e) {
    ElMessage.error('同步失败: ' + (e.response?.data?.error || e.message))
  } finally {
    syncing.value = false
  }
}

onMounted(loadStats)
</script>
