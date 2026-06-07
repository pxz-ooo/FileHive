const api = require('../../utils/api')

const TYPE_META = {
  text: { label: '文字' },
  link: { label: '链接' },
  image: { label: '图片' },
  file: { label: '文件' },
  video: { label: '视频' },
}

function getTypeLabel(msgType) {
  return (TYPE_META[msgType] || {}).label || msgType || '未知'
}

function parseRawContent(rawContent) {
  if (!rawContent) return {}
  try {
    return JSON.parse(rawContent)
  } catch (error) {
    return {}
  }
}

function sanitizeText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const preferred = value.summary || value.desc || value.title || value.content || ''
    if (preferred) return sanitizeText(preferred)
    try {
      return JSON.stringify(value)
    } catch (error) {
      return ''
    }
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

function formatDisplayTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function shouldShowOcrText(value) {
  const text = sanitizeText(value)
  if (!text) return false
  const marks = (text.match(/\?/g) || []).length
  return !(marks >= 6 && marks / Math.max(text.length, 1) > 0.18)
}

function detectPlatform(source) {
  const text = String(source || '').toLowerCase()
  if (text.includes('xiaohongshu.com') || text.includes('xhslink.com') || text.includes('小红书')) return '小红书'
  if (text.includes('bilibili.com') || text.includes('b23.tv') || text.includes('哔哩哔哩')) return 'B站'
  if (text.includes('mp.weixin.qq.com') || text.includes('公众号')) return '微信公众号'
  if (text.includes('douyin.com') || text.includes('v.douyin.com') || text.includes('抖音')) return '抖音'
  return '外部链接'
}

function extractContentId(url, platform) {
  if (!url) return ''
  if (platform === '小红书') {
    const queryMatch = url.match(/[?&](?:target_note_id|note_id|noteId)=([A-Za-z0-9]+)/i)
    if (queryMatch) return queryMatch[1]
    const pathMatch = url.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/i)
    return pathMatch ? pathMatch[1] : ''
  }
  if (platform === 'B站') {
    const pathMatch = url.match(/\/video\/((?:BV[0-9A-Za-z]+)|(?:av\d+))/i) || url.match(/\/opus\/(\d+)/i)
    return pathMatch ? pathMatch[1] : ''
  }
  if (platform === '抖音') {
    const pathMatch = url.match(/\/(?:video|note)\/(\d+)/i)
    return pathMatch ? pathMatch[1] : ''
  }
  return ''
}

function buildCanonicalUrl(url, platform, contentId) {
  if (!url) return ''
  if (platform === '小红书' && contentId) return `https://www.xiaohongshu.com/explore/${contentId}`
  if (platform === '抖音' && contentId) return `https://www.douyin.com/video/${contentId}`
  return url
}

function buildPlatformInfo(message) {
  const data = parseRawContent(message.raw_content)
  const link = data.link || {}
  if (message.msg_type !== 'link') {
    return { show: false, name: '', url: '', originalUrl: '', contentId: '', rawText: '', title: '', desc: '', author: '', type: '', mediaUrl: '', parser: '', parserMessage: '' }
  }
  const originalUrl = link.url || ''
  const rawText = link.raw_text || ''
  const source = [originalUrl, link.title, link.desc, rawText].join(' ')
  const name = link.platform || detectPlatform(source)
  const contentId = extractContentId(originalUrl, name)
  return {
    show: true,
    name,
    url: buildCanonicalUrl(originalUrl, name, contentId),
    originalUrl,
    contentId,
    rawText,
    title: link.title || '',
    desc: link.desc || '',
    author: link.author || '',
    type: link.type || '',
    mediaUrl: link.media_url || '',
    parser: link.parser || '',
    parserMessage: link.parser_message || '',
    publishedAt: link.published_at || '',
    contentText: link.content_text || '',
  }
}

function buildStatusCard(analysis, projectName) {
  if (!analysis) return { label: '待分析', tone: 'pending' }
  if (!projectName) return { label: '待归档', tone: 'warning' }
  return { label: '已整理', tone: 'ready' }
}

