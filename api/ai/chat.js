const { readJsonBody, sendJson, setCors } = require('../_lib/http')

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
const DEFAULT_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct'

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

  const apiKey = process.env.SILICONFLOW_API_KEY
  const userApiKey = String(req.headers['x-siliconflow-api-key'] || '').trim()
  const effectiveApiKey = userApiKey || apiKey
  if (!effectiveApiKey) {
    sendJson(res, 500, { ok: false, message: 'SILICONFLOW_API_KEY is not configured' })
    return
  }

  let payload
  try {
    payload = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
    return
  }

  const baseUrl = (process.env.SILICONFLOW_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = payload.model || process.env.SILICONFLOW_MODEL || DEFAULT_MODEL
  const upstreamPayload = {
    ...payload,
    model,
    stream: false,
  }

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: JSON.stringify(upstreamPayload),
    })

    const text = await upstream.text()
    let data
    try {
      data = text ? JSON.parse(text) : {}
    } catch (error) {
      data = { raw: text }
    }

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        ok: false,
        message: (data && data.error && data.error.message) || data.message || `SiliconFlow request failed (${upstream.status})`,
        error: data.error || null,
      })
      return
    }

    sendJson(res, 200, data)
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      message: error.message || 'Failed to reach SiliconFlow',
    })
  }
}
