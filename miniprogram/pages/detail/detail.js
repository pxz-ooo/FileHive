const api = require('../../utils/api')

const TYPE_META = {
  text: { label: '文本' },
  link: { label: '链接' },
  image: { label: '图片' },
  file: { label: '文件' },
  voice: { label: '语音' },
  video: { label: '视频' },
  location: { label: '位置' },
  miniprogram: { label: '小程序' },
}

function getTypeLabel(msgType) {
  const meta = TYPE_META[msgType] || {}
  return meta.label || msgType || '未知'
}

function parseRawContent(rawContent) {
  if (!rawContent) return {}
  try {
    return JSON.parse(rawContent)
  } catch (error) {
    return {}
  }
}

function formatDisplayTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function detectPlatform(source) {
  const text = (source || '').toLowerCase()
  if (text.includes('xiaohongshu.com') || text.includes('xhslink.com') || text.includes('小红书')) return '小红书'
  if (text.includes('bilibili.com') || text.includes('b23.tv') || text.includes('/video/bv') || text.includes('哔哩哔哩')) return 'B站'
  if (text.includes('mp.weixin.qq.com') || text.includes('公众号')) return '微信公众号'
  if (text.includes('douyin.com') || text.includes('v.douyin.com') || text.includes('抖音')) return '抖音'
  return ''
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

  if (platform === '微信公众号') {
    const biz = (url.match(/[?&](?:__biz|biz)=([^&]+)/i) || [])[1] || ''
    const mid = (url.match(/[?&]mid=([^&]+)/i) || [])[1] || ''
    const idx = (url.match(/[?&]idx=([^&]+)/i) || [])[1] || ''
    return [biz, mid, idx].filter(Boolean).join(':')
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
    return {
      show: false,
      name: '',
      title: '',
      desc: '',
      rawText: '',
      url: '',
      originalUrl: '',
      sourceMode: '',
      statusText: '',
      contentId: '',
    }
  }

  const originalUrl = link.url || ''
  const rawText = link.raw_text || ''
  const source = [originalUrl, link.title, link.desc, rawText].join(' ')
  const name = detectPlatform(source) || '外部链接'
  const contentId = extractContentId(originalUrl, name)
  const url = buildCanonicalUrl(originalUrl, name, contentId)

  return {
    show: true,
    name,
    title: link.title || '',
    desc: link.desc || '',
    rawText,
    url,
    originalUrl,
    sourceMode: rawText ? '复制分享文案' : '直接粘贴链接',
    statusText: rawText ? '已识别为分享文案导入' : '已识别为链接导入',
    contentId,
  }
}

function buildStatusCard(message, analysis, projectName) {
  if (!analysis) {
    return {
      label: '待分析',
      tone: 'pending',
      hint: '这条消息还没有形成摘要，建议先重新分析一次。',
    }
  }

  if (!projectName) {
    return {
      label: '待归档',
      tone: 'warning',
      hint: '摘要已经有了，但还没有归到项目里，后续检索会比较散。',
    }
  }

  return {
    label: '已整理',
    tone: 'ready',
    hint: '摘要和项目都已经到位，这条消息已经适合沉淀进知识库。',
  }
}

function buildSnapshotCards(message, analysis, platformInfo, projectName, confidenceText, modelText, displayTime) {
  return [
    {
      label: '处理状态',
      value: analysis ? '已生成摘要' : '等待分析',
      helper: projectName ? `已归档到 ${projectName}` : '还没有归档项目',
    },
    {
      label: '消息时间',
      value: displayTime || '未记录',
      helper: '保留原始发送时间',
    },
    {
      label: '平台 / 类型',
      value: platformInfo.show ? `${platformInfo.name} / ${getTypeLabel(message.msg_type)}` : getTypeLabel(message.msg_type),
      helper: platformInfo.show ? platformInfo.sourceMode : '按消息类型展示',
    },
    {
      label: '可信度 / 模型',
      value: confidenceText,
      helper: modelText,
    },
  ]
}

