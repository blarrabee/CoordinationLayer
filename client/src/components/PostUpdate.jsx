import { useState } from 'react'
import { postUpdate } from '../api'

const UPDATE_TYPES = [
  { value: 'crm_change', label: 'CRM Change', desc: 'Contact updates, pipeline changes, CRM data' },
  { value: 'email_insight', label: 'Email Insight', desc: 'Key info from email conversations' },
  { value: 'deal_update', label: 'Deal Update', desc: 'Progress on active deals or negotiations' },
  { value: 'action_item', label: 'Action Item', desc: 'Tasks or follow-ups that need attention' },
  { value: 'note', label: 'Note', desc: 'General observations or context' },
]

export default function PostUpdate({ channels, onSuccess }) {
  const [form, setForm] = useState({
    channel: '',
    update_type: '',
    title: '',
    body: '',
    location: '',
    related_contacts: '',
    tags: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleChange = (key, val) => {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
    setResult(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.channel || !form.update_type || !form.title || !form.body) {
      setError('Channel, type, title, and body are required.')
      return
    }

    setSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const payload = {
        update_type: form.update_type,
        title: form.title,
        body: form.body,
      }
      if (form.location) payload.location = form.location
      if (form.related_contacts) {
        payload.related_contacts = form.related_contacts.split(',').map(s => s.trim()).filter(Boolean)
      }
      if (form.tags) {
        payload.tags = form.tags.split(',').map(s => s.trim()).filter(Boolean)
      }

      const data = await postUpdate(form.channel, payload)
      setResult(data)
      setForm(f => ({ ...f, title: '', body: '', location: '', related_contacts: '', tags: '' }))
      onSuccess?.()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post update. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="post-page">
      <div className="page-header">
        <h1>Post Update</h1>
        <p className="page-sub">Push a new update to your agent channel</p>
      </div>

      <div className="post-layout">
        <form className="post-form card" onSubmit={handleSubmit}>
          {/* Channel */}
          <div className="form-group">
            <label className="form-label">Agent Channel *</label>
            <div className="channel-selector">
              {channels.map(ch => (
                <button
                  key={ch}
                  type="button"
                  className={`channel-select-btn ${form.channel === ch ? 'selected' : ''}`}
                  onClick={() => handleChange('channel', ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* Update Type */}
          <div className="form-group">
            <label className="form-label">Update Type *</label>
            <div className="type-selector">
              {UPDATE_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  className={`type-select-btn ${form.update_type === t.value ? 'selected' : ''}`}
                  onClick={() => handleChange('update_type', t.value)}
                >
                  <span className="type-btn-label">{t.label}</span>
                  <span className="type-btn-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input
              type="text"
              className="form-input"
              value={form.title}
              onChange={e => handleChange('title', e.target.value)}
              placeholder="Brief summary of the update"
              maxLength={200}
            />
          </div>

          {/* Body */}
          <div className="form-group">
            <label className="form-label">Body *</label>
            <textarea
              className="form-textarea"
              value={form.body}
              onChange={e => handleChange('body', e.target.value)}
              placeholder="Full details of the update — include context, key info, next steps..."
              rows={5}
            />
          </div>

          {/* Location */}
          <div className="form-group">
            <label className="form-label">Location <span className="optional">(optional)</span></label>
            <input
              type="text"
              className="form-input"
              value={form.location}
              onChange={e => handleChange('location', e.target.value)}
              placeholder="e.g. Houston, TX or Downtown Austin"
            />
            <span className="form-hint">Used by the Alignment Engine to detect nearby activity from other agents</span>
          </div>

          {/* Related Contacts */}
          <div className="form-group">
            <label className="form-label">Related Contacts <span className="optional">(optional)</span></label>
            <input
              type="text"
              className="form-input"
              value={form.related_contacts}
              onChange={e => handleChange('related_contacts', e.target.value)}
              placeholder="John Smith, Acme Corp, Jane Doe"
            />
            <span className="form-hint">Comma-separated. Shared contacts trigger cross-team alerts.</span>
          </div>

          {/* Tags */}
          <div className="form-group">
            <label className="form-label">Tags <span className="optional">(optional)</span></label>
            <input
              type="text"
              className="form-input"
              value={form.tags}
              onChange={e => handleChange('tags', e.target.value)}
              placeholder="houston, property-owner, revenue-share, garage"
            />
            <span className="form-hint">Comma-separated. Similar tags trigger deal-type alignment alerts.</span>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button
            type="submit"
            className="btn-primary submit-btn"
            disabled={submitting}
          >
            {submitting ? 'Posting...' : 'Post Update'}
          </button>
        </form>

        {/* Result panel */}
        {result && (
          <div className="post-result">
            <div className="result-success">
              <div className="result-icon">✓</div>
              <h3>Update Posted</h3>
              <p>Your update has been pushed to the <strong>{result.update?.channel}</strong> channel.</p>
            </div>

            {result.opportunity_alerts?.length > 0 ? (
              <div className="result-alerts">
                <h4>🔔 Opportunity Alerts Generated</h4>
                {result.opportunity_alerts.map(alert => (
                  <div key={alert.id} className="result-alert-item">
                    <span className="result-alert-reason">{alert.reason.replace(/_/g, ' ')}</span>
                    <p>{alert.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="result-no-alerts">
                <p>No cross-team opportunities detected for this update. The Alignment Engine will continue monitoring as new updates come in.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
