import { useEffect, useState, useCallback } from 'react'
import { getChannelUpdates, getAlerts } from '../api'
import UpdateCard from './UpdateCard'
import { formatDistanceToNow } from 'date-fns'

const UPDATE_TYPES = ['crm_change', 'email_insight', 'deal_update', 'action_item', 'note']

const CHANNEL_COLORS = {
  Blaise: '#ef4444',
  Alex: '#f97316',
  Joey: '#eab308',
  Matt: '#22c55e',
  Sam: '#06b6d4',
  Kayla: '#3b82f6',
  Mia: '#8b5cf6',
  Devon: '#ec4899',
  Kinsey: '#14b8a6',
}

const REASON_ICONS = {
  shared_contacts: '👥',
  location_proximity: '📍',
  similar_deal_types: '🤝',
  keyword_overlap: '🔗',
}

export default function ChannelView({ channel, onBack }) {
  const [updates, setUpdates] = useState([])
  const [alerts, setAlerts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [offset, setOffset] = useState(0)
  const LIMIT = 20

  const channelColor = CHANNEL_COLORS[channel] || '#6b7280'

  const fetchData = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: off }
      if (filterType) params.type = filterType
      if (keyword) params.keyword = keyword

      const [updatesData, alertsData] = await Promise.all([
        getChannelUpdates(channel, params),
        getAlerts({ channel, limit: 10 }),
      ])
      setUpdates(updatesData.updates || [])
      setTotal(updatesData.total || 0)
      setAlerts(alertsData.alerts || [])
      setOffset(off)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [channel, filterType, keyword])

  useEffect(() => {
    fetchData(0)
  }, [fetchData])

  return (
    <div className="channel-page">
      <div className="channel-page-header" style={{ borderLeftColor: channelColor }}>
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="channel-hero">
          <div className="channel-avatar-large" style={{ background: channelColor }}>
            {channel[0]}
          </div>
          <div>
            <h1>{channel}'s Channel</h1>
            <p className="page-sub">{total} update{total !== 1 ? 's' : ''} · {alerts.length} opportunity alert{alerts.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      <div className="channel-layout">
        {/* Main updates column */}
        <div className="channel-main">
          <div className="filter-bar">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="filter-select"
            >
              <option value="">All Types</option>
              {UPDATE_TYPES.map(t => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="filter-input keyword-input"
              placeholder="Search keyword..."
            />
          </div>

          {loading ? (
            <div className="loading">Loading...</div>
          ) : updates.length === 0 ? (
            <div className="empty-state large">No updates found for {channel}.</div>
          ) : (
            <>
              <div className="updates-list">
                {updates.map(u => (
                  <UpdateCard key={u.id} update={u} onDeleted={() => fetchData(offset)} />
                ))}
              </div>

              {total > LIMIT && (
                <div className="pagination">
                  <button
                    className="btn-secondary"
                    disabled={offset === 0}
                    onClick={() => fetchData(Math.max(0, offset - LIMIT))}
                  >
                    Previous
                  </button>
                  <span className="page-info">
                    {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
                  </span>
                  <button
                    className="btn-secondary"
                    disabled={offset + LIMIT >= total}
                    onClick={() => fetchData(offset + LIMIT)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Alerts sidebar */}
        <div className="channel-sidebar">
          <div className="sidebar-card">
            <h3>Opportunity Alerts</h3>
            {alerts.length === 0 ? (
              <p className="sidebar-empty">No alerts for {channel} yet.</p>
            ) : (
              <div className="sidebar-alerts">
                {alerts.map(alert => (
                  <div key={alert.id} className={`sidebar-alert ${alert.is_read ? '' : 'unread'}`}>
                    <div className="sidebar-alert-icon">{REASON_ICONS[alert.match_reason] || '🔔'}</div>
                    <div className="sidebar-alert-body">
                      <p className="sidebar-alert-msg">{alert.message}</p>
                      <span className="sidebar-alert-time">
                        {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
