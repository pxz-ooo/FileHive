const api = require('../../utils/api')
const app = getApp()

function maskKey(key) {
  const text = (key || '').trim()
  if (!text) return '未填写'
  if (text.length <= 10) return `${text.slice(0, 3)}***`
  return `${text.slice(0, 4)}***${text.slice(-4)}`
}

function formatBytes(size) {
  const value = Number(size || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function providerOptions(selected) {
  return [
    {
      value: 'siliconflow_proxy',
      title: '默认智能通道',
      desc: '优先走我们内置的 Vercel 轻服务，再转到 SiliconFlow。',
      active: selected === 'siliconflow_proxy',
    },
    {
      value: 'mimo_direct',
      title: '自配 MiMo',
      desc: '直接从小程序调用 MiMo，适合你自己的备用 Key。',
      active: selected === 'mimo_direct',
    },
  ]
}

Page({
  data: {
    aiProviderMode: 'siliconflow_proxy',
    providerOptions: providerOptions('siliconflow_proxy'),
    siliconflowApiKey: '',
    mimoApiKey: '',
    savedSiliconflowApiKeyMask: '未填写',
    savedMimoApiKeyMask: '未填写',
    proxyStatus: '未校验',
    siliconflowKeyStatus: '未填写',
    mimoKeyStatus: '未填写',
    storageMode: 'local_first',
    messageCount: 0,
    projectCount: 0,
    categoryCount: 0,
    totalFileSize: '0 B',
    checkingProxy: false,
    checkingMimo: false,
    exportingIndex: false,
    exportingManifest: false,
  },

  onLoad() {
    this.syncLocalState()
    this.loadRuntimeSnapshot()
  },

  onShow() {
    this.syncLocalState()
    this.loadRuntimeSnapshot()
  },

  syncLocalState() {
    const providerMode = app.globalData.aiProviderMode || 'siliconflow_proxy'
    const siliconflowApiKey = app.globalData.siliconflowApiKey || ''
    const mimoApiKey = app.globalData.mimoApiKey || ''
    this.setData({
      aiProviderMode: providerMode,
      providerOptions: providerOptions(providerMode),
      siliconflowApiKey,
      mimoApiKey,
      savedSiliconflowApiKeyMask: maskKey(siliconflowApiKey),
      savedMimoApiKeyMask: maskKey(mimoApiKey),
      siliconflowKeyStatus: siliconflowApiKey ? '已保存，待校验' : '未填写',
      mimoKeyStatus: mimoApiKey ? '已保存，待校验' : '未填写',
    })
  },

  loadRuntimeSnapshot() {
    api.fetchRuntimeStatus().then((result) => {
      this.setData({
        storageMode: result.storage_mode || 'local_first',
        messageCount: Number(result.message_count || 0),
        projectCount: Number(result.project_count || 0),
        categoryCount: Number(result.category_count || 0),
        totalFileSize: formatBytes(result.total_file_size || 0),
      })
    }).catch(() => {})
  },

  selectProvider(e) {
    const value = e.currentTarget.dataset.value || 'siliconflow_proxy'
    this.setData({
      aiProviderMode: value,
      providerOptions: providerOptions(value),
    })
  },

  onSiliconflowApiKeyInput(e) {
    this.setData({ siliconflowApiKey: e.detail.value || '' })
  },

  onMimoApiKeyInput(e) {
    this.setData({ mimoApiKey: e.detail.value || '' })
  },

  saveSettings() {
    const providerMode = this.data.aiProviderMode
    const siliconflowApiKey = (this.data.siliconflowApiKey || '').trim()
    const mimoApiKey = (this.data.mimoApiKey || '').trim()

    app.setAiProviderMode(providerMode)
    app.setSiliconflowApiKey(siliconflowApiKey)
    app.setMimoApiKey(mimoApiKey)

    this.setData({
      savedSiliconflowApiKeyMask: maskKey(siliconflowApiKey),
      savedMimoApiKeyMask: maskKey(mimoApiKey),
      siliconflowKeyStatus: siliconflowApiKey ? '已保存，待校验' : '未填写',
      mimoKeyStatus: mimoApiKey ? '已保存，待校验' : '未填写',
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.loadRuntimeSnapshot()
  },

  validateDefaultChannel() {
    this.setData({ checkingProxy: true, proxyStatus: '校验中...' })
    api.validateProxyService().then((result) => {
      const model = result.model || 'THUDM/GLM-4.1V-9B-Thinking'
      if (result.keyConfigured === false && !((app.globalData.siliconflowApiKey || '').trim())) {
        this.setData({ proxyStatus: '服务在线，但默认 SiliconFlow Key 未配置' })
        wx.showToast({ title: '请联系管理员配置默认 Key', icon: 'none' })
        return
      }
      this.setData({ proxyStatus: `可用 · ${model}` })
      wx.showToast({ title: '默认通道可用', icon: 'success' })
    }).catch((error) => {
      this.setData({ proxyStatus: error.message || '不可用' })
      wx.showToast({ title: error.message || '校验失败', icon: 'none' })
    }).finally(() => {
      this.setData({ checkingProxy: false })
    })
  },

  validateMimoKey() {
    if (!((app.globalData.mimoApiKey || '').trim())) {
      this.setData({ mimoKeyStatus: '请先填写并保存 MiMo Key' })
      wx.showToast({ title: '请先保存 MiMo Key', icon: 'none' })
      return
    }
    this.setData({ checkingMimo: true, mimoKeyStatus: '校验中...' })
    api.validateMimoKey().then(() => {
      this.setData({ mimoKeyStatus: '可用' })
      wx.showToast({ title: 'MiMo Key 可用', icon: 'success' })
    }).catch((error) => {
      this.setData({ mimoKeyStatus: error.message || '无效' })
      wx.showToast({ title: error.message || '校验失败', icon: 'none' })
    }).finally(() => {
      this.setData({ checkingMimo: false })
    })
  },

  clearSiliconflowApiKey() {
    app.clearSiliconflowApiKey()
    this.setData({
      siliconflowApiKey: '',
      savedSiliconflowApiKeyMask: '未填写',
      siliconflowKeyStatus: '未填写',
    })
    wx.showToast({ title: '已清空 SiliconFlow Key', icon: 'success' })
  },

  clearMimoApiKey() {
    app.clearMimoApiKey()
    wx.removeStorageSync('apiKeyGuideDismissed')
    this.setData({
      mimoApiKey: '',
      savedMimoApiKeyMask: '未填写',
      mimoKeyStatus: '未填写',
    })
    wx.showToast({ title: '已清空 MiMo Key', icon: 'success' })
  },

  copyTutorial() {
    const text = [
      '本小程序是本地优先工具：消息、图片、文件默认只保存在当前设备本地。',
      '',
      '默认智能通道：',
      '1. 我们内置的 Vercel 轻服务会转发到 SiliconFlow。',
      '2. 如果你有自己的 SiliconFlow Key，也可以填在设置页里，调用时优先用你的 Key。',
      '',
      '自配 MiMo：',
      '1. 去 MiMo 平台创建你自己的 API Key。',
      '2. 填到设置页并保存。',
      '3. 需要时切换到“自配 MiMo”或作为默认通道失败时的备用能力。',
    ].join('\n')
    wx.setClipboardData({ data: text })
  },

  showApiKeyGuide() {
    wx.showModal({
      title: 'AI 通道说明',
      content: '默认模式下，小程序会请求我们内置的 Vercel 轻服务，由它无状态转发到 SiliconFlow。你也可以填写自己的 SiliconFlow Key 覆盖默认 Key，或者填写 MiMo Key 作为备用通道。我们不会把你的消息和文件保存到云端。',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  exportIndex() {
    this.setData({ exportingIndex: true })
    api.exportIndexFile().then((filePath) => api.shareOrOpenFile(filePath, 'wechat-organizer-index.txt'))
      .then(() => wx.showToast({ title: '索引已导出', icon: 'success' }))
      .catch((error) => wx.showToast({ title: error.message || '导出失败', icon: 'none' }))
      .finally(() => this.setData({ exportingIndex: false }))
  },

  exportManifest() {
    this.setData({ exportingManifest: true })
    api.exportBundleManifest().then((filePath) => api.shareOrOpenFile(filePath, 'wechat-organizer-bundle-manifest.txt'))
      .then(() => wx.showToast({ title: '文件清单已导出', icon: 'success' }))
      .catch((error) => wx.showToast({ title: error.message || '导出失败', icon: 'none' }))
      .finally(() => this.setData({ exportingManifest: false }))
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  },
})
