const DEFAULT_AI_PROXY_BASE_URL = 'https://your-filehive-ai.vercel.app'

App({
  globalData: {
    aiProviderMode: 'siliconflow_proxy',
    aiProxyBaseUrl: DEFAULT_AI_PROXY_BASE_URL,
    siliconflowApiKey: '',
    mimoApiKey: '',
    siliconflowModel: 'THUDM/GLM-4.1V-9B-Thinking',
    mimoModel: 'mimo-v2.5',
  },

  onLaunch() {
    const storedProviderMode = wx.getStorageSync('aiProviderMode')
    const storedSiliconflowApiKey = wx.getStorageSync('siliconflowApiKey')
    const storedMimoApiKey = wx.getStorageSync('mimoApiKey')

    this.globalData.aiProviderMode = this.normalizeAiProviderMode(storedProviderMode || 'siliconflow_proxy')
    this.globalData.siliconflowApiKey = this.normalizeApiKey(storedSiliconflowApiKey || '')
    this.globalData.mimoApiKey = this.normalizeApiKey(storedMimoApiKey || '')

    wx.setStorageSync('aiProviderMode', this.globalData.aiProviderMode)

    wx.loadFontFace({
      family: 't',
      source: 'url("/fonts/t.woff")',
      success: () => console.log('icon font loaded'),
      fail: (e) => console.warn('icon font load failed:', e.errMsg || e),
    })
  },

  setAiProviderMode(mode) {
    const normalized = this.normalizeAiProviderMode(mode)
    this.globalData.aiProviderMode = normalized
    wx.setStorageSync('aiProviderMode', normalized)
  },

  setSiliconflowApiKey(apiKey) {
    const normalized = this.normalizeApiKey(apiKey || '')
    this.globalData.siliconflowApiKey = normalized
    wx.setStorageSync('siliconflowApiKey', normalized)
  },

  clearSiliconflowApiKey() {
    this.globalData.siliconflowApiKey = ''
    wx.removeStorageSync('siliconflowApiKey')
  },

  setMimoApiKey(apiKey) {
    const normalized = this.normalizeApiKey(apiKey || '')
    this.globalData.mimoApiKey = normalized
    wx.setStorageSync('mimoApiKey', normalized)
  },

  clearMimoApiKey() {
    this.globalData.mimoApiKey = ''
    wx.removeStorageSync('mimoApiKey')
  },

  normalizeApiKey(apiKey) {
    const text = String(apiKey || '').trim()
    return text.replace(/^Bearer\s+/i, '').trim()
  },

  normalizeAiProviderMode(mode) {
    if (mode === 'mimo_direct') return 'mimo_direct'
    if (mode === 'siliconflow_direct') return 'siliconflow_direct'
    return 'siliconflow_proxy'
  },
})
