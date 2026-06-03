const { readJsonBody, sendJson, setCors } = require('../_lib/http')

const BUGPK_SHORT_VIDEOS_API = 'https://api.bugpk.com/api/short_videos'

function extractFirstUrl(input) {
  const match = String(input || '').match(/https?:\/\/[^\s]+/i)
  return match ? match[0] : ''
}

function normalizeBugpkPayload(sourceUrl, payload) {
  const body = payload || {}
  const data = body.data || {}
  return {
    ok: body.code === 200,
    parser: 'bugpk_short_videos',
    sourceUrl,
    message: body.msg || '',
    platform: data.platform || '',
    type: data.type || '',
    title: data.title || data.desc || '',
    desc: data.desc || data.title || '',
    author: typeof data.author === 'string' ? { name: data.author } : (data.author || {}),
    cover: data.cover || '',
    mediaUrl: data.url || '',
    images: Array.isArray(data.images) ? data.images : [],
    music: data.music || null,
    raw: body,
  }
}

async function callBugpk(url) {
  const upstream = await fetch(`${BUGPK_SHORT_VIDEOS_API}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'FileHive-Link-Parser/1.0',
    },
  })

  const text = await upstream.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('BugPk 返回了非 JSON 内容')
  }

  if (!upstream.ok) {
    throw new Error((data && data.msg) || `BugPk 请求失败 (${upstream.status})`)
  }

  return data
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
    sendJson(res, 400, { ok: false, message: '未提取到可解析的链接' })
    return
  }

  try {
    const payload = await callBugpk(sourceUrl)
    sendJson(res, 200, normalizeBugpkPayload(sourceUrl, payload))
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      parser: 'bugpk_short_videos',
      sourceUrl,
      message: error.message || '解析失败',
    })
  }
}
