const app = getApp()
const store = require('./local-store')

const MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1'
const MIMO_FALLBACK_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1'
const MIMO_MODEL = 'mimo-v2.5'
const SILICONFLOW_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct'
const PROXY_CHAT_PATH = '/api/ai/chat'
const PROXY_HEALTH_PATH = '/api/ai/health'
const LINK_PARSE_PATH = '/api/link/parse'

function getAiProviderMode() {
  return (app.globalData && app.globalData.aiProviderMode) || 'siliconflow_proxy'
}

function getProxyBaseUrl() {
  return String((app.globalData && app.globalData.aiProxyBaseUrl) || '').trim().replace(/\/+$/, '')
}

function getSiliconflowApiKey() {
  const raw = (app.globalData && app.globalData.siliconflowApiKey) || ''
  return String(raw).replace(/^Bearer\s+/i, '').trim()
}

function getMimoApiKey() {
  const raw = (app.globalData && app.globalData.mimoApiKey) || ''
  return String(raw).replace(/^Bearer\s+/i, '').trim()
}

function getMimoBaseUrlCandidates() {
  return [MIMO_BASE_URL, MIMO_FALLBACK_BASE_URL]
}

function parseJson(text, fallback = {}) {
  try {
    return JSON.parse(text)
  } catch (error) {
    return fallback
  }
}

function normalizeResponseData(data) {
  if (typeof data === 'string') return parseJson(data, data)
  return data || {}
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

function getCategories() {
  return store.listCategories().catch(() => store.DEFAULT_CATEGORIES.slice())
}

function requestJson({ url, method = 'GET', header = {}, data = null }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      header,
      data,
      success: (response) => {
        const body = normalizeResponseData(response.data)
        if (response.statusCode >= 400) {
          const detail = (body && body.error && body.error.message) || (body && body.message) || `请求失败 (${response.statusCode})`
          const error = new Error(detail)
          error.statusCode = response.statusCode
          error.responseData = body
          reject(error)
          return
        }
        resolve({ statusCode: response.statusCode, data: body, headers: response.header || {} })
      },
      fail: (error) => reject(new Error((error && error.errMsg) || '网络请求失败')),
    })
  })
}

function requestProxy(payload) {
  const baseUrl = getProxyBaseUrl()
  if (!baseUrl) return Promise.reject(new Error('默认智能通道地址未内置'))
  const siliconflowApiKey = getSiliconflowApiKey()
  const header = {
    'content-type': 'application/json',
    'x-filehive-client': 'miniprogram',
  }
  if (siliconflowApiKey) header['x-siliconflow-api-key'] = siliconflowApiKey

  return requestJson({
    url: `${baseUrl}${PROXY_CHAT_PATH}`,
    method: 'POST',
    header,
    data: payload,
  }).then((result) => ({
    provider: siliconflowApiKey ? 'siliconflow_user_key_via_proxy' : 'siliconflow_proxy',
    model: (result.data && result.data.model) || SILICONFLOW_MODEL,
    data: result.data,
  }))
}

function requestMimoOnce(baseUrl, payload, apiKey) {
  return requestJson({
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    header: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    data: payload,
  }).then((result) => ({
    provider: 'mimo_direct',
    model: (result.data && result.data.model) || MIMO_MODEL,
    data: result.data,
  }))
}

async function requestMimo(payload) {
  const apiKey = getMimoApiKey()
  if (!apiKey) throw new Error('请先填写并保存 MiMo API Key')

  let lastError = null
  for (const baseUrl of getMimoBaseUrlCandidates()) {
    try {
      return await requestMimoOnce(baseUrl, payload, apiKey)
    } catch (error) {
      lastError = error
      if (Number(error.statusCode || 0) === 401) break
    }
  }
  throw lastError || new Error('MiMo 请求失败')
}

async function requestAI(payload) {
  const mode = getAiProviderMode()
  const hasProxy = !!getProxyBaseUrl()
  const hasMimo = !!getMimoApiKey()

  if (mode === 'mimo_direct') {
    if (hasMimo) {
      try {
        return await requestMimo(payload)
      } catch (error) {
        if (!hasProxy) throw error
      }
    }
    if (hasProxy) return requestProxy(payload)
    throw new Error('请先填写 MiMo API Key')
  }

  if (hasProxy) {
    try {
      return await requestProxy(payload)
    } catch (error) {
      if (!hasMimo) throw error
    }
  }
  if (hasMimo) return requestMimo(payload)
  throw new Error('默认智能通道不可用，请填写 MiMo API Key 作为备用')
}