function buildUsageSuggestions(message, analysis, platformInfo) {
  const category = (analysis && analysis.category) || ''
  if (message.msg_type === 'image') return '可用于图片资料库、截图笔记、活动记录或灵感收集。'
  if (message.msg_type === 'file') return '可用于项目文档、资料备份、会议准备或知识库沉淀。'
  if (message.msg_type === 'link') return `${platformInfo.name || '链接'}可进入收藏清单、选题库、周报引用或后续复盘。`
  if (category === '工作') return '可用于项目纪要、任务背景、团队同步或周报素材。'
  if (category === '通知') return '可用于提醒池、时间线记录或待办确认。'
  return '可用于知识库沉淀、分类收藏和后续二次整理。'
}

function buildQuickCards(analysis, projectName, displayTime, confidenceText, modelText) {
  return [
    { key: 'status', label: '处理状态', value: analysis ? '已生成摘要' : '等待分析' },
    { key: 'project', label: '归档项目', value: projectName || '未归档', action: 'openProjectSheet', editable: true },
    { key: 'time', label: '消息时间', value: displayTime || '未记录' },
    { key: 'model', label: '可信度 / 模型', value: `${confidenceText} / ${modelText}` },
  ]
}

function buildAiItems(message, analysis, platformInfo, summaryText) {
  return [
    { key: 'category', label: '分类', value: (analysis && analysis.category) || '未分类', action: 'openCategorySheet', editable: true },
    { key: 'summary', label: '摘要', value: summaryText || '暂无摘要', action: 'editDesc', editable: true, copyable: true },
    { key: 'usage', label: '适用场景', value: buildUsageSuggestions(message, analysis, platformInfo) },
  ]
}

function buildAiDebugNotice(analysis) {
  const modelUsed = sanitizeText(analysis && analysis.model_used)
  if (!analysis) {
    return {
      show: true,
      tone: 'pending',
      title: '尚未完成分析',
      text: '当前还没有生成分析结果，这条消息还未进入 AI 或本地整理阶段。',
    }
  }
  if (!modelUsed || modelUsed === 'local_rule') {
    return {
      show: true,
      tone: 'warning',
      title: '当前为本地降级结果',
      text: '这条摘要和分类没有成功走到云端 AI，当前显示的是本地兜底整理结果。',
    }
  }
  const lower = modelUsed.toLowerCase()
  if (lower.includes('mimo')) {
    return {
      show: true,
      tone: 'ok',
      title: '当前由 MiMo 分析',
      text: `模型: ${modelUsed}`,
    }
  }
  if (
    lower.includes('qwen')
    || lower.includes('glm')
    || lower.includes('siliconflow')
    || lower.includes('vl')
  ) {
    return {
      show: true,
      tone: 'ok',
      title: '当前由默认智能通道分析',
      text: `模型: ${modelUsed}`,
    }
  }
  return {
    show: true,
    tone: 'info',
    title: '当前分析来源',
    text: `模型: ${modelUsed}`,
  }
}

