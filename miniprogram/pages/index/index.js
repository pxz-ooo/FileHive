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
const PROJECT_FALLBACK_COLORS = ['#2f6b5f', '#c78c3b', '#7a5cfa', '#d35d47', '#1f7a8c', '#6b8e23']
const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
]

function containsUrl(text) {
  return /(https?:\/\/[^\s]+)|((?:www\.|xhslink\.com|b23\.tv|v\.douyin\.com|mp\.weixin\.qq\.com)[^\s]*)/i.test(text || '')
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

function getTypeLabel(type) {
  return (TYPE_META[type] || TYPE_META.text).label
}

function getTypeIcon(type) {
  return `/images/icons/${(TYPE_META[type] || TYPE_META.text).icon}`
}

function getProjectMeta(projects, projectId) {
  if (!projectId) return { name: '', color: '' }
  const found = (projects || []).find((item) => String(item.id) === String(projectId))
  if (found) return { name: found.name || '未命名项目', color: found.color || '' }
  const index = Number(projectId || 0) % PROJECT_FALLBACK_COLORS.length
  return { name: '未命名项目', color: PROJECT_FALLBACK_COLORS[index] }
}

function getMessagePreview(message) {
  if (!message) return ''
  const data = parseRawContent(message.raw_content)
  if (message.msg_type === 'text') return sanitizeText(data.text && data.text.content) || '文本消息'
  if (message.msg_type === 'link') return sanitizeText(data.link && (data.link.desc || data.link.title || data.link.url)) || '链接消息'
  if (message.msg_type === 'file') return sanitizeText(data.file && (data.file.title || data.file.filename || data.file.content)) || '文件消息'
  if (message.msg_type === 'image') return sanitizeText(data.image && (data.image.title || data.image.content || data.image.filename)) || '图片消息'
  if (message.msg_type === 'video') return sanitizeText(data.video && (data.video.content || data.video.filename)) || '视频消息'
  return '查看详情内容'
}

function getLinkDisplayInfo(message, analysis) {
  const data = parseRawContent(message && message.raw_content)
  const link = (data && data.link) || {}
  const platform = sanitizeText(link.platform)
  const title = sanitizeText(link.title || analysis.summary || analysis.desc)
  const desc = sanitizeText(link.desc || link.raw_text || link.url)
  const fallback = sanitizeText(analysis.summary || analysis.desc || desc || title || '链接内容')
  const displaySummary = platform
    ? `${platform} · ${title || desc || '链接内容'}`
    : (title || fallback)
  const displayPreview = desc && desc !== title ? desc : (sanitizeText(link.url) || fallback)
  return {
    displaySummary: sanitizeText(displaySummary) || '链接内容',
    displayPreview: sanitizeText(displayPreview),
  }
}

function decorateTypeOptions(selectedType) {
  return TYPE_OPTIONS.map((type) => ({
    value: type,
    label: getTypeLabel(type),
    active: type === selectedType,
  }))
}

function decorateTimeOptions(selectedTime) {
  return TIME_OPTIONS.map((item) => ({
    ...item,
    active: item.value === selectedTime,
  }))
}

function decorateCategoryOptions(categories, selectedCategory) {
  return (Array.isArray(categories) ? categories : []).map((item) => ({
    value: item,
    label: item,
    active: item === selectedCategory,
  }))
}

function decorateProjects(projects, selectedProjectId) {
  return (projects || []).map((item) => ({
    ...item,
    active: String(item.id) === String(selectedProjectId),
  }))
}

function filterProjects(projects, keyword) {
  const text = (keyword || '').trim().toLowerCase()
  if (!text) return projects || []
  return (projects || []).filter((item) => String(item.name || '').toLowerCase().includes(text))
}

function decorateMessages(items, projects) {
  return (items || []).map((item) => {
    const message = item.message || {}
    const analysis = item.analysis || {}
    const projectMeta = getProjectMeta(projects, message.project_id)
    const linkDisplay = message.msg_type === 'link'
      ? getLinkDisplayInfo(message, analysis)
      : null
    return {
      ...item,
      msgid: message.msgid || '',
      displayIcon: getTypeIcon(message.msg_type),
      displaySummary: (linkDisplay && linkDisplay.displaySummary)
        || sanitizeText(analysis.summary || analysis.desc || getMessagePreview(message))
        || '等待分析...',
      displayPreview: (linkDisplay && linkDisplay.displayPreview) || sanitizeText(getMessagePreview(message)),
      displayCategory: sanitizeText(analysis.category) || '待分类',
      displayTime: formatDisplayTime(message.send_time),
      displayTypeLabel: getTypeLabel(message.msg_type),
      displayProjectName: sanitizeText(projectMeta.name),
      displayProjectColor: projectMeta.color,
    }
  })
}

function decorateActivity(activity) {
  const counts = (activity || []).map((item) => item.count)
  const max = counts.length ? Math.max.apply(null, counts) : 1
  return (activity || []).map((item) => ({
    ...item,
    barHeight: `${18 + Math.round(((max ? item.count / max : 0)) * 28)}px`,
  }))
}

function buildInsightTexts(overview, topCategories) {
  const title = topCategories && topCategories.length
    ? `最活跃分类是「${topCategories[0].name}」`
    : '把零散消息变成有结构的清单'
  const description = overview
    ? `今天新增 ${overview.today_messages} 条，本周累计 ${overview.week_messages} 条`
    : '继续录入、归档和搜索，逐步把消息沉淀成知识库。'
  return { title, description }
}

function hasActiveFilters(state) {
  return state.currentTab !== 'all'
    || state.timeGroup !== 'all'
    || state.projectFilter !== 'all'
    || state.msgTypeFilter !== 'all'
}

Page({
  data: {
    messages: [],
    categories: [],
    projects: [],
    filteredProjects: [],
    overview: null,
    topCategories: [],
    activity: [],
    currentTab: 'all',
    timeGroup: 'all',
    projectFilter: 'all',
    msgTypeFilter: 'all',
    categoryOptions: [],
    timeOptions: decorateTimeOptions('all'),
    typeOptions: decorateTypeOptions('all'),
    inputText: '',
    searchKeyword: '',
    projectSearchKeyword: '',
    showAttach: false,
    sending: false,
    loading: true,
    loadingMore: false,
    offset: 0,
    hasMore: false,
    limit: 20,
    showProjectPicker: false,
    showCategoryDialog: false,
    showProjectDialog: false,
    categoryInput: '',
    projectInput: '',
    selectedProjectLabel: '全部项目',
    insightTitle: '把零散消息变成有结构的清单',
    insightDescription: '继续录入、归档和搜索，逐步把消息沉淀成知识库。',
  },

  onLoad() {
    this.refreshAll()
    this.maybePromptApiKey()
  },

  onShow() {
    if (!this.data.messages.length) {
      this.refreshAll()
      return
    }
    this.refreshOverviewOnly()
  },

  maybePromptApiKey() {
    const app = getApp()
    const hasApiKey = !!((app.globalData && app.globalData.mimoApiKey) || '').trim()
    const hasProxy = !!((app.globalData && app.globalData.aiProxyBaseUrl) || '').trim()
    const dismissed = wx.getStorageSync('apiKeyGuideDismissed')
    if (hasApiKey || hasProxy || dismissed) return
    wx.showModal({
      title: '启用 AI 功能',
      content: '要使用图片 OCR、自动摘要、智能分类等能力，请先在设置页配置默认智能通道，或填写你自己的 MiMo API Key。消息和文件仍然只保存在本地。',
      confirmText: '去设置',
      cancelText: '稍后',
      success: (result) => {
        if (result.confirm) {
          wx.navigateTo({ url: '/pages/settings/settings' })
          return
        }
        wx.setStorageSync('apiKeyGuideDismissed', 1)
      },
    })
  },

  onPullDownRefresh() {
    this.refreshAll()
  },

  onReachBottom() {
    this.loadMore()
  },

  refreshAll() {
    this.setData({ loading: true })
    Promise.allSettled([
      api.fetchCategories(),
      api.fetchProjects(),
      api.fetchOverview(),
    ]).then(([categoriesResult, projectsResult, overviewResult]) => {
      const nextData = {}

      if (categoriesResult.status === 'fulfilled') {
        nextData.categories = categoriesResult.value || []
        nextData.categoryOptions = decorateCategoryOptions(nextData.categories, this.data.currentTab)
      }
      if (projectsResult.status === 'fulfilled') {
        nextData.projects = decorateProjects(projectsResult.value || [], this.data.projectFilter)
        nextData.filteredProjects = filterProjects(nextData.projects, this.data.projectSearchKeyword)
        nextData.selectedProjectLabel = this.getSelectedProjectLabel(nextData.projects, this.data.projectFilter)
      }
      if (overviewResult.status === 'fulfilled') {
        nextData.overview = overviewResult.value.overview || null
        nextData.topCategories = overviewResult.value.top_categories || []
        nextData.activity = decorateActivity(overviewResult.value.activity || [])
        const insightTexts = buildInsightTexts(nextData.overview, nextData.topCategories)
        nextData.insightTitle = insightTexts.title
        nextData.insightDescription = insightTexts.description
      }

      this.setData(nextData)
      return this.loadMessages(true)
    }).catch((error) => {
      this.setData({ loading: false })
      wx.stopPullDownRefresh()
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
    })
  },

  refreshOverviewOnly() {
    api.fetchOverview().then((result) => {
      const overview = result.overview || null
      const topCategories = result.top_categories || []
      const insightTexts = buildInsightTexts(overview, topCategories)
      this.setData({
        overview,
        topCategories,
        activity: decorateActivity(result.activity || []),
        insightTitle: insightTexts.title,
        insightDescription: insightTexts.description,
      })
    }).catch(() => {})
  },

  loadMessages(refresh = false) {
    if (!refresh && (!this.data.hasMore || this.data.loadingMore || this.data.loading)) {
      return Promise.resolve()
    }

    const params = {
      limit: this.data.limit,
      offset: refresh ? 0 : this.data.offset,
      time_group: this.data.timeGroup === 'all' ? '' : this.data.timeGroup,
    }
    if (this.data.currentTab !== 'all') params.category = this.data.currentTab
    if (this.data.projectFilter !== 'all') params.project_id = Number(this.data.projectFilter)
    if (this.data.msgTypeFilter !== 'all') params.msg_type = this.data.msgTypeFilter

    this.setData(refresh ? { loading: true } : { loadingMore: true })

    return api.fetchMessages(params).then((result) => {
      const items = result.items || []
      const total = result.total || 0
      if (refresh && total === 0 && this.data.overview && this.data.overview.total_messages > 0 && hasActiveFilters(this.data)) {
        this.resetFilters(() => this.loadMessages(true))
        return
      }

      const merged = refresh ? items : this.data.messages.concat(items)
      const decoratedMessages = decorateMessages(merged, this.data.projects)
      this.setData({
        messages: decoratedMessages,
        hasMore: decoratedMessages.length < total,
        loading: false,
        loadingMore: false,
        offset: decoratedMessages.length,
      })
    }).catch((error) => {
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
    }).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  resetFilters(callback) {
    const projects = decorateProjects(this.data.projects, 'all')
    this.setData({
      currentTab: 'all',
      timeGroup: 'all',
      projectFilter: 'all',
      msgTypeFilter: 'all',
      categoryOptions: decorateCategoryOptions(this.data.categories, 'all'),
      timeOptions: decorateTimeOptions('all'),
      typeOptions: decorateTypeOptions('all'),
      projects,
      filteredProjects: filterProjects(projects, this.data.projectSearchKeyword),
      selectedProjectLabel: '全部项目',
      offset: 0,
    }, callback)
  },

  loadMore() {
    this.loadMessages(false)
  },

  selectCategory(e) {
    const category = e.currentTarget.dataset.category
    if (!category || category === this.data.currentTab) return
    this.setData({
      currentTab: category,
      categoryOptions: decorateCategoryOptions(this.data.categories, category),
      offset: 0,
    }, () => this.loadMessages(true))
  },

  openCategoryDialog() {
    this.setData({ showCategoryDialog: true, categoryInput: '' })
  },

  closeCategoryDialog() {
    this.setData({ showCategoryDialog: false, categoryInput: '' })
  },

  onCategoryInput(e) {
    this.setData({ categoryInput: e.detail.value || '' })
  },

  confirmCreateCategory() {
    const name = this.data.categoryInput.trim()
    if (!name) {
      wx.showToast({ title: '请输入分类名', icon: 'none' })
      return
    }
    api.createCategory(name).then((result) => {
      const categories = result.categories || this.data.categories
      this.setData({
        categories,
        categoryOptions: decorateCategoryOptions(categories, name),
        currentTab: name,
        showCategoryDialog: false,
        categoryInput: '',
      }, () => {
        this.refreshOverviewOnly()
        this.loadMessages(true)
      })
      wx.showToast({ title: '分类已添加', icon: 'success' })
    }).catch((error) => {
      wx.showToast({ title: error.message || '创建失败', icon: 'none' })
    })
  },

  setTime(e) {
    const timeGroup = e.currentTarget.dataset.time || 'all'
    if (timeGroup === this.data.timeGroup) return
    this.setData({
      timeGroup,
      timeOptions: decorateTimeOptions(timeGroup),
      offset: 0,
    }, () => this.loadMessages(true))
  },

  setTypeFilter(e) {
    const msgTypeFilter = e.currentTarget.dataset.type || 'all'
    if (msgTypeFilter === this.data.msgTypeFilter) return
    this.setData({
      msgTypeFilter,
      typeOptions: decorateTypeOptions(msgTypeFilter),
      offset: 0,
    }, () => this.loadMessages(true))
  },

  openProjectPanel() {
    api.fetchProjects().then((projects) => {
      const decoratedProjects = decorateProjects(projects, this.data.projectFilter)
      this.setData({
        projects: decoratedProjects,
        filteredProjects: filterProjects(decoratedProjects, ''),
        projectSearchKeyword: '',
        selectedProjectLabel: this.getSelectedProjectLabel(projects, this.data.projectFilter),
        showProjectPicker: true,
      })
    }).catch(() => {
      this.setData({ showProjectPicker: true })
    })
  },

  closeProjectPicker() {
    this.setData({ showProjectPicker: false })
  },

  onProjectPickerClose(e) {
    if (!e.detail.visible) {
      this.setData({ showProjectPicker: false })
    }
  },

  onProjectSearchInput(e) {
    const projectSearchKeyword = e.detail.value || ''
    this.setData({
      projectSearchKeyword,
      filteredProjects: filterProjects(this.data.projects, projectSearchKeyword),
    })
  },

  clearProjectFilter() {
    if (this.data.projectFilter === 'all') {
      this.setData({ showProjectPicker: false })
      return
    }
    const projects = decorateProjects(this.data.projects, 'all')
    this.setData({
      projectFilter: 'all',
      projects,
      filteredProjects: filterProjects(projects, this.data.projectSearchKeyword),
      selectedProjectLabel: '全部项目',
      showProjectPicker: false,
      offset: 0,
    }, () => this.loadMessages(true))
  },

  selectProjectFilter(e) {
    const projectId = String(e.currentTarget.dataset.projectid)
    if (!projectId || projectId === this.data.projectFilter) {
      this.setData({ showProjectPicker: false })
      return
    }
    const projects = decorateProjects(this.data.projects, projectId)
    this.setData({
      projectFilter: projectId,
      projects,
      filteredProjects: filterProjects(projects, this.data.projectSearchKeyword),
      selectedProjectLabel: this.getSelectedProjectLabel(this.data.projects, projectId),
      showProjectPicker: false,
      offset: 0,
    }, () => this.loadMessages(true))
  },

  openProjectDialog() {
    this.setData({ showProjectPicker: false, showProjectDialog: true, projectInput: '' })
  },

  closeProjectDialog() {
    this.setData({ showProjectDialog: false, projectInput: '' })
  },

  onProjectInput(e) {
    this.setData({ projectInput: e.detail.value || '' })
  },

  confirmCreateProject() {
    const name = this.data.projectInput.trim()
    if (!name) {
      wx.showToast({ title: '请输入项目名', icon: 'none' })
      return
    }
    api.createProject(name).then(() => {
      return api.fetchProjects().then((projects) => {
        const matched = projects.find((item) => item.name === name)
        const projectFilter = matched ? String(matched.id) : this.data.projectFilter
        const decoratedProjects = decorateProjects(projects, projectFilter)
        this.setData({
          projects: decoratedProjects,
          filteredProjects: filterProjects(decoratedProjects, this.data.projectSearchKeyword),
          projectFilter,
          selectedProjectLabel: this.getSelectedProjectLabel(projects, projectFilter),
          showProjectDialog: false,
          projectInput: '',
        }, () => {
          this.refreshOverviewOnly()
          this.loadMessages(true)
        })
        wx.showToast({ title: '项目已创建', icon: 'success' })
      })
    }).catch((error) => {
      wx.showToast({ title: error.message || '创建失败', icon: 'none' })
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/message-detail/detail?msgid=${e.currentTarget.dataset.msgid}` })
  },

  goSearch() {
    wx.navigateTo({
      url: `/pages/search/search?keyword=${encodeURIComponent(this.data.searchKeyword || '')}&category=${encodeURIComponent(this.data.currentTab)}&timeGroup=${this.data.timeGroup}&msgType=${this.data.msgTypeFilter}&projectId=${this.data.projectFilter}`,
    })
  },

  submitSearch() {
    this.goSearch()
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value || '' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  goLinkSupport() {
    wx.navigateTo({ url: '/pages/link-support/index' })
  },

  onInput(e) {
    const nextValue = e && e.detail && Object.prototype.hasOwnProperty.call(e.detail, 'value')
      ? e.detail.value
      : (typeof e.detail === 'string' ? e.detail : '')
    this.setData({ inputText: String(nextValue || '') })
  },

  toggleAttach() {
    this.setData({ showAttach: !this.data.showAttach })
  },

  sendText() {
    const text = this.data.inputText.trim()
    if (!text || this.data.sending) return
    this.setData({ sending: true })
    api.submitText(text, containsUrl(text) ? 'link' : 'text')
      .then(() => {
        this.setData({ inputText: '', showAttach: false })
        wx.showToast({ title: '已加入收件箱', icon: 'success' })
        this.refreshAll()
      })
      .catch((error) => wx.showToast({ title: error.message || '发送失败', icon: 'none' }))
      .finally(() => this.setData({ sending: false }))
  },

  chooseImage() {
    this.setData({ showAttach: false })
    wx.chooseImage({
      count: 1,
      success: (result) => this.uploadAndSend(result.tempFilePaths[0], 'image'),
    })
  },

  chooseFile() {
    this.setData({ showAttach: false })
    wx.chooseMessageFile({
      count: 5,
      type: 'file',
      extension: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'zip', 'rar', '7z'],
      success: (result) => {
        const tempFiles = (result.tempFiles || []).map((item) => item.path).filter(Boolean)
        this.uploadMany(tempFiles, 'file')
      },
    })
  },

  uploadAndSend(path, type) {
    this.setData({ sending: true })
    api.uploadFile(path, type).then(() => {
      wx.showToast({ title: '素材已入库', icon: 'success' })
      this.refreshAll()
    }).catch((error) => {
      wx.showToast({ title: error.message || '上传失败', icon: 'none' })
    }).finally(() => this.setData({ sending: false }))
  },

  uploadMany(paths, type) {
    const queue = Array.isArray(paths) ? paths.filter(Boolean) : []
    if (!queue.length) return
    this.setData({ sending: true })
    let completed = 0

    const runNext = () => {
      const nextPath = queue.shift()
      if (!nextPath) {
        wx.showToast({ title: `已导入 ${completed} 个文件`, icon: 'success' })
        this.refreshAll()
        this.setData({ sending: false })
        return
      }

      api.uploadFile(nextPath, type).then(() => {
        completed += 1
        runNext()
      }).catch((error) => {
        wx.showToast({ title: error.message || '上传失败', icon: 'none' })
        this.setData({ sending: false })
      })
    }

    runNext()
  },

  getSelectedProjectLabel(projects, projectFilter) {
    if (projectFilter === 'all') return '全部项目'
    const found = (projects || []).find((item) => String(item.id) === String(projectFilter))
    return found ? found.name : '全部项目'
  },
})
