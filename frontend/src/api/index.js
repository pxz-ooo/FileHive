import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

const api = axios.create({
  baseURL,
  timeout: 15000,
})

export function fetchMessages(params = {}) {
  return api.get('/messages', { params })
}

export function fetchMessage(msgid) {
  return api.get(`/messages/${msgid}`)
}

export function fetchMessageRaw(msgid) {
  return api.get(`/messages/${msgid}/raw`)
}

export function reanalyzeMessage(msgid) {
  return api.post(`/messages/${msgid}/reanalyze`)
}

export function fetchCategoryStats() {
  return api.get('/messages/stats/categories')
}

export function triggerSync() {
  return api.post('/sync/messages')
}

export default api