function normalizeAnalysis(result, fallbackCategory = '其他', fallbackSummary = '') {
  return {
    category: sanitizeText(result.category || fallbackCategory) || fallbackCategory,
    summary: sanitizeText(result.summary || result.desc || fallbackSummary),
    desc: sanitizeText(result.summary || result.desc || fallbackSummary),
    confidence: result.confidence == null ? 0.86 : result.confidence,
    model_used: result.model_used || result.model || MIMO_MODEL,
  }
}

function simpleFallbackForText(text, msgType) {
  const content = String(text || '').trim()
  if (msgType === 'link') return normalizeAnalysis({ category: '杂记', summary: content.slice(0, 42) || '链接内容', model_used: 'local_rule' }, '杂记', '链接内容')
  if (content.includes('会议') || content.includes('项目') || content.includes('需求')) {
    return normalizeAnalysis({ category: '工作', summary: content.slice(0, 42), model_used: 'local_rule' }, '工作', content.slice(0, 42))
  }
  return normalizeAnalysis({ category: '杂记', summary: content.slice(0, 42) || '文本内容', model_used: 'local_rule' }, '杂记', '文本内容')
}

function extractFirstUrl(text) {
  const match = String(text || '').match(/(https?:\/\/[^\s]+)|((?:www\.|xhslink\.com|b23\.tv|v\.douyin\.com|mp\.weixin\.qq\.com)[^\s]*)/i)
  if (!match) return ''
  const candidate = match[0]
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate.replace(/^\/+/, '')}`
}

function buildLinkAnalysisPayload(rawText, parseResult) {
  const lines = [`分享文案: ${sanitizeText(rawText)}`]
  if (parseResult && parseResult.ok) {
    if (parseResult.platform) lines.push(`平台: ${sanitizeText(parseResult.platform)}`)
    if (parseResult.title) lines.push(`标题: ${sanitizeText(parseResult.title)}`)
    if (parseResult.desc) lines.push(`摘要: ${sanitizeText(parseResult.desc)}`)
    if (parseResult.author && parseResult.author.name) lines.push(`作者: ${sanitizeText(parseResult.author.name)}`)
    if (parseResult.type) lines.push(`内容类型: ${sanitizeText(parseResult.type)}`)
    if (parseResult.sourceUrl) lines.push(`原始链接: ${sanitizeText(parseResult.sourceUrl)}`)
    if (parseResult.mediaUrl) lines.push(`提取媒体地址: ${sanitizeText(parseResult.mediaUrl)}`)
  }
  return lines.filter(Boolean).join('\n')
}

function buildLinkRawContent(rawText, parseResult) {
  const normalized = parseResult && typeof parseResult === 'object' ? parseResult : {}
  return JSON.stringify({
    msgtype: 'link',
    link: {
      title: sanitizeText(normalized.title || ''),
      desc: sanitizeText(normalized.desc || ''),
      url: sanitizeText(normalized.sourceUrl || extractFirstUrl(rawText) || ''),
      raw_text: sanitizeText(rawText || ''),
      platform: sanitizeText(normalized.platform || ''),
      type: sanitizeText(normalized.type || ''),
      parser: sanitizeText(normalized.parser || ''),
      parser_message: sanitizeText(normalized.message || ''),
      media_url: sanitizeText(normalized.mediaUrl || ''),
      cover: sanitizeText(normalized.cover || ''),
      author: sanitizeText(normalized.author && normalized.author.name),
      images: Array.isArray(normalized.images) ? normalized.images.filter(Boolean) : [],
      music: normalized.music || null,
    },
  })
}

function readFileBase64(filePath) {
  const fs = wx.getFileSystemManager()
  return new Promise((resolve, reject) => {
    fs.readFile({ filePath, encoding: 'base64', success: (result) => resolve(result.data), fail: reject })
  })
}

function inferMime(filePath) {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

async function analyzeTextContent(content, msgType, guidance = '') {
  const categories = await getCategories()
  const prompt = [
    '你是一个微信整理助手，请把用户刚保存的内容整理成可检索条目。',
    `可用分类: ${categories.join('、')}`,
    '请输出 JSON，格式为 {"category":"分类","summary":"一句摘要","usage":"适合用在什么地方"}',
    msgType === 'link' ? '这是一段分享文案或链接，优先理解它适合归到什么主题。' : '这是一段文本内容，请给出简短摘要和归类。',
    guidance ? `用户补充意见: ${guidance}` : '',
    `原始内容: ${content}`,
  ].filter(Boolean).join('\n')

  try {
    const response = await requestAI({
      model: getAiProviderMode() === 'mimo_direct' ? MIMO_MODEL : SILICONFLOW_MODEL,
      messages: [
        { role: 'system', content: '你需要输出严格 JSON，不要加解释。' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    })
    const contentText = response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content
    const parsed = normalizeAnalysis(parseJson(contentText, {}), '其他', content.slice(0, 42))
    parsed.model_used = response.model || parsed.model_used
    if (!categories.includes(parsed.category)) parsed.category = '其他'
    return parsed
  } catch (error) {
    return simpleFallbackForText(content, msgType)
  }
}

async function analyzeImage(filePath, guidance = '') {
  const categories = await getCategories()
  const base64 = await readFileBase64(filePath)
  const mime = inferMime(filePath)
  const response = await requestAI({
    model: getAiProviderMode() === 'mimo_direct' ? MIMO_MODEL : SILICONFLOW_MODEL,
    messages: [
      {
        role: 'system',
        content: `你是图片整理助手。可用分类: ${categories.join('、')}。输出 JSON: {"category":"分类","summary":"一句摘要","title":"图片命名","content":"图片描述","ocr_text":"图中文字，没有就空字符串","keywords":["词1","词2"]}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: guidance ? `用户补充意见: ${guidance}` : '请识别这张图片，给出适合归档的命名、描述、OCR 和分类。' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  })
  const contentText = response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content
  const parsed = parseJson(contentText, {})
  parsed.model_used = parsed.model_used || response.model || SILICONFLOW_MODEL
  return parsed
}

