const { readJsonBody, sendJson, setCors } = require('../_lib/http')

const BUGPK_APIS = {
  shortVideos: 'https://api.bugpk.com/api/short_videos',
  xiaohongshu: 'https://api.bugpk.com/api/xhs',
  xiaohongshuImages: 'https://api.bugpk.com/api/xhsimg',
  douyin: 'https://api.bugpk.com/api/douyin',
  bilibili: 'https://api.bugpk.com/api/bilibili',
}

const BUGPK_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const WECHAT_IN_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.34(0x16082222) NetType/WIFI Language/zh_CN'

function extractFirstUrl(input) {
  const match = String(input || '').match(/(https?:\/\/[^\s]+)|((?:www\.|xhslink\.com|b23\.tv|v\.douyin\.com|mp\.weixin\.qq\.com)[^\s]*)/i)
  if (!match) return ''
  const candidate = match[0]
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate.replace(/^\/+/, '')}`
}

function detectPlatform(url) {
  const text = String(url || '').toLowerCase()
  if (/(xiaohongshu\.com|xhslink\.com)/.test(text)) return 'xiaohongshu'
  if (/(douyin\.com|v\.douyin\.com)/.test(text)) return 'douyin'
  if (/(bilibili\.com|b23\.tv)/.test(text)) return 'bilibili'
  if (/mp\.weixin\.qq\.com/.test(text)) return 'wechat_article'
  return 'generic'
}

function sanitizeText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function toAuthor(author, extra = {}) {
  if (typeof author === 'string') {
    return { name: author, ...extra }
  }
  if (author && typeof author === 'object') {
    return {
      name: sanitizeText(author.name || author.nickname || author.author || ''),
      avatar: sanitizeText(author.avatar || author.avatarUrl || ''),
      ...extra,
    }
  }
  return {
    name: '',
    ...extra,
  }
}

function normalizeBugpkPayload(sourceUrl, payload, options = {}) {
  const body = payload || {}
  const data = body.data || {}
  return {
    ok: body.code === 200 || body.success === true,
    parser: options.parser || 'bugpk_short_videos',
    sourceUrl,
    message: body.msg || body.message || '',
    platform: options.platform || data.platform || '',
    type: options.type || data.type || '',
    title: sanitizeText(data.title || data.desc || body.title || ''),
    desc: sanitizeText(data.desc || data.title || body.desc || ''),
    author: toAuthor(data.author, {
      userId: sanitizeText(data.userId || data.author_id || ''),
    }),
    cover: sanitizeText(data.cover || data.pic || ''),
    mediaUrl: sanitizeText(data.url || data.video || ''),
    images: Array.isArray(data.images) ? data.images.filter(Boolean) : [],
    music: data.music || null,
    publishedAt: sanitizeText(data.time || data.publish_time || ''),
    raw: body,
  }
}

function decodeHtml(value) {
  return sanitizeText(String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>'))
}

function stripHtml(value) {
  return sanitizeText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n'))
}

function extractMeta(html, names) {
  const patterns = []
  names.forEach((name) => {
    patterns.push(new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'))
    patterns.push(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'))
    patterns.push(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["'][^>]*>`, 'i'))
    patterns.push(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["'][^>]*>`, 'i'))
  })
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match && match[1]) return decodeHtml(match[1])
  }
  return ''
}

function extractJsValue(html, key) {
  const patterns = [
    new RegExp(`var\\s+${key}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`var\\s+${key}\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`window\\.${key}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`window\\.${key}\\s*=\\s*'([^']*)'`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match && match[1]) return decodeHtml(match[1])
  }
  return ''
}

function extractBetween(html, startToken, endToken) {
  const startIndex = String(html || '').indexOf(startToken)
  if (startIndex < 0) return ''
  const from = startIndex + startToken.length
  const endIndex = String(html || '').indexOf(endToken, from)
  if (endIndex < 0) return ''
  return html.slice(from, endIndex)
}

function extractWechatContentHtml(html) {
  const match = String(html || '').match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i)
  return match && match[1] ? match[1] : ''
}

async function fetchJsonFromBugpk(endpoint, url) {
  const upstream = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://api.bugpk.com/',
      'User-Agent': BUGPK_BROWSER_UA,
    },
  })

  const text = await upstream.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('BugPk returned non-JSON content')
  }

  if (!upstream.ok) {
    throw new Error((data && (data.msg || data.message)) || `BugPk request failed (${upstream.status})`)
  }

  return data
}

