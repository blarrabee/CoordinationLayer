import { useEffect, useState, useCallback } from 'react'
import { getAlerts, markAlertRead, markAllAlertsRead } from '../api'
import { formatDistanceToNow, format } from 'date-fns'

const REASON_ICONS = {
  shared_contacts: '👥',
  location_proximity: '📍',
  similar_deal_types: '🤝',
  keyword_overlap: '🔗',
}

const REASON_LABELS = {
  shared_contacts: 'Shared Contacts',
  location_proximity: 'Location Proximity',
  similar_deal_types: 'Similar Deal Types',
  keyword_overlap: 'Keyword Overlap',
}

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

export default function Alerts({ channels }) {
  const [alerts, setAlerts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterChannel, setFilterChannel] = useState('')
  const [filterUnread, setFilterUnread] = useState(false)
  const [offset, setOffset] = useState(0)
  const LIMIT = 20

  const fetchAlerts = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: off }
      if (filterChannel) params.channel = filterChannel
      if (filterUnread) params.unread_only = 'true'
      const data = await getAlerts(params)
      setAlerts(data.alerts || [])
      setTotal(data.total || 0)
      setOffset(off)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [filterChannel, filterUnread])

  useEffect(() => {
    fetchAlerts(0)
  }, [fetchAlerts])

  const handleMarkRead = async (id) => {
    try {
      await markAlertRead(id)
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
    } catch (err) {
      console.error(err)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllAlertsRead(filterChannel || null)
      setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
    } catch (err) {
      console.error(err)
    }
  }

  const unreadCount = alerts.filter(a => !a.is_read).length

  return (
    <div className="alerts-page">
      <div className="page-header">
        <div>
          <h1>Opportunity Alerts</h1>
          <p className="page-sub">Cross-team opportunities detected by the Alignment Engine</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-primary" onClick={handleMarkAllRead}>
            Mark All Read ({unreadCount})
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <select
          value={filterChannel}
          onChange={e => setFilterChannel(e.target.value)}
          className="filter-select"
        >
          <option value="">All Channels</option>
          {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
        </select>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filterUnread}
            onChange={e => setFilterUnread(e.target.checked)}
          />
          Unread only
        </label>
      </div>

      <div className="results-meta">
        {loading ? 'Loading...' : `${total} alert${total !== 1 ? 's' : ''}`}
      </div>

      {loading ? (
        <div className="loading">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state large">
          <div className="empty-icon">🔔</div>
          <h3>No opportunity alerts yet</h3>
          <p>The Alignment Engine automatically scans all incoming updates for cross-team opportunities. As agents post updates with shared contacts, overlapping locations, or similar deal types, alerts will appear here.</p>
        </div>
      ) : (
        <>
          <div className="alerts-grid">
            {alerts.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onMarkRead={handleMarkRead}
              />
            ))}
          </div>

          {total > LIMIT && (
            <div className="pagination">
              <button
                className="btn-secondary"
                disabled={offset === 0}
                onClick={() => fetchAlerts(Math.max(0, offset - LIMIT))}
              >
                Previous
              </button>
              <span className="page-info">
                {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
              </span>
              <button
                className="btn-secondary"
                disabled={offset + LIMIT >= total}
                onClick={() => fetchAlerts(offset + LIMIT)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AlertCard({ alert, onMarkRead }) {
  const colorA = CHANNEL_COLORS[alert.channel_a] || '#6b7280'
  const colorB = CHANNEL_COLORS[alert.channel_b] || '#6b7280'

  return (
    <div className={`alert-full-card ${alert.is_read ? 'read' : 'unread'}`}>
      {!alert.is_read && <div className="unread-badge">NEW</div>}

      <div className="alert-reason-row">
        <span className="reason-icon">{REASON_ICONS[alert.match_reason] || '🔔'}</span>
        <span className="reason-label">{REASON_LABELS[alert.match_reason] || alert.match_reason}</span>
        {alert.score > 0 && (
          <span className="match-score">
            {Math.round(alert.score * 100)}% match
          </span>
        )}
      </div>

      <div className="alert-message-text">{alert.message}</div>

      <div className="alert-channels-row">
        <div className="alert-channel-chip" style={{ background: colorA + '20', color: colorA }}>
          <span className="channel-initial">{alert.channel_a[0]}</span>
          {alert.channel_a}
        </div>
        <span className="alert-arrow">↔</span>
        <div className="alert-channel-chip" style={{ background: colorB + '20', color: colorB }}>
          <span className="channel-initial">{alert.channel_b[0]}</span>
          {alert.channel_b}
        </div>
      </div>

      {alert.update_a_title && (
        <div className="alert-updates-row">
          <div className="alert-update-ref">
            <span className="ref-label">{alert.channel_a}:</span>
            <span className="ref-title">"{alert.update_a_title}"</span>
          </div>
          <div className="alert-update-ref">
            <span className="ref-label">{alert.channel_b}:</span>
            <span className="ref-title">"{alert.update_b_title}"</span>
          </div>
        </div>
      )}

      {alert.detail && (
        <div className="alert-detail">{alert.detail}</div>
      )}

      <div className="alert-footer">
        <span className="alert-time" title={format(new Date(alert.created_at), 'PPpp')}>
          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
        </span>
        {!alert.is_read && (
          <button className="btn-ghost-sm" onClick={() => onMarkRead(alert.id)}>
            Mark as read
          </button>
        )}
      </div>
    </div>
  )
}
