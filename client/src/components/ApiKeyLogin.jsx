import { useState } from 'react'
import { getMyKeyInfo, setStoredApiKey } from '../api'

export default function ApiKeyLogin({ onAuthenticated }) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!key.trim()) return
    setLoading(true)
    setError('')
    try {
      setStoredApiKey(key.trim())
      const info = await getMyKeyInfo()
      onAuthenticated(info)
    } catch (err) {
      setStoredApiKey('')
      setError(err.response?.data?.error || 'Invalid API key — check and try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">TP</div>
        <h1 className="login-title">TruxParking</h1>
        <p className="login-sub">Agent Coordination Layer</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              className="form-input"
              type="password"
              placeholder="trux_agt_... or trux_adm_..."
              value={key}
              onChange={e => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="form-hint">
              Paste your API key. Contact your admin if you don't have one.
            </span>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button className="btn-primary" type="submit" disabled={loading || !key.trim()}>
            {loading ? 'Verifying...' : 'Connect'}
          </button>
        </form>

        <div className="login-footer">
          <p>Keys are stored locally in your browser only.</p>
        </div>
      </div>
    </div>
  )
}