async function analyzeFileText(filename, extractedText, guidance = '') {
  const categories = await getCategories()
  const prompt = [
    '你是文件整理助手，请根据文件名和可读正文生成归档结果。',
    `可用分类: ${categories.join('、')}`,
    '请输出 JSON: {"category":"分类","summary":"一句摘要","title":"文件命名","content":"文件用途说明","keywords":["词1","词2"]}',
    guidance ? `用户补充意见: ${guidance}` : '',
    `文件名: ${filename}`,
    `提取正文: ${extractedText || '无可读正文'}`,
  ].filter(Boolean).join('\n')

  try {
    const response = await requestAI({
      model: getAiProviderMode() === 'mimo_direct' ? MIMO_MODEL : SILICONFLOW_MODEL,
      messages: [
        { role: 'system', content: '你需要输出严格 JSON，不要加解释。' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    })
    const contentText = response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content
    const parsed = parseJson(contentText, {})
    parsed.model_used = parsed.model_used || response.model || SILICONFLOW_MODEL
    return parsed
  } catch (error) {
    return {
      category: '其他',
      summary: filename || '文件内容',
      title: filename || '文件内容',
      content: extractedText ? extractedText.slice(0, 80) : '本地文件已保存，可后续再补充整理。',
      keywords: [],
      model_used: 'local_rule',
    }
  }
}

async function applyAnalysisToEntry(msgid, analysis, extraMutator) {
  return store.updateEntry(msgid, (entry) => {
    const nextEntry = {
      ...entry,
      analysis: normalizeAnalysis(analysis, analysis.category || '其他', analysis.summary || analysis.desc || ''),
    }
    nextEntry.analysis.model_used = analysis.model_used || nextEntry.analysis.model_used
    return extraMutator ? extraMutator(nextEntry) : nextEntry
  })
}

async function submitText(content, type = 'text') {
  const entry = await store.createTextEntry(content, type)
  if (type === 'link') {
    let parseResult = null
    try {
      parseResult = await parseLink(content)
    } catch (error) {
      parseResult = null
    }

    const enrichedText = buildLinkAnalysisPayload(content, parseResult)
    try {
      const analysis = await analyzeTextContent(enrichedText, type)
      await applyAnalysisToEntry(entry.msgid, {
        ...analysis,
        summary: analysis.summary || sanitizeText((parseResult && (parseResult.title || parseResult.desc)) || content.slice(0, 42)),
        desc: analysis.desc || analysis.summary || sanitizeText((parseResult && (parseResult.title || parseResult.desc)) || content.slice(0, 42)),
      }, (current) => ({
        ...current,
        raw_content: buildLinkRawContent(content, parseResult || {}),
      }))
    } catch (error) {
      await applyAnalysisToEntry(entry.msgid, {
        ...(parseResult && parseResult.ok
          ? normalizeAnalysis({
              category: '杂记',
              summary: sanitizeText(parseResult.title || parseResult.desc || content.slice(0, 42) || '链接内容'),
              desc: sanitizeText(parseResult.desc || parseResult.title || content.slice(0, 42) || '链接内容'),
              model_used: 'local_rule',
            }, '杂记', '链接内容')
          : simpleFallbackForText(content, type)),
      }, (current) => ({
        ...current,
        raw_content: buildLinkRawContent(content, parseResult || {}),
      }))
    }
    return { ok: true, msgid: entry.msgid }
  }

  try {
    const analysis = await analyzeTextContent(content, type)
    await applyAnalysisToEntry(entry.msgid, analysis)
  } catch (error) {
    await applyAnalysisToEntry(entry.msgid, simpleFallbackForText(content, type))
  }
  return { ok: true, msgid: entry.msgid }
}

async function uploadFile(filePath, msgType) {
  const entry = await store.createFileEntry(filePath, msgType)
  const current = await store.getMessage(entry.msgid)
  const raw = current.message.raw_content ? JSON.parse(current.message.raw_content) : {}

  if (msgType === 'image') {
    try {
      const result = await analyzeImage(entry.media[0].local_path)
      await applyAnalysisToEntry(entry.msgid, {
        category: result.category || '其他',
        summary: result.summary || result.title || '图片内容',
        desc: result.summary || result.title || '图片内容',
        model_used: result.model_used,
      }, (nextEntry) => {
        const image = raw.image || {}
        return {
          ...nextEntry,
          raw_content: JSON.stringify({
            msgtype: 'image',
            image: {
              ...image,
              title: sanitizeText(result.title || image.title || ''),
              content: sanitizeText(result.content || image.content || ''),
              ocr_text: sanitizeText(result.ocr_text || image.ocr_text || ''),
              keywords: Array.isArray(result.keywords) ? result.keywords : [],
              local_path: entry.media[0].local_path,
            },
          }),
        }
      })
    } catch (error) {
      await applyAnalysisToEntry(entry.msgid, { category: '生活', summary: (raw.image && raw.image.filename) || '图片内容', model_used: 'local_rule' })
    }
  } else {
    const filePayload = raw.file || {}
    const aiResult = await analyzeFileText(filePayload.filename, filePayload.extracted_text || '')
    await applyAnalysisToEntry(entry.msgid, {
      category: aiResult.category || '工作',
      summary: aiResult.summary || aiResult.title || filePayload.filename || '文件内容',
      desc: aiResult.summary || aiResult.title || filePayload.filename || '文件内容',
      model_used: aiResult.model_used,
      confidence: aiResult.model_used === 'local_rule' ? 0.35 : 0.86,
    }, (nextEntry) => ({
      ...nextEntry,
      raw_content: JSON.stringify({
        msgtype: 'file',
        file: {
          ...filePayload,
          title: sanitizeText(aiResult.title || filePayload.title || ''),
          content: sanitizeText(aiResult.content || filePayload.content || ''),
          extracted_text: sanitizeText(filePayload.extracted_text || ''),
          keywords: Array.isArray(aiResult.keywords) ? aiResult.keywords : [],
          local_path: entry.media[0].local_path,
        },
      }),
    }))
  }

  return { ok: true, msgid: entry.msgid }
}

async function reanalyze(msgid, feedback = '') {
  const detail = await store.getMessage(msgid)
  if (detail.error) throw new Error('消息不存在')
  const message = detail.message
  const raw = parseJson(message.raw_content, {})
  if (message.msg_type === 'image') {
    const media = await store.getMedia(msgid)
    const first = media.items && media.items[0]
    if (!first) throw new Error('图片原件不存在')
    const result = await analyzeImage(first.local_path, feedback)
    await applyAnalysisToEntry(msgid, {
      category: result.category || '其他',
      summary: result.summary || result.title || '图片内容',
      desc: result.summary || result.title || '图片内容',
      model_used: result.model_used,
    }, (entry) => ({
      ...entry,
      raw_content: JSON.stringify({
        msgtype: 'image',
        image: {
          ...(raw.image || {}),
          title: sanitizeText(result.title || ''),
          content: sanitizeText(result.content || ''),
          ocr_text: sanitizeText(result.ocr_text || ''),
          keywords: Array.isArray(result.keywords) ? result.keywords : [],
          local_path: first.local_path,
        },
      }),
    }))
    return store.getMessage(msgid)
  }

  const textPayload = message.msg_type === 'text'
    ? ((raw.text && raw.text.content) || '')
    : message.msg_type === 'link'
      ? ((raw.link && (raw.link.raw_text || raw.link.url || raw.link.title || raw.link.desc)) || '')
      : ((raw.file && (raw.file.extracted_text || raw.file.content || raw.file.filename)) || '')

  const analysis = await analyzeTextContent(textPayload, message.msg_type, feedback)
  await applyAnalysisToEntry(msgid, analysis)
  return store.getMessage(msgid)
}

async function parseLink(input) {
  const text = String(input || '').trim()
  if (!text) throw new Error('请输入要解析的链接或分享文案')
  const baseUrl = getProxyBaseUrl()
  if (!baseUrl) throw new Error('默认智能通道地址未内置')
  return requestJson({
    url: `${baseUrl}${LINK_PARSE_PATH}`,
    method: 'POST',
    header: {
      'content-type': 'application/json',
      'x-filehive-client': 'miniprogram',
    },
    data: {
      text,
    },
  }).then((result) => result.data)
}

function shareOrOpenFile(filePath, fileName) {
  return new Promise((resolve, reject) => {
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath,
        fileName,
        success: resolve,
        fail: () => {
          wx.openDocument({ filePath, showMenu: true, success: resolve, fail: reject })
        },
      })
      return
    }
    wx.openDocument({ filePath, showMenu: true, success: resolve, fail: reject })
  })
}

