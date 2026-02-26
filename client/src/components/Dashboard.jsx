import { useEffect, useState } from 'react'
import { getStats, getAlerts } from '../api'
import { formatDistanceToNow } from 'date-fns'

const TYPE_COLORS = {
  crm_change: '#3b82f6',
  email_insight: '#8b5cf6',
  deal_update: '#10b981',
  action_item: '#f59e0b',
  note: '#6b7280',
}

const TYPE_LABELS = {
  crm_change: 'CRM Change',
  email_insight: 'Email Insight',
  deal_update: 'Deal Update',
  action_item: 'Action Item',
  note: 'Note',
}

const REASON_ICONS = {
  shared_contacts: '👥',
  location_proximity: '📍',
  similar_deal_types: '🤝',
  keyword_overlap: '🔗',
}

export default function Dashboard({ onChannelSelect }) {
  const [stats, setStats] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getStats(), getAlerts({ limit: 5 })])
      .then(([s, a]) => {
        setStats(s)
        setAlerts(a.alerts || [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading dashboard...</div>

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Command Center</h1>
        <p className="page-sub">Real-time overview of all agent activity and cross-team opportunities</p>
      </div>

      {/* Stats Row */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats?.total_updates ?? 0}</div>
          <div className="stat-label">Total Updates</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-value">{stats?.total_alerts ?? 0}</div>
          <div className="stat-label">Opportunities Found</div>
        </div>
        <div className="stat-card accent-orange">
          <div className="stat-value">{stats?.unread_alerts ?? 0}</div>
          <div className="stat-label">Unread Alerts</div>
        </div>
        <div className="stat-card accent-blue">
          <div className="stat-value">{stats?.updates_by_channel?.length ?? 0}</div>
          <div className="stat-label">Active Channels</div>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Channel Activity */}
        <div className="card">
          <div className="card-header">
            <h2>Channel Activity</h2>
            <span className="card-sub">Click to view channel</span>
          </div>
          <div className="channel-list">
            {stats?.updates_by_channel?.map(ch => (
              <div
                key={ch.channel_name}
                className="channel-row"
                onClick={() => onChannelSelect(ch.channel_name)}
              >
                <div className="channel-avatar">{ch.channel_name[0]}</div>
                <div className="channel-info">
                  <span className="channel-name">{ch.channel_name}</span>
                  <span className="channel-count">{ch.count} update{ch.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="channel-bar-wrap">
                  <div
                    className="channel-bar"
                    style={{
                      width: `${Math.min(100, (ch.count / Math.max(...(stats.updates_by_channel.map(c => c.count)))) * 100)}%`
                    }}
                  />
                </div>
              </div>
            ))}
            {(!stats?.updates_by_channel || stats.updates_by_channel.length === 0) && (
              <div className="empty-state">No activity yet. Post your first update!</div>
            )}
          </div>
        </div>

        {/* Update Types */}
        <div className="card">
          <div className="card-header">
            <h2>Updates by Type</h2>
          </div>
          <div className="type-list">
            {stats?.updates_by_type?.map(t => (
              <div key={t.update_type} className="type-row">
                <div className="type-dot" style={{ background: TYPE_COLORS[t.update_type] }} />
                <span className="type-label">{TYPE_LABELS[t.update_type] || t.update_type}</span>
                <span className="type-count">{t.count}</span>
              </div>
            ))}
            {(!stats?.updates_by_type || stats.updates_by_type.length === 0) && (
              <div className="empty-state">No updates yet</div>
            )}
          </div>

          <div className="card-header" style={{ marginTop: '1.5rem' }}>
            <h2>Recent Activity</h2>
          </div>
          <div className="activity-list">
            {stats?.recent_activity?.slice(0, 6).map(a => (
              <div key={a.channel_name} className="activity-row">
                <div className="channel-avatar small">{a.channel_name[0]}</div>
                <span className="activity-name">{a.channel_name}</span>
                <span className="activity-time">
                  {formatDistanceToNow(new Date(a.last_active), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="card full-width">
          <div className="card-header">
            <h2>Recent Opportunity Alerts</h2>
            <span className="card-sub">{stats?.unread_alerts ?? 0} unread</span>
          </div>
          {alerts.length === 0 ? (
            <div className="empty-state">
              No opportunity alerts yet. The alignment engine will flag cross-team opportunities automatically as updates are posted.
            </div>
          ) : (
            <div className="alerts-list">
              {alerts.map(alert => (
                <div key={alert.id} className={`alert-card ${alert.is_read ? 'read' : 'unread'}`}>
                  <div className="alert-icon">{REASON_ICONS[alert.match_reason] || '🔔'}</div>
                  <div className="alert-body">
                    <div className="alert-message">{alert.message}</div>
                    <div className="alert-meta">
                      <span className="alert-channels">{alert.channel_a} ↔ {alert.channel_b}</span>
                      <span className="alert-time">
                        {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  {!alert.is_read && <div className="unread-dot" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
