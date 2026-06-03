const fs = wx.getFileSystemManager()

const ROOT_DIR = `${wx.env.USER_DATA_PATH}/wechat-organizer`
const EXPORT_DIR = `${ROOT_DIR}/exports`
const ENTRIES_FILE = `${ROOT_DIR}/entries.json`
const PROJECTS_FILE = `${ROOT_DIR}/projects.json`
const CATEGORIES_FILE = `${ROOT_DIR}/categories.json`

const DEFAULT_CATEGORIES = ['工作', '学习', '生活', '通知', '杂记', '娱乐', '其他']
const PROJECT_COLORS = ['#2f6b5f', '#c78c3b', '#7a5cfa', '#d35d47', '#1f7a8c', '#6b8e23']

let initPromise = null

function ensureDir(dirPath) {
  return new Promise((resolve, reject) => {
    fs.mkdir({
      dirPath,
      recursive: true,
      success: resolve,
      fail: (error) => {
        if (error && /file already exists/i.test(error.errMsg || '')) {
          resolve()
          return
        }
        reject(error)
      },
    })
  })
}

function readFile(filePath, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding,
      success: (result) => resolve(result.data),
      fail: reject,
    })
  })
}

function writeFile(filePath, data, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data,
      encoding,
      success: resolve,
      fail: reject,
    })
  })
}

function readJson(filePath, fallbackValue) {
  return readFile(filePath).then((content) => {
    try {
      return JSON.parse(content)
    } catch (error) {
      return fallbackValue
    }
  }).catch(() => fallbackValue)
}

function writeJson(filePath, value) {
  return writeFile(filePath, JSON.stringify(value, null, 2))
}

function saveFile(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: (result) => resolve(result.savedFilePath),
      fail: reject,
    })
  })
}

function removeSavedFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve()
      return
    }
    wx.removeSavedFile({
      filePath,
      success: resolve,
      fail: () => resolve(),
    })
  })
}

function getSavedFileInfo(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve({ size: 0, createTime: 0 })
      return
    }
    wx.getSavedFileInfo({
      filePath,
      success: (result) => resolve(result),
      fail: () => resolve({ size: 0, createTime: 0 }),
    })
  })
}

function inferExtension(filePath = '', fallback = '') {
  const normalized = String(filePath || fallback || '')
  const match = normalized.match(/\.([A-Za-z0-9]+)$/)
  return match ? match[1].toLowerCase() : ''
}

function buildRawContentForText(content, msgType) {
  if (msgType === 'link') {
    const urlMatch = String(content || '').match(/https?:\/\/[^\s]+/i)
    return JSON.stringify({
      msgtype: 'link',
      link: {
        title: '',
        desc: '',
        url: urlMatch ? urlMatch[0] : '',
        raw_text: content,
      },
    })
  }
  return JSON.stringify({
    msgtype: 'text',
    text: { content },
  })
}

function buildRawContentForFile(msgType, payload) {
  if (msgType === 'image') {
    return JSON.stringify({
      msgtype: 'image',
      image: payload,
    })
  }
  return JSON.stringify({
    msgtype: 'file',
    file: payload,
  })
}

function makeMessageRecord(entry) {
  return {
    msgid: entry.msgid,
    msg_type: entry.msg_type,
    open_kfid: 'local',
    external_userid: null,
    send_time: entry.send_time,
    origin: 3,
    raw_content: entry.raw_content,
    id: entry.id,
    project_id: entry.project_id || null,
    created_at: entry.created_at,
  }
}

function makeAnalysisRecord(entry) {
  if (!entry.analysis) return null
  return {
    category: entry.analysis.category || '其他',
    summary: entry.analysis.summary || entry.analysis.desc || '',
    desc: entry.analysis.summary || entry.analysis.desc || '',
    confidence: entry.analysis.confidence == null ? null : entry.analysis.confidence,
    model_used: entry.analysis.model_used || 'local',
  }
}

function nowTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function nowIsoString() {
  return new Date().toISOString().slice(0, 19)
}

