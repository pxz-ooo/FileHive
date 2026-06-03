const { sendJson, setCors } = require('../_lib/http')

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
const DEFAULT_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct'

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, message: 'Method Not Allowed' })
    return
  }

  sendJson(res, 200, {
    ok: true,
    provider: 'siliconflow',
    baseUrl: process.env.SILICONFLOW_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.SILICONFLOW_MODEL || DEFAULT_MODEL,
    keyConfigured: Boolean(process.env.SILICONFLOW_API_KEY),
    acceptsUserKey: true,
  })
}