async function validateMimoKey() {
  const apiKey = getMimoApiKey()
  if (!apiKey) throw new Error('请先填写 MiMo API Key')
  await requestMimo({
    model: MIMO_MODEL,
    messages: [
      { role: 'system', content: 'Return plain text ok.' },
      { role: 'user', content: 'ping' },
    ],
    max_tokens: 8,
  })
  return { ok: true }
}

async function validateProxyService() {
  const baseUrl = getProxyBaseUrl()
  if (!baseUrl) throw new Error('默认智能通道地址未内置')
  const header = {}
  const siliconflowApiKey = getSiliconflowApiKey()
  if (siliconflowApiKey) header['x-siliconflow-api-key'] = siliconflowApiKey
  const result = await requestJson({
    url: `${baseUrl}${PROXY_HEALTH_PATH}`,
    method: 'GET',
    header,
  })
  return result.data
}

module.exports = {
  submitText,
  uploadFile,
  fetchMessages: (params) => store.listMessages(params || {}),
  fetchMessage: (id) => store.getMessage(id),
  fetchMessageMedia: (id) => store.getMedia(id),
  searchMessages: (params) => store.searchMessages(params || {}),
  fetchOverview: () => store.getOverview(),
  healthCheck: () => Promise.resolve({ ok: true, mode: 'local_first' }),
  fetchRuntimeStatus: () => Promise.resolve({
    ok: true,
    effective_mimo_key_present: !!getMimoApiKey(),
    effective_siliconflow_key_present: !!getSiliconflowApiKey(),
    ai_provider_mode: getAiProviderMode(),
    ai_proxy_base_url: getProxyBaseUrl(),
  }).then(async (base) => ({ ...base, ...(await store.getRuntimeStatus()) })),
  reanalyze,
  parseLink,
  deleteMessage: (id) => store.deleteEntry(id).then(() => ({ ok: true })),
  setProject: (id, projectId) => store.setProject(id, projectId),
  removeProject: (id) => store.removeProject(id),
  updateAnalysis: (id, desc) => store.updateSummary(id, desc),
  updateCategory: (id, category) => store.updateCategory(id, category),
  fetchCategories: () => store.listCategories(),
  createCategory: (name) => store.createCategory(name),
  fetchProjects: () => store.listProjects(),
  createProject: (name) => store.createProject(name),
  exportIndexFile: () => store.exportIndexFile(),
  exportBundleManifest: () => store.exportBundleManifest(),
  shareOrOpenFile,
  validateMimoKey,
  validateProxyService,
}
