import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({ baseURL: BASE })

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

export default api