function buildContentSections(message, analysis, platformInfo) {
  const data = parseRawContent(message.raw_content)
  const sections = []

  if (message.msg_type === 'link') {
    const items = []
    if (platformInfo.name) items.push({ label: '来源平台', value: platformInfo.name })
    if (platformInfo.contentId) items.push({ label: '内容 ID', value: platformInfo.contentId, copyable: true })
    if (platformInfo.title) items.push({ label: '分享标题', value: platformInfo.title, copyable: true })
    if (platformInfo.desc) items.push({ label: '分享摘要', value: platformInfo.desc, copyable: true })
    if (platformInfo.url) items.push({ label: '当前链接', value: platformInfo.url, copyable: true })
    if (platformInfo.originalUrl && platformInfo.originalUrl !== platformInfo.url) {
      items.push({ label: '原始短链', value: platformInfo.originalUrl, copyable: true })
    }
    if (items.length) {
      sections.push({
        title: '来源信息',
        tip: platformInfo.statusText || '保留平台、标题和链接，方便后续继续追溯。',
        items,
      })
    }

    if (platformInfo.rawText) {
      sections.push({
        title: '分享文案',
        tip: '这是导入时保留下来的原始分享文本，即使平台正文抓取失败也不会丢。',
        items: [{ label: '原始文案', value: platformInfo.rawText, copyable: true }],
      })
    }
  } else if (message.msg_type === 'text') {
    sections.push({
      title: '原始内容',
      tip: '保留原文，方便重新理解上下文。',
      items: [{ label: '文本内容', value: (data.text && data.text.content) || '(空)', copyable: true }],
    })
  } else if (message.msg_type === 'file') {
    const file = data.file || {}
    sections.push({
      title: '文件信息',
      tip: '文件类消息优先展示文件名和附加说明。',
      items: [
        { label: '文件名', value: file.filename || '未知文件', copyable: true },
        { label: '补充说明', value: file.content || '暂无补充说明', copyable: true },
      ],
    })
  } else if (message.msg_type === 'image') {
    const image = data.image || {}
    sections.push({
      title: '图片信息',
      tip: '当前先保留图片说明，后续可以继续补 OCR 和图像理解。',
      items: [{ label: '图片说明', value: image.content || image.filename || '图片消息', copyable: true }],
    })
  } else if (message.msg_type === 'video') {
    const video = data.video || {}
    sections.push({
      title: '视频信息',
      tip: '当前先保留文字描述，后续可以继续补视频摘要。',
      items: [{ label: '视频说明', value: video.content || video.filename || '视频消息', copyable: true }],
    })
  } else if (message.msg_type === 'voice') {
    const voice = data.voice || {}
    sections.push({
      title: '语音信息',
      tip: '历史语音消息仍然会展示，但手动导入入口已经收敛掉了。',
      items: [{ label: '语音说明', value: voice.content || voice.filename || '语音消息', copyable: true }],
    })
  } else if (message.msg_type === 'location') {
    const location = data.location || {}
    sections.push({
      title: '位置内容',
      tip: '保留位置名称和地址线索。',
      items: [{ label: '位置', value: location.address || location.name || '位置消息', copyable: true }],
    })
  } else if (message.msg_type === 'miniprogram') {
    const miniprogram = data.miniprogram || {}
    sections.push({
      title: '小程序内容',
      tip: '保留标题和路径，方便继续定位来源。',
      items: [
        { label: '标题', value: miniprogram.title || '小程序消息', copyable: true },
        { label: '页面路径', value: miniprogram.pagepath || '未提供路径', copyable: true },
      ],
    })
  } else {
    sections.push({
      title: '原始内容',
      tip: '暂时按原始文本展示。',
      items: [{ label: '内容', value: message.raw_content || '(空)', copyable: true }],
    })
  }

  if (analysis && analysis.category) {
    sections.push({
      title: 'AI 判断',
      tip: '这里展示 AI 当前已经提炼出的结论。',
      items: [
        { label: '分类', value: analysis.category || '未分类' },
        { label: '摘要', value: analysis.desc || analysis.summary || '暂无摘要', copyable: true },
      ],
    })
  }

  return sections
}

function buildActionHints(message, analysis, platformInfo, projectName) {
  const hints = []

  if (!analysis) {
    hints.push('这条消息还没有摘要，建议先重新分析一次。')
  }
  if (!projectName) {
    hints.push('还没有归档到项目，建议先放进一个明确的主题里。')
  }
  if (message.msg_type === 'link' && platformInfo.rawText) {
    hints.push('这是一条分享文案导入的链接，当前已经保留标题、短链和原始文案。')
  }
  if (message.msg_type === 'link' && platformInfo.name && !platformInfo.contentId) {
    hints.push('平台已经识别出来了，但还没有提取到内容 ID，后续可以继续补抓。')
  }
  if (analysis && projectName) {
    hints.push('摘要和项目都已经齐了，这条消息适合继续沉淀进知识库。')
  }

  return hints.slice(0, 3)
}

