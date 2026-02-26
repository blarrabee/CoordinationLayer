import { useState, useEffect } from 'react'
import { listKeys, createKey, revokeKey, getInstructions } from '../api'

const CHANNELS = ['Blaise', 'Alex', 'Joey', 'Matt', 'Sam', 'Kayla', 'Mia', 'Devon', 'Kinsey']

const ROLE_COLORS = {
  admin: '#ef4444',
  agent: '#3b82f6',
  readonly: '#64748b',
}

const ROLE_DESC = {
  admin: 'Full access — manage keys, read/write all channels',
  agent: 'Scoped to one channel — can post + read',
  readonly: 'Read-only — can pull updates and alerts, cannot post',
}

export default function KeyManager() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState(null) // the newly created key (shown once)
  const [revoking, setRevoking] = useState(null)
  const [instructionsChannel, setInstructionsChannel] = useState(null)
  const [instructionsData, setInstructionsData] = useState(null)
  const [instructionsLoading, setInstructionsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Create form state
  const [form, setForm] = useState({ label: '', channel_name: '', role: 'agent' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    try {
      setLoading(true)
      const data = await listKeys()
      setKeys(data.keys || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load keys — admin role required')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.label.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      const payload = { label: form.label.trim(), role: form.role }
      if (form.role === 'agent' && form.channel_name) payload.channel_name = form.channel_name
      const result = await createKey(payload)
      setNewKey(result)
      setShowCreate(false)
      setForm({ label: '', channel_name: '', role: 'agent' })
      loadKeys()
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id, label) {
    if (!window.confirm(`Revoke key "${label}"? This cannot be undone.`)) return
    setRevoking(id)
    try {
      await revokeKey(id)
      loadKeys()
    } catch (err) {
      alert('Failed to revoke key')
    } finally {
      setRevoking(null)
    }
  }

  async function handleViewInstructions(channel) {
    setInstructionsChannel(channel)
    setInstructionsData(null)
    setInstructionsLoading(true)
    try {
      const data = await getInstructions(channel)
      setInstructionsData(data)
    } catch (err) {
      setInstructionsData({ error: err.response?.data?.error || 'Failed to load instructions' })
    } finally {
      setInstructionsLoading(false)
    }
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const activeKeys = keys.filter(k => k.is_active)
  const revokedKeys = keys.filter(k => !k.is_active)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>API Key Management</h1>
          <p className="page-sub">Create and revoke keys for each team member's agent</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + New Key
        </button>
      </div>

      {/* New key just created — show once */}
      {newKey && (
        <div className="new-key-banner">
          <div className="new-key-header">
            <span className="new-key-title">New key created — save this now, it won't be shown again</span>
            <button className="btn-ghost-sm" onClick={() => setNewKey(null)}>Dismiss</button>
          </div>
          <div className="new-key-display">
            <code className="key-code">{newKey.key}</code>
            <button
              className={`btn-ghost-sm ${copied ? 'copied' : ''}`}
              onClick={() => handleCopy(newKey.key)}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="new-key-meta">
            <span className="role-badge" style={{ background: ROLE_COLORS[newKey.role] + '22', color: ROLE_COLORS[newKey.role], border: `1px solid ${ROLE_COLORS[newKey.role]}44` }}>
              {newKey.role}
            </span>
            {newKey.channel_name && <span className="key-channel">Channel: {newKey.channel_name}</span>}
            <span className="key-label-text">{newKey.label}</span>
          </div>
        </div>
      )}

      {/* Create key form */}
      {showCreate && (
        <div className="create-key-card card">
          <div className="card-header">
            <h2>Create New API Key</h2>
            <button className="btn-ghost-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
          <form onSubmit={handleCreate} className="create-key-form">
            <div className="create-key-grid">
              <div className="form-group">
                <label className="form-label">Label</label>
                <input
                  className="form-input"
                  placeholder="e.g. Sam Agent Key"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="filter-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, channel_name: '' }))}>
                  <option value="agent">agent — scoped to one channel</option>
                  <option value="readonly">readonly — read all, post nothing</option>
                  <option value="admin">admin — full access</option>
                </select>
                <span className="form-hint">{ROLE_DESC[form.role]}</span>
              </div>
              {form.role === 'agent' && (
                <div className="form-group">
                  <label className="form-label">Channel <span className="optional">(required for agent)</span></label>
                  <select className="filter-select" value={form.channel_name} onChange={e => setForm(f => ({ ...f, channel_name: e.target.value }))} required>
                    <option value="">Select channel...</option>
                    {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
              )}
            </div>
            {createError && <div className="form-error">{createError}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button className="btn-primary" type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create Key'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="loading">Loading keys...</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="keys-section">
          <div className="card">
            <div className="card-header">
              <h2>Active Keys ({activeKeys.length})</h2>
            </div>
            {activeKeys.length === 0 ? (
              <div className="empty-state">No active keys</div>
            ) : (
              <div className="keys-table">
                <div className="keys-table-header">
                  <span>Label / Channel</span>
                  <span>Role</span>
                  <span>Key Prefix</span>
                  <span>Last Used</span>
                  <span>Created</span>
                  <span>Actions</span>
                </div>
                {activeKeys.map(k => (
                  <div key={k.id} className="key-row">
                    <div className="key-label-col">
                      <span className="key-label">{k.label}</span>
                      {k.channel_name && (
                        <span className="key-channel-badge">{k.channel_name}</span>
                      )}
                    </div>
                    <span>
                      <span className="role-badge" style={{ background: ROLE_COLORS[k.role] + '22', color: ROLE_COLORS[k.role], border: `1px solid ${ROLE_COLORS[k.role]}44` }}>
                        {k.role}
                      </span>
                    </span>
                    <code className="key-prefix">{k.key_prefix}...</code>
                    <span className="key-time">{k.last_used_at ? formatRelative(k.last_used_at) : 'Never'}</span>
                    <span className="key-time">{formatRelative(k.created_at)}</span>
                    <div className="key-actions">
                      {k.channel_name && (
                        <button
                          className="btn-ghost-sm"
                          onClick={() => handleViewInstructions(k.channel_name)}
                        >
                          Instructions
                        </button>
                      )}
                      <button
                        className="btn-danger-sm"
                        onClick={() => handleRevoke(k.id, k.label)}
                        disabled={revoking === k.id}
                      >
                        {revoking === k.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {revokedKeys.length > 0 && (
            <div className="card" style={{ marginTop: '1rem', opacity: 0.6 }}>
              <div className="card-header">
                <h2>Revoked Keys ({revokedKeys.length})</h2>
              </div>
              <div className="keys-table">
                {revokedKeys.map(k => (
                  <div key={k.id} className="key-row revoked">
                    <div className="key-label-col">
                      <span className="key-label" style={{ textDecoration: 'line-through' }}>{k.label}</span>
                      {k.channel_name && <span className="key-channel-badge">{k.channel_name}</span>}
                    </div>
                    <span><span className="role-badge" style={{ background: '#64748b22', color: '#64748b', border: '1px solid #64748b44' }}>{k.role}</span></span>
                    <code className="key-prefix" style={{ opacity: 0.5 }}>{k.key_prefix}...</code>
                    <span className="key-time">{k.last_used_at ? formatRelative(k.last_used_at) : 'Never'}</span>
                    <span className="key-time">{formatRelative(k.created_at)}</span>
                    <span className="key-time" style={{ color: '#ef4444' }}>Revoked</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions modal */}
      {instructionsChannel && (
        <div className="modal-overlay" onClick={() => setInstructionsChannel(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Agent Instructions — {instructionsChannel}</h2>
              <button className="btn-ghost-sm" onClick={() => setInstructionsChannel(null)}>Close</button>
            </div>
            {instructionsLoading ? (
              <div className="loading">Generating instructions...</div>
            ) : instructionsData?.error ? (
              <div className="form-error">{instructionsData.error}</div>
            ) : instructionsData ? (
              <div className="instructions-body">
                <p className="instructions-note">
                  Copy this system prompt and paste it into the agent's AI system instructions. Replace the masked key placeholder with the agent's actual API key.
                </p>
                <div className="instructions-toolbar">
                  <button
                    className={`btn-ghost-sm ${copied ? 'copied' : ''}`}
                    onClick={() => handleCopy(instructionsData.system_prompt)}
                  >
                    {copied ? 'Copied!' : 'Copy Prompt'}
                  </button>
                </div>
                <pre className="instructions-pre">{instructionsData.system_prompt}</pre>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function formatRelative(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