function buildContentSections(message, platformInfo) {
  const data = parseRawContent(message.raw_content)

  if (message.msg_type === 'link') {
    const items = []
    if (platformInfo.name) items.push({ label: '来源平台', value: platformInfo.name })
    if (platformInfo.type) items.push({ label: '内容类型', value: platformInfo.type })
    if (platformInfo.author) items.push({ label: '作者', value: platformInfo.author, copyable: true })
    if (platformInfo.contentId) items.push({ label: '内容 ID', value: platformInfo.contentId, copyable: true })
    if (platformInfo.title) items.push({ label: '分享标题', value: platformInfo.title, copyable: true })
    if (platformInfo.desc) items.push({ label: '分享摘要', value: platformInfo.desc, copyable: true })
    if (platformInfo.url) items.push({ label: '当前链接', value: platformInfo.url, copyable: true, isLink: true })
    if (platformInfo.originalUrl && platformInfo.originalUrl !== platformInfo.url) {
      items.push({ label: '原始链接', value: platformInfo.originalUrl, copyable: true, isLink: true })
    }
    if (platformInfo.mediaUrl) {
      items.push({ label: '媒体地址', value: platformInfo.mediaUrl, copyable: true, isLink: true })
    }
    const sections = []
    if (items.length) sections.push({ title: '来源信息', items })
    if (platformInfo.parser || platformInfo.parserMessage) {
      sections.push({
        title: '解析结果',
        items: [
          platformInfo.parser ? { label: '解析器', value: platformInfo.parser } : null,
          platformInfo.parserMessage ? { label: '解析状态', value: platformInfo.parserMessage } : null,
        ].filter(Boolean),
      })
    }
    if (platformInfo.rawText) {
      sections.push({ title: '分享文案', items: [{ label: '原始文案', value: platformInfo.rawText, copyable: true }] })
    }
    return sections
  }

  if (message.msg_type === 'text') {
    return [{
      title: '原始内容',
      items: [{ label: '文本内容', value: sanitizeText(data.text && data.text.content) || '(空)', copyable: true }],
    }]
  }

  if (message.msg_type === 'file') {
    const file = data.file || {}
    return [{
      title: '文件信息',
      items: [
        { label: 'AI 命名', value: sanitizeText(file.title) || '暂未生成', copyable: true },
        { label: '文件名', value: sanitizeText(file.filename) || '未提供', copyable: true },
        { label: '补充说明', value: sanitizeText(file.content) || '暂无补充说明', copyable: true },
        { label: '提取正文', value: sanitizeText(file.extracted_text) || '暂未提取到正文', copyable: true },
      ],
    }]
  }

  if (message.msg_type === 'image') {
    const image = data.image || {}
    const items = [
      { label: 'AI 命名', value: sanitizeText(image.title) || '暂未生成', copyable: true },
      { label: '图片描述', value: sanitizeText(image.content || image.filename) || '暂未生成描述', copyable: true },
    ]
    if (shouldShowOcrText(image.ocr_text)) {
      items.push({ label: 'OCR 文本', value: sanitizeText(image.ocr_text), copyable: true })
    }
    return [{ title: '图片识别', items }]
  }

  return [{
    title: '原始内容',
    items: [{ label: '内容', value: sanitizeText(message.raw_content) || '(空)', copyable: true }],
  }]
}

function buildMediaPreview(message, mediaItems) {
  const first = (mediaItems || [])[0]
  if (!first) return null
  if (message.msg_type === 'image') {
    return {
      type: 'image',
      title: first.filename || '图片素材',
      previewUrl: first.local_path || first.download_url || '',
    }
  }
  if (message.msg_type === 'file') {
    return {
      type: 'file',
      title: first.filename || '文件素材',
      previewUrl: first.local_path || first.download_url || '',
    }
  }
  return null
}

function createFallbackSummary(message) {
  const data = parseRawContent(message.raw_content)
  if (message.msg_type === 'text') return sanitizeText(data.text && data.text.content)
  if (message.msg_type === 'link') return sanitizeText(data.link && (data.link.title || data.link.desc || data.link.raw_text || data.link.url))
  if (message.msg_type === 'image') return sanitizeText(data.image && (data.image.title || data.image.content || data.image.filename))
  if (message.msg_type === 'file') return sanitizeText(data.file && (data.file.title || data.file.filename || data.file.content))
  return ''
}