async function parseWechatArticle(sourceUrl) {
  const upstream = await fetch(sourceUrl, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': WECHAT_IN_APP_UA,
      Referer: 'https://mp.weixin.qq.com/',
    },
  })

  const html = await upstream.text()
  if (!upstream.ok) {
    throw new Error(`WeChat article request failed (${upstream.status})`)
  }

  const title = extractMeta(html, ['og:title']) || extractJsValue(html, 'msg_title')
  const desc = extractMeta(html, ['description', 'og:description']) || extractJsValue(html, 'msg_desc')
  const cover = extractMeta(html, ['og:image']) || extractJsValue(html, 'msg_cdn_url')
  const nickname = extractJsValue(html, 'nickname') || extractJsValue(html, 'user_name')
  const publishTime = extractJsValue(html, 'publish_time') || extractJsValue(html, 'oriCreateTime')
  const contentHtml = extractWechatContentHtml(html)
  const contentText = stripHtml(contentHtml)
  const digest = extractBetween(html, 'var msg_desc = "', '";') || desc

  return {
    ok: true,
    parser: 'wechat_article_wechat_ua',
    sourceUrl,
    message: '微信公众号文章已通过微信 UA 抓取并提取正文',
    platform: '微信公众号',
    type: '文章',
    title,
    desc: digest,
    author: toAuthor(nickname),
    cover,
    mediaUrl: '',
    images: cover ? [cover] : [],
    music: null,
    publishedAt: publishTime,
    contentHtml,
    contentText,
    raw: {
      title,
      desc: digest,
      nickname,
      publishTime,
      contentText: contentText.slice(0, 4000),
    },
  }
}

async function parseXiaohongshu(sourceUrl) {
  try {
    const payload = await fetchJsonFromBugpk(BUGPK_APIS.xiaohongshu, sourceUrl)
    return normalizeBugpkPayload(sourceUrl, payload, {
      parser: 'bugpk_xhs',
      platform: '小红书',
    })
  } catch (error) {
    const payload = await fetchJsonFromBugpk(BUGPK_APIS.xiaohongshuImages, sourceUrl)
    return normalizeBugpkPayload(sourceUrl, payload, {
      parser: 'bugpk_xhsimg',
      platform: '小红书',
      type: '图文',
    })
  }
}

async function parseDouyin(sourceUrl) {
  const payload = await fetchJsonFromBugpk(BUGPK_APIS.douyin, sourceUrl)
  return normalizeBugpkPayload(sourceUrl, payload, {
    parser: 'bugpk_douyin',
    platform: '抖音',
  })
}

async function parseBilibili(sourceUrl) {
  const payload = await fetchJsonFromBugpk(BUGPK_APIS.bilibili, sourceUrl)
  return normalizeBugpkPayload(sourceUrl, payload, {
    parser: 'bugpk_bilibili',
    platform: 'B站',
  })
}

async function parseGeneric(sourceUrl) {
  const payload = await fetchJsonFromBugpk(BUGPK_APIS.shortVideos, sourceUrl)
  return normalizeBugpkPayload(sourceUrl, payload, {
    parser: 'bugpk_short_videos',
  })
}

async function resolveByPlatform(sourceUrl) {
  const platform = detectPlatform(sourceUrl)
  if (platform === 'xiaohongshu') return parseXiaohongshu(sourceUrl)
  if (platform === 'douyin') return parseDouyin(sourceUrl)
  if (platform === 'bilibili') return parseBilibili(sourceUrl)
  if (platform === 'wechat_article') return parseWechatArticle(sourceUrl)
  return parseGeneric(sourceUrl)
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'Method Not Allowed' })
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
    return
  }

  const sourceText = body.url || body.text || ''
  const sourceUrl = extractFirstUrl(sourceText)
  if (!sourceUrl) {
    sendJson(res, 400, { ok: false, message: 'No resolvable URL found in the input' })
    return
  }

  try {
    const payload = await resolveByPlatform(sourceUrl)
    sendJson(res, 200, payload)
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      parser: detectPlatform(sourceUrl),
      sourceUrl,
      message: error.message || 'Parse failed',
    })
  }
}
