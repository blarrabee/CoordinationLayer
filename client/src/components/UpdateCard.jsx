import { useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { deleteUpdate } from '../api'

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

export default function UpdateCard({ update, onDeleted, compact = false }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const channelColor = CHANNEL_COLORS[update.channel] || '#6b7280'
  const typeColor = TYPE_COLORS[update.update_type] || '#6b7280'

  const handleDelete = async (e) => {
    e.stopPropagation()
    if (!confirm('Delete this update?')) return
    setDeleting(true)
    try {
      await deleteUpdate(update.id)
      onDeleted?.()
    } catch (err) {
      console.error(err)
      setDeleting(false)
    }
  }

  return (
    <div
      className={`update-card ${compact ? 'compact' : ''}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="update-card-left" style={{ borderLeftColor: channelColor }} />

      <div className="update-card-content">
        <div className="update-card-header">
          <div className="update-meta-left">
            <div className="channel-badge" style={{ background: channelColor + '20', color: channelColor }}>
              <span className="channel-initial">{update.channel[0]}</span>
              <span>{update.channel}</span>
            </div>
            <span
              className="type-badge"
              style={{ background: typeColor + '20', color: typeColor }}
            >
              {TYPE_LABELS[update.update_type] || update.update_type}
            </span>
          </div>
          <div className="update-meta-right">
            {update.location && (
              <span className="location-tag">📍 {update.location}</span>
            )}
            <span
              className="timestamp"
              title={format(new Date(update.timestamp), 'PPpp')}
            >
              {formatDistanceToNow(new Date(update.timestamp), { addSuffix: true })}
            </span>
          </div>
        </div>

        <div className="update-title">{update.title}</div>

        {!compact && (
          <div className={`update-body ${expanded ? 'expanded' : ''}`}>
            {update.body}
          </div>
        )}

        {expanded && !compact && (
          <div className="update-details">
            {update.related_contacts?.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Contacts:</span>
                <div className="tag-list">
                  {update.related_contacts.map(c => (
                    <span key={c} className="tag contact-tag">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {update.tags?.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Tags:</span>
                <div className="tag-list">
                  {update.tags.map(t => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Posted:</span>
              <span>{format(new Date(update.timestamp), 'PPpp')}</span>
            </div>
            {onDeleted && (
              <button
                className="btn-danger-sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
        )}

        {!compact && update.body?.length > 120 && (
          <button className="expand-btn" onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}
