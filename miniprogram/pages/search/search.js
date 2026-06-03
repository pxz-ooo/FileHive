const api = require('../../utils/api')

const TYPE_META = {
  all: { label: '全部类型', icon: 'text.svg' },
  text: { label: '文字', icon: 'text.svg' },
  link: { label: '链接', icon: 'link.svg' },
  image: { label: '图片', icon: 'image.svg' },
  file: { label: '文件', icon: 'file.svg' },
  video: { label: '视频', icon: 'image.svg' },
}

const TYPE_OPTIONS = ['all', 'text', 'link', 'image', 'file', 'video']

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
    const preferred = value.summary || value.desc || value.title || value.content || value.value || ''
    if (preferred) return sanitizeText(preferred)
    try {
      return JSON.stringify(value)
    } catch (error) {
      return ''
    }
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

function getTypeLabel(type) {
  return (TYPE_META[type] || TYPE_META.text).label
}

function getTypeIcon(type) {
  return `/images/icons/${(TYPE_META[type] || TYPE_META.text).icon}`
}

function formatDisplayTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now - date

  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (diff < 172800000) return '昨天'
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getPreview(rawContent, msgType) {
  const data = parseRawContent(rawContent)
  if (msgType === 'text') return sanitizeText(data.text && data.text.content) || '文本消息'
  if (msgType === 'link') return sanitizeText(data.link && (data.link.desc || data.link.title || data.link.url)) || '链接消息'
  if (msgType === 'file') return sanitizeText(data.file && (data.file.title || data.file.filename || data.file.content)) || '文件消息'
  if (msgType === 'image') return sanitizeText(data.image && (data.image.title || data.image.content || data.image.filename)) || '图片消息'
  if (msgType === 'video') return sanitizeText(data.video && (data.video.content || data.video.filename)) || '视频消息'
  return '查看详情内容'
}

function decorateTypeOptions(selectedType) {
  return TYPE_OPTIONS.map((type) => ({
    value: type,
    label: getTypeLabel(type),
    active: type === selectedType,
  }))
}

function decorateProjects(projects, selectedProject) {
  return (projects || []).map((item) => ({
    ...item,
    active: String(item.id) === String(selectedProject),
  }))
}

function decorateResults(results, projects) {
  return (results || []).map((item) => {
    const message = item.message || {}
    const analysis = item.analysis || {}
    const project = (projects || []).find((projectItem) => String(projectItem.id) === String(message.project_id))

    return {
      ...item,
      msgid: message.msgid || '',
      displayIcon: getTypeIcon(message.msg_type),
      displaySummary: sanitizeText(analysis.summary || analysis.desc) || '等待分析...',
      displayCategory: sanitizeText(analysis.category) || '待分析',
      displayPreview: getPreview(message.raw_content, message.msg_type),
      displayTime: formatDisplayTime(message.send_time),
      displayTypeLabel: getTypeLabel(message.msg_type),
      displayProjectName: sanitizeText(project ? project.name : ''),
    }
  })
}

Page({
  data: {
    keyword: '',
    results: [],
    total: 0,
    searched: false,
    categories: [],
    projects: [],
    currentCategory: 'all',
    currentType: 'all',
    currentProject: 'all',
    timeGroup: 'all',
    recentKeywords: [],
    typeOptions: decorateTypeOptions('all'),
  },

  onLoad(options) {
    const nextState = {
      keyword: options.keyword ? decodeURIComponent(options.keyword) : '',
      currentCategory: options.category && options.category !== 'all' ? decodeURIComponent(options.category) : 'all',
      currentType: options.msgType || 'all',
      currentProject: options.projectId || 'all',
      timeGroup: options.timeGroup || 'all',
    }

    this.setData(nextState)
    this.loadFilters().then(() => {
      if (nextState.keyword) {
        this.doSearch()
      }
    })
    this.setData({ recentKeywords: wx.getStorageSync('recentKeywords') || [] })
  },

  loadFilters() {
    return Promise.allSettled([api.fetchCategories(), api.fetchProjects()]).then(([categoriesResult, projectsResult]) => {
      const nextData = {}
      if (categoriesResult.status === 'fulfilled') nextData.categories = categoriesResult.value || []
      if (projectsResult.status === 'fulfilled') nextData.projects = decorateProjects(projectsResult.value || [], this.data.currentProject)
      nextData.typeOptions = decorateTypeOptions(this.data.currentType)
      this.setData(nextData)
    })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value || '' })
  },

  doSearch() {
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入关键词', icon: 'none' })
      return
    }

    const params = { q: keyword }
    if (this.data.currentCategory !== 'all') params.category = this.data.currentCategory
    if (this.data.currentType !== 'all') params.msg_type = this.data.currentType
    if (this.data.currentProject !== 'all') params.project_id = Number(this.data.currentProject)
    if (this.data.timeGroup !== 'all') params.time_group = this.data.timeGroup

    wx.showLoading({ title: '搜索中' })
    api.searchMessages(params).then((result) => {
      this.setData({
        results: decorateResults(result.items || [], this.data.projects),
        total: result.total || 0,
        searched: true,
      })
      this.persistRecentKeyword(keyword)
      wx.hideLoading()
    }).catch((error) => {
      wx.hideLoading()
      wx.showToast({ title: error.message || '搜索失败', icon: 'none' })
    })
  },

  persistRecentKeyword(keyword) {
    const recent = [keyword].concat(this.data.recentKeywords.filter((item) => item !== keyword)).slice(0, 6)
    this.setData({ recentKeywords: recent })
    wx.setStorageSync('recentKeywords', recent)
  },

  useRecentKeyword(e) {
    const keyword = e.currentTarget.dataset.keyword || ''
    this.setData({ keyword })
    this.doSearch()
  },

  selectCategory(e) {
    this.setData({ currentCategory: e.currentTarget.dataset.category || 'all' })
  },

  selectType(e) {
    const currentType = e.currentTarget.dataset.type || 'all'
    this.setData({
      currentType,
      typeOptions: decorateTypeOptions(currentType),
    })
  },

  selectProject(e) {
    const currentProject = String(e.currentTarget.dataset.projectid || 'all')
    this.setData({
      currentProject,
      projects: decorateProjects(this.data.projects, currentProject),
    })
  },

  selectTime(e) {
    this.setData({ timeGroup: e.currentTarget.dataset.time || 'all' })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/message-detail/detail?msgid=${e.currentTarget.dataset.msgid}` })
  },

  goBack() {
    wx.navigateBack()
  },
})
