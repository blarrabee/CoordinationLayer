import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

// ─── API Key Storage ──────────────────────────────────────────────────────────
const KEY_STORAGE = 'trux_api_key'

export function getStoredApiKey() {
  return localStorage.getItem(KEY_STORAGE) || ''
}

export function setStoredApiKey(key) {
  if (key) localStorage.setItem(KEY_STORAGE, key)
  else localStorage.removeItem(KEY_STORAGE)
}

// ─── Axios Instance ───────────────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE })

// Inject API key on every request
api.interceptors.request.use(config => {
  const key = getStoredApiKey()
  if (key) config.headers['X-API-Key'] = key
  return config
})

// ─── Core Endpoints ───────────────────────────────────────────────────────────
export const getHealth = () => axios.get(`${BASE}/health`).then(r => r.data)

export const getChannels = () => api.get('/channels').then(r => r.data)

export const getUpdates = (params = {}) =>
  api.get('/updates', { params }).then(r => r.data)

export const getChannelUpdates = (channel, params = {}) =>
  api.get(`/channels/${channel}/updates`, { params }).then(r => r.data)

export const postUpdate = (channel, data) =>
  api.post(`/channels/${channel}/updates`, data).then(r => r.data)

export const getAlerts = (params = {}) =>
  api.get('/alerts', { params }).then(r => r.data)

export const markAlertRead = (id) =>
  api.patch(`/alerts/${id}/read`).then(r => r.data)

export const markAllAlertsRead = (channel) =>
  api.patch('/alerts/read-all', null, { params: channel ? { channel } : {} }).then(r => r.data)

export const getStats = () =>
  api.get('/stats').then(r => r.data)

export const deleteUpdate = (id) =>
  api.delete(`/updates/${id}`).then(r => r.data)

// ─── API Key Management ───────────────────────────────────────────────────────
export const getMyKeyInfo = () =>
  api.get('/keys/me').then(r => r.data)

export const listKeys = () =>
  api.get('/keys').then(r => r.data)

export const createKey = (data) =>
  api.post('/keys', data).then(r => r.data)

export const revokeKey = (id) =>
  api.delete(`/keys/${id}`).then(r => r.data)

// ─── Agent Instructions ───────────────────────────────────────────────────────
export const getInstructions = (channel) =>
  api.get(`/instructions/${channel}`).then(r => r.data)

export const getDigest = (channel) =>
  api.get(`/digest/${channel}`).then(r => r.data)

export default api