function nextEntryId(entries) {
  const max = (entries || []).reduce((current, item) => Math.max(current, Number(item.id || 0)), 0)
  return max + 1
}

function nextProjectId(projects) {
  const max = (projects || []).reduce((current, item) => Math.max(current, Number(item.id || 0)), 0)
  return max + 1
}

function createMsgId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function pickProjectColor(projects) {
  return PROJECT_COLORS[(projects || []).length % PROJECT_COLORS.length]
}

function decorateProjects(projects, entries) {
  return (projects || []).map((project) => ({
    ...project,
    msg_count: (entries || []).filter((entry) => String(entry.project_id || '') === String(project.id)).length,
  }))
}

function readTextSnippet(filePath, extension) {
  const readableExtensions = ['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'xml']
  if (!readableExtensions.includes(extension)) {
    return Promise.resolve('')
  }
  return readFile(filePath, 'utf8').then((content) => String(content || '').slice(0, 4000)).catch(() => '')
}

async function ensureStore() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDir(ROOT_DIR)
      await ensureDir(EXPORT_DIR)
      const [entries, projects, categories] = await Promise.all([
        readJson(ENTRIES_FILE, null),
        readJson(PROJECTS_FILE, null),
        readJson(CATEGORIES_FILE, null),
      ])
      if (!Array.isArray(entries)) await writeJson(ENTRIES_FILE, [])
      if (!Array.isArray(projects)) await writeJson(PROJECTS_FILE, [])
      if (!Array.isArray(categories)) await writeJson(CATEGORIES_FILE, DEFAULT_CATEGORIES)
    })()
  }
  return initPromise
}

async function readStore() {
  await ensureStore()
  const [entries, projects, categories] = await Promise.all([
    readJson(ENTRIES_FILE, []),
    readJson(PROJECTS_FILE, []),
    readJson(CATEGORIES_FILE, DEFAULT_CATEGORIES),
  ])
  return {
    entries: Array.isArray(entries) ? entries : [],
    projects: Array.isArray(projects) ? projects : [],
    categories: Array.isArray(categories) && categories.length ? categories : DEFAULT_CATEGORIES.slice(),
  }
}

async function writeEntries(entries) {
  await ensureStore()
  await writeJson(ENTRIES_FILE, entries)
}

async function writeProjects(projects) {
  await ensureStore()
  await writeJson(PROJECTS_FILE, projects)
}

async function writeCategories(categories) {
  await ensureStore()
  await writeJson(CATEGORIES_FILE, categories)
}

function applyTimeGroup(entries, timeGroup) {
  if (!timeGroup || timeGroup === 'all') return entries
  const now = new Date()
  let threshold = 0
  if (timeGroup === 'today') {
    threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  } else if (timeGroup === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay() + 1)
    start.setHours(0, 0, 0, 0)
    threshold = Math.floor(start.getTime() / 1000)
  } else if (timeGroup === 'month') {
    threshold = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
  }
  return entries.filter((entry) => Number(entry.send_time || 0) >= threshold)
}