Page({
  data: {
    msg: null,
    analysis: null,
    projects: [],
    categories: [],
    projectName: '',
    projectColor: '#2f6b5f',
    typeLabel: '',
    displayTime: '',
    summaryText: '',
    confidenceText: '未提供',
    modelText: '未记录',
    statusLabel: '待分析',
    statusTone: 'pending',
    aiDebugNotice: { show: false, tone: 'info', title: '', text: '' },
    quickCards: [],
    aiItems: [],
    platformInfo: { show: false },
    contentSections: [],
    mediaPreview: null,
    showProjectSheet: false,
    showCategorySheet: false,
    showEditDialog: false,
    showReanalyzeDialog: false,
    editText: '',
    reanalyzeFeedback: '',
    error: '',
  },

  onLoad(options) {
    if (!options.msgid) {
      this.setData({ error: '缺少消息 ID' })
      return
    }
    this.load(options.msgid)
  },

  load(msgid) {
    wx.showLoading({ title: '加载中' })
    Promise.all([
      api.fetchMessage(msgid),
      api.fetchProjects(),
      api.fetchCategories(),
      api.fetchMessageMedia(msgid).catch(() => ({ items: [] })),
    ]).then(([detail, projects, categories, mediaResult]) => {
      wx.hideLoading()
      if (detail.error) {
        this.setData({ error: detail.error })
        return
      }

      const message = detail.message || {}
      const analysis = detail.analysis
        ? {
            ...detail.analysis,
            summary: sanitizeText(detail.analysis.summary || detail.analysis.desc || ''),
            desc: sanitizeText(detail.analysis.summary || detail.analysis.desc || ''),
          }
        : null
      const project = (projects || []).find((item) => String(item.id) === String(message.project_id))
      const projectName = project ? project.name : ''
      const projectColor = project && project.color ? project.color : '#2f6b5f'
      const displayTime = formatDisplayTime(message.send_time)
      const confidenceText = analysis && analysis.confidence != null ? `${Math.round(analysis.confidence * 100)}%` : '未提供'
      const modelText = analysis && analysis.model_used ? analysis.model_used : '未记录'
      const platformInfo = buildPlatformInfo(message)
      const status = buildStatusCard(analysis, projectName)
      const summaryText = (analysis && analysis.summary) || createFallbackSummary(message) || '这条消息还没有形成摘要，你可以直接修改摘要，或带意见重新分析。'

      this.setData({
        msg: detail,
        analysis,
        projects: projects || [],
        categories: categories || [],
        projectName,
        projectColor,
        typeLabel: getTypeLabel(message.msg_type),
        displayTime,
        summaryText,
        confidenceText,
        modelText,
        statusLabel: status.label,
        statusTone: status.tone,
        aiDebugNotice: buildAiDebugNotice(analysis),
        quickCards: buildQuickCards(analysis, projectName, displayTime, confidenceText, modelText),
        aiItems: buildAiItems(message, analysis, platformInfo, summaryText),
        platformInfo,
        contentSections: buildContentSections(message, platformInfo),
        mediaPreview: buildMediaPreview(message, (mediaResult && mediaResult.items) || []),
        error: '',
      })
    }).catch((error) => {
      wx.hideLoading()
      this.setData({ error: error.message || '加载失败' })
    })
  },

  copyValue(e) {
    wx.setClipboardData({ data: String(e.currentTarget.dataset.value || '') })
  },

  copySummary() {
    wx.setClipboardData({ data: this.data.summaryText || '' })
  },

  previewImage() {
    const preview = this.data.mediaPreview
    if (!preview || preview.type !== 'image' || !preview.previewUrl) return
    wx.previewImage({ current: preview.previewUrl, urls: [preview.previewUrl] })
  },

  openMediaFile() {
    const preview = this.data.mediaPreview
    if (!preview || !preview.previewUrl) return
    wx.openDocument({
      filePath: preview.previewUrl,
      showMenu: true,
      fail: () => wx.showToast({ title: '文件暂时无法打开', icon: 'none' }),
    })
  },

  openPrimaryLink() {
    const target = this.data.platformInfo.url || this.data.platformInfo.originalUrl
    if (target) this.openLink(target)
  },

  openLink(url) {
    if (!/^https?:\/\//i.test(url || '')) {
      wx.showToast({ title: '链接无效', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/webview/webview?url=${encodeURIComponent(url)}`,
      fail: () => {
        wx.setClipboardData({ data: url })
        wx.showToast({ title: '未能直接打开，已复制链接', icon: 'none' })
      },
    })
  },

  onContentValueTap(e) {
    if (!e.currentTarget.dataset.link) return
    this.openLink(e.currentTarget.dataset.value || '')
  },

  onQuickCardTap(e) {
    const action = e.currentTarget.dataset.action
    if (action && typeof this[action] === 'function') this[action]()
  },

  onAiActionTap(e) {
    const action = e.currentTarget.dataset.action
    if (action && typeof this[action] === 'function') this[action]()
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  },

  editDesc() {
    this.setData({
      showEditDialog: true,
      editText: sanitizeText(this.data.summaryText),
    })
  },

  onEditInput(e) {
    this.setData({ editText: sanitizeText(e.detail.value || '') })
  },

  cancelEdit() {
    this.setData({ showEditDialog: false, editText: '' })
  },

  onEditDialogClose(e) {
    if (e && e.detail && e.detail.visible) return
    this.cancelEdit()
  },

  saveDesc() {
    const desc = sanitizeText(this.data.editText)
    if (!desc) {
      wx.showToast({ title: '摘要不能为空', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中' })
    api.updateAnalysis(this.data.msg.message.msgid, desc).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '摘要已更新', icon: 'success' })
      this.setData({ showEditDialog: false })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.hideLoading()
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    })
  },

  openProjectSheet() {
    this.setData({ showProjectSheet: true })
  },

  closeProjectSheet() {
    this.setData({ showProjectSheet: false })
  },

  onProjectSheetClose(e) {
    if (!e.detail.visible) this.setData({ showProjectSheet: false })
  },

  selectProject(e) {
    const projectId = Number(e.currentTarget.dataset.pid)
    api.setProject(this.data.msg.message.msgid, projectId).then(() => {
      wx.showToast({ title: '项目已更新', icon: 'success' })
      this.setData({ showProjectSheet: false })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' })
    })
  },

  removeProject() {
    api.removeProject(this.data.msg.message.msgid).then(() => {
      wx.showToast({ title: '已移出项目', icon: 'success' })
      this.setData({ showProjectSheet: false })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' })
    })
  },

  openCategorySheet() {
    this.setData({ showCategorySheet: true })
  },

  closeCategorySheet() {
    this.setData({ showCategorySheet: false })
  },

  onCategorySheetClose(e) {
    if (!e.detail.visible) this.setData({ showCategorySheet: false })
  },

  selectCategory(e) {
    const category = String(e.currentTarget.dataset.category || '').trim()
    if (!category) return
    api.updateCategory(this.data.msg.message.msgid, category).then(() => {
      wx.showToast({ title: '分类已更新', icon: 'success' })
      this.setData({ showCategorySheet: false })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.showToast({ title: error.message || '分类更新失败', icon: 'none' })
    })
  },

  openReanalyzeDialog() {
    this.setData({ showReanalyzeDialog: true, reanalyzeFeedback: '' })
  },

  closeReanalyzeDialog() {
    this.setData({ showReanalyzeDialog: false, reanalyzeFeedback: '' })
  },

  onReanalyzeDialogClose(e) {
    if (e && e.detail && e.detail.visible) return
    this.closeReanalyzeDialog()
  },

  onReanalyzeInput(e) {
    this.setData({ reanalyzeFeedback: sanitizeText(e.detail.value || '') })
  },

  submitReanalyze() {
    const feedback = sanitizeText(this.data.reanalyzeFeedback)
    if (!feedback) {
      wx.showToast({ title: '请输入你的修正意见', icon: 'none' })
      return
    }
    wx.showLoading({ title: '分析中' })
    api.reanalyze(this.data.msg.message.msgid, feedback).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '重新分析完成', icon: 'success' })
      this.setData({ showReanalyzeDialog: false, reanalyzeFeedback: '' })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.hideLoading()
      wx.showToast({ title: error.message || '重新分析失败', icon: 'none' })
    })
  },

  deleteMsg() {
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定继续吗？',
      success: (result) => {
        if (!result.confirm) return
        api.deleteMessage(this.data.msg.message.msgid).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 400)
        }).catch((error) => {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' })
        })
      },
    })
  },
})