Page({
  data: {
    msg: null,
    analysis: null,
    tags: [],
    projects: [],
    projectName: '',
    projectColor: '#2f6b5f',
    typeLabel: '',
    displayTime: '',
    summaryText: '',
    confidenceText: '未提供',
    modelText: '未记录',
    statusLabel: '待分析',
    statusTone: 'pending',
    statusHint: '',
    snapshotCards: [],
    platformInfo: {
      show: false,
    },
    contentSections: [],
    actionHints: [],
    rawJson: '',
    rawExpanded: false,
    showProjectSheet: false,
    showEditDialog: false,
    editText: '',
    error: '',
  },

  onLoad(options) {
    if (options.msgid) {
      this.load(options.msgid)
      return
    }
    this.setData({ error: '缺少消息 ID' })
  },

  load(msgid) {
    wx.showLoading({ title: '加载中' })
    Promise.all([api.fetchMessage(msgid), api.fetchProjects()]).then(([detail, projects]) => {
      wx.hideLoading()
      if (detail.error) {
        this.setData({ error: detail.error })
        return
      }

      const message = detail.message || {}
      const analysis = detail.analysis
        ? {
            ...detail.analysis,
            summary: detail.analysis.summary || detail.analysis.desc || '',
            desc: detail.analysis.summary || detail.analysis.desc || '',
          }
        : null

      let tags = []
      try {
        if (analysis && analysis.tags) {
          tags = typeof analysis.tags === 'string' ? JSON.parse(analysis.tags) : analysis.tags
        }
      } catch (error) {
        tags = []
      }

      const project = (projects || []).find((item) => item.id === message.project_id)
      const projectName = project ? project.name : ''
      const projectColor = project && project.color ? project.color : '#2f6b5f'
      const typeLabel = getTypeLabel(message.msg_type)
      const displayTime = formatDisplayTime(message.send_time)
      const summaryText = analysis && analysis.summary
        ? analysis.summary
        : '这条消息还没有形成摘要，你可以重新分析，或者手动补一段更明确的描述。'
      const confidenceText = analysis && analysis.confidence != null
        ? `${Math.round(analysis.confidence * 100)}%`
        : '未提供'
      const modelText = analysis && analysis.model_used ? analysis.model_used : '未记录'
      const platformInfo = buildPlatformInfo(message)
      const statusCard = buildStatusCard(message, analysis, projectName)

      this.setData({
        msg: detail,
        analysis,
        tags,
        projects,
        projectName,
        projectColor,
        typeLabel,
        displayTime,
        summaryText,
        confidenceText,
        modelText,
        statusLabel: statusCard.label,
        statusTone: statusCard.tone,
        statusHint: statusCard.hint,
        snapshotCards: buildSnapshotCards(message, analysis, platformInfo, projectName, confidenceText, modelText, displayTime),
        platformInfo,
        contentSections: buildContentSections(message, analysis, platformInfo),
        actionHints: buildActionHints(message, analysis, platformInfo, projectName),
        rawJson: this.prettyRawJson(message.raw_content),
        rawExpanded: false,
        error: '',
      })
    }).catch((error) => {
      wx.hideLoading()
      this.setData({ error: error.message || '加载失败' })
    })
  },

  prettyRawJson(rawContent) {
    if (!rawContent) return '{}'
    try {
      return JSON.stringify(JSON.parse(rawContent), null, 2)
    } catch (error) {
      return rawContent
    }
  },

  copyValue(e) {
    const value = e.currentTarget.dataset.value || ''
    wx.setClipboardData({ data: String(value) })
  },

  copySummary() {
    wx.setClipboardData({ data: this.data.summaryText || '' })
  },

  copyStructuredContent() {
    const sectionText = (this.data.contentSections || []).map((section) => {
      const items = (section.items || []).map((item) => `${item.label}: ${item.value}`).join('\n')
      return `${section.title}\n${items}`
    }).join('\n\n')

    wx.setClipboardData({ data: sectionText || this.data.summaryText || '' })
  },

  toggleRaw() {
    this.setData({ rawExpanded: !this.data.rawExpanded })
  },

  goBack() {
    wx.navigateBack()
  },

  editDesc() {
    this.setData({
      showEditDialog: true,
      editText: (this.data.analysis && (this.data.analysis.summary || this.data.analysis.desc)) || '',
    })
  },

  onEditInput(e) {
    this.setData({ editText: e.detail.value || '' })
  },

  cancelEdit() {
    this.setData({ showEditDialog: false, editText: '' })
  },

  saveDesc() {
    const desc = this.data.editText.trim()
    if (!desc) {
      wx.showToast({ title: '描述不能为空', icon: 'none' })
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
    if (!e.detail.visible) {
      this.setData({ showProjectSheet: false })
    }
  },

  selectProject(e) {
    const projectId = Number(e.currentTarget.dataset.pid)
    api.setProject(this.data.msg.message.msgid, projectId).then(() => {
      wx.showToast({ title: '已归档到项目', icon: 'success' })
      this.setData({ showProjectSheet: false })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.showToast({ title: error.message || '归档失败', icon: 'none' })
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

  reanalyze() {
    wx.showLoading({ title: '分析中' })
    api.reanalyze(this.data.msg.message.msgid).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '分析完成', icon: 'success' })
      this.load(this.data.msg.message.msgid)
    }).catch((error) => {
      wx.hideLoading()
      wx.showToast({ title: error.message || '分析失败', icon: 'none' })
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