function matchesKeyword(entry, keyword, projects) {
  if (!keyword) return true
  const lower = keyword.toLowerCase()
  const project = (projects || []).find((item) => String(item.id) === String(entry.project_id || ''))
  const haystack = [
    entry.analysis && entry.analysis.summary,
    entry.analysis && entry.analysis.category,
    entry.raw_content,
    entry.title,
    entry.filename,
    entry.ocr_text,
    project && project.name,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(lower)
}

async function listMessages(params = {}) {
  const { entries } = await readStore()
  let filtered = entries.slice()
  if (params.msg_type) filtered = filtered.filter((entry) => entry.msg_type === params.msg_type)
  if (params.category) filtered = filtered.filter((entry) => (entry.analysis && entry.analysis.category) === params.category)
  if (params.project_id != null && params.project_id !== '' && params.project_id !== 'all') {
    filtered = filtered.filter((entry) => String(entry.project_id || '') === String(params.project_id))
  }
  if (params.date_from) filtered = filtered.filter((entry) => Number(entry.send_time || 0) >= Number(params.date_from))
  if (params.date_to) filtered = filtered.filter((entry) => Number(entry.send_time || 0) <= Number(params.date_to))
  filtered = applyTimeGroup(filtered, params.time_group)
  filtered.sort((a, b) => Number(b.send_time || 0) - Number(a.send_time || 0))

  const total = filtered.length
  const offset = Number(params.offset || 0)
  const limit = Number(params.limit || 50)
  const items = filtered.slice(offset, offset + limit).map((entry) => ({
    message: makeMessageRecord(entry),
    analysis: makeAnalysisRecord(entry),
  }))
  return { total, items, offset, limit }
}

async function searchMessages(params = {}) {
  const store = await readStore()
  const q = String(params.q || '').trim()
  let filtered = store.entries.filter((entry) => matchesKeyword(entry, q, store.projects))
  if (params.category) filtered = filtered.filter((entry) => (entry.analysis && entry.analysis.category) === params.category)
  if (params.msg_type) filtered = filtered.filter((entry) => entry.msg_type === params.msg_type)
  if (params.project_id != null && params.project_id !== '' && params.project_id !== 'all') {
    filtered = filtered.filter((entry) => String(entry.project_id || '') === String(params.project_id))
  }
  filtered = applyTimeGroup(filtered, params.time_group)
  filtered.sort((a, b) => Number(b.send_time || 0) - Number(a.send_time || 0))

  const total = filtered.length
  return {
    total,
    items: filtered.map((entry) => ({
      message: makeMessageRecord(entry),
      analysis: makeAnalysisRecord(entry),
    })),
    offset: 0,
    limit: total,
  }
}

async function getMessage(msgid) {
  const { entries } = await readStore()
  const entry = entries.find((item) => item.msgid === msgid)
  if (!entry) return { error: 'not found' }
  return {
    message: makeMessageRecord(entry),
    analysis: makeAnalysisRecord(entry),
  }
}

async function createTextEntry(content, msgType) {
  const store = await readStore()
  const entry = {
    id: nextEntryId(store.entries),
    msgid: createMsgId(msgType === 'link' ? 'link' : 'text'),
    msg_type: msgType,
    send_time: nowTimestamp(),
    created_at: nowIsoString(),
    project_id: null,
    raw_content: buildRawContentForText(content, msgType),
    analysis: null,
    media: [],
  }
  store.entries.unshift(entry)
  await writeEntries(store.entries)
  return entry
}

async function createFileEntry(filePath, msgType) {
  const store = await readStore()
  const savedFilePath = await saveFile(filePath)
  const info = await getSavedFileInfo(savedFilePath)
  const extension = inferExtension(savedFilePath, filePath)
  const filename = savedFilePath.split('/').pop().split('\\').pop()
  const snippet = await readTextSnippet(savedFilePath, extension)
  const mediaId = Date.now()

  const payload = msgType === 'image'
    ? {
        filename,
        title: '',
        content: '',
        ocr_text: '',
        keywords: [],
        local_path: savedFilePath,
      }
    : {
        filename,
        title: '',
        content: '',
        extracted_text: snippet,
        keywords: [],
        local_path: savedFilePath,
      }

  const entry = {
    id: nextEntryId(store.entries),
    msgid: createMsgId(msgType),
    msg_type: msgType,
    send_time: nowTimestamp(),
    created_at: nowIsoString(),
    project_id: null,
    raw_content: buildRawContentForFile(msgType, payload),
    analysis: null,
    media: [{
      id: mediaId,
      media_type: msgType,
      file_format: extension,
      file_size: Number(info.size || 0),
      filename,
      local_path: savedFilePath,
      saved_file_path: savedFilePath,
    }],
  }

  store.entries.unshift(entry)
  await writeEntries(store.entries)
  return entry
}

async function updateEntry(msgid, updater) {
  const store = await readStore()
  const index = store.entries.findIndex((item) => item.msgid === msgid)
  if (index < 0) throw new Error('消息不存在')
  const updated = updater(store.entries[index], store)
  store.entries[index] = updated
  await writeEntries(store.entries)
  return updated
}

async function deleteEntry(msgid) {
  const store = await readStore()
  const entry = store.entries.find((item) => item.msgid === msgid)
  if (!entry) throw new Error('消息不存在')
  await Promise.all((entry.media || []).map((item) => removeSavedFile(item.saved_file_path || item.local_path)))
  await writeEntries(store.entries.filter((item) => item.msgid !== msgid))
}

async function listProjects() {
  const store = await readStore()
  return decorateProjects(store.projects, store.entries)
}

async function createProject(name) {
  const projectName = String(name || '').trim()
  if (!projectName) throw new Error('项目名不能为空')
  const store = await readStore()
  if (store.projects.find((item) => item.name === projectName)) {
    return { projects: decorateProjects(store.projects, store.entries) }
  }
  const nextProjects = store.projects.concat([{
    id: nextProjectId(store.projects),
    name: projectName,
    color: pickProjectColor(store.projects),
    created_at: nowIsoString(),
  }])
  await writeProjects(nextProjects)
  return { projects: decorateProjects(nextProjects, store.entries) }
}

async function setProject(msgid, projectId) {
  const store = await readStore()
  if (!store.projects.find((item) => String(item.id) === String(projectId))) {
    throw new Error('项目不存在')
  }
  await updateEntry(msgid, (entry) => ({ ...entry, project_id: Number(projectId) }))
  return { ok: true, project_id: Number(projectId) }
}

async function removeProject(msgid) {
  await updateEntry(msgid, (entry) => ({ ...entry, project_id: null }))
  return { ok: true }
}

async function listCategories() {
  const { categories } = await readStore()
  return categories
}

async function createCategory(name) {
  const categoryName = String(name || '').trim()
  if (!categoryName) throw new Error('分类名不能为空')
  const store = await readStore()
  const nextCategories = store.categories.includes(categoryName)
    ? store.categories
    : store.categories.concat(categoryName)
  await writeCategories(nextCategories)
  return { categories: nextCategories }
}

async function updateSummary(msgid, summary) {
  const text = String(summary || '').trim()
  if (!text) throw new Error('摘要不能为空')
  const entry = await updateEntry(msgid, (current) => ({
    ...current,
    analysis: {
      category: (current.analysis && current.analysis.category) || '其他',
      summary: text,
      desc: text,
      confidence: current.analysis && current.analysis.confidence != null ? current.analysis.confidence : 0.8,
      model_used: (current.analysis && current.analysis.model_used) || 'local_edit',
    },
  }))
  return { ok: true, summary: entry.analysis.summary, desc: entry.analysis.desc }
}

async function updateCategory(msgid, category) {
  const nextCategory = String(category || '').trim()
  if (!nextCategory) throw new Error('分类不能为空')
  await updateEntry(msgid, (current) => ({
    ...current,
    analysis: {
      category: nextCategory,
      summary: (current.analysis && current.analysis.summary) || '',
      desc: (current.analysis && current.analysis.desc) || '',
      confidence: current.analysis && current.analysis.confidence != null ? current.analysis.confidence : 0.8,
      model_used: (current.analysis && current.analysis.model_used) || 'local_edit',
    },
  }))
  return { ok: true, category: nextCategory }
}

async function getMedia(msgid) {
  const { entries } = await readStore()
  const entry = entries.find((item) => item.msgid === msgid)
  return {
    items: ((entry && entry.media) || []).map((item) => ({
      ...item,
      download_url: item.local_path,
    })),
  }
}

async function getOverview() {
  const store = await readStore()
  const entries = store.entries.slice()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  const weekStart = (() => {
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay() + 1)
    start.setHours(0, 0, 0, 0)
    return Math.floor(start.getTime() / 1000)
  })()

  const categoryMap = {}
  entries.forEach((entry) => {
    const category = (entry.analysis && entry.analysis.category) || '未分类'
    categoryMap[category] = (categoryMap[category] || 0) + 1
  })

  const topCategories = Object.keys(categoryMap)
    .map((name) => ({ name, count: categoryMap[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const activity = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now)
    day.setDate(now.getDate() - offset)
    const key = `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000
    const dayEnd = dayStart + 86400
    activity.push({
      date: key,
      count: entries.filter((entry) => Number(entry.send_time || 0) >= dayStart && Number(entry.send_time || 0) < dayEnd).length,
    })
  }

  return {
    overview: {
      total_messages: entries.length,
      today_messages: entries.filter((entry) => Number(entry.send_time || 0) >= todayStart).length,
      week_messages: entries.filter((entry) => Number(entry.send_time || 0) >= weekStart).length,
      unassigned_project_messages: entries.filter((entry) => !entry.project_id).length,
      pending_analysis_messages: entries.filter((entry) => !entry.analysis || !entry.analysis.summary).length,
      project_count: store.projects.length,
      category_count: store.categories.length,
    },
    top_categories: topCategories,
    project_breakdown: decorateProjects(store.projects, entries).map((item) => ({
      name: item.name,
      color: item.color,
      count: item.msg_count,
    })),
    activity,
  }
}

async function getRuntimeStatus() {
  const store = await readStore()
  const totalSize = store.entries.reduce((sum, entry) => sum + ((entry.media || []).reduce((inner, item) => inner + Number(item.file_size || 0), 0)), 0)
  return {
    storage_mode: 'local_first',
    message_count: store.entries.length,
    project_count: store.projects.length,
    category_count: store.categories.length,
    total_file_size: totalSize,
    root_dir: ROOT_DIR,
  }
}

async function exportIndexFile() {
  const store = await readStore()
  const filePath = `${EXPORT_DIR}/wechat-organizer-index-${Date.now()}.txt`
  const payload = {
    exported_at: new Date().toISOString(),
    categories: store.categories,
    projects: decorateProjects(store.projects, store.entries),
    items: store.entries.map((entry) => ({
      msgid: entry.msgid,
      msg_type: entry.msg_type,
      project_id: entry.project_id || null,
      analysis: entry.analysis || null,
      raw_content: entry.raw_content,
      media: (entry.media || []).map((item) => ({
        filename: item.filename,
        file_format: item.file_format,
        file_size: item.file_size,
      })),
      created_at: entry.created_at,
      send_time: entry.send_time,
    })),
  }
  await writeFile(filePath, JSON.stringify(payload, null, 2))
  return filePath
}

async function exportBundleManifest() {
  const store = await readStore()
  const filePath = `${EXPORT_DIR}/wechat-organizer-bundle-manifest-${Date.now()}.txt`
  const lines = [
    '微信整理助手 - 文件清单',
    `导出时间: ${new Date().toLocaleString()}`,
    '',
  ]
  store.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.msgid} | ${entry.msg_type}`)
    lines.push(`   摘要: ${(entry.analysis && entry.analysis.summary) || ''}`)
    lines.push(`   分类: ${(entry.analysis && entry.analysis.category) || ''}`)
    ;(entry.media || []).forEach((item) => {
      lines.push(`   文件: ${item.filename} (${item.file_format || 'unknown'}, ${item.file_size || 0} bytes)`)
    })
    lines.push('')
  })
  lines.push('说明: 受小程序环境限制，当前导出的是文件清单和索引；原件保留在本地仓库，可逐条打开或转发。')
  await writeFile(filePath, lines.join('\n'))
  return filePath
}

module.exports = {
  ROOT_DIR,
  DEFAULT_CATEGORIES,
  ensureStore,
  readStore,
  listMessages,
  searchMessages,
  getMessage,
  createTextEntry,
  createFileEntry,
  deleteEntry,
  listProjects,
  createProject,
  setProject,
  removeProject,
  listCategories,
  createCategory,
  updateSummary,
  updateCategory,
  getMedia,
  getOverview,
  getRuntimeStatus,
  exportIndexFile,
  exportBundleManifest,
  updateEntry,
  makeMessageRecord,
  makeAnalysisRecord,
}
