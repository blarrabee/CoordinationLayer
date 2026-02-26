import { useEffect, useState, useCallback } from 'react'
import { getUpdates } from '../api'
import UpdateCard from './UpdateCard'

const UPDATE_TYPES = ['crm_change', 'email_insight', 'deal_update', 'action_item', 'note']

export default function Feed({ channels }) {
  const [updates, setUpdates] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    channel: '',
    type: '',
    since: '',
    until: '',
    keyword: '',
  })
  const [offset, setOffset] = useState(0)
  const LIMIT = 20

  const fetchUpdates = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: off }
      if (filters.channel) params.channel = filters.channel
      if (filters.type) params.type = filters.type
      if (filters.since) params.since = filters.since
      if (filters.until) params.until = filters.until
      if (filters.keyword) params.keyword = filters.keyword

      const data = await getUpdates(params)
      setUpdates(data.updates || [])
      setTotal(data.total || 0)
      setOffset(off)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchUpdates(0)
  }, [fetchUpdates])

  const handleFilterChange = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }))
  }

  const clearFilters = () => {
    setFilters({ channel: '', type: '', since: '', until: '', keyword: '' })
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="feed-page">
      <div className="page-header">
        <h1>Activity Feed</h1>
        <p className="page-sub">All updates across every agent channel</p>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <select
          value={filters.channel}
          onChange={e => handleFilterChange('channel', e.target.value)}
          className="filter-select"
        >
          <option value="">All Channels</option>
          {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
        </select>

        <select
          value={filters.type}
          onChange={e => handleFilterChange('type', e.target.value)}
          className="filter-select"
        >
          <option value="">All Types</option>
          {UPDATE_TYPES.map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>

        <input
          type="date"
          value={filters.since}
          onChange={e => handleFilterChange('since', e.target.value)}
          className="filter-input"
          placeholder="From date"
        />

        <input
          type="date"
          value={filters.until}
          onChange={e => handleFilterChange('until', e.target.value)}
          className="filter-input"
          placeholder="To date"
        />

        <input
          type="text"
          value={filters.keyword}
          onChange={e => handleFilterChange('keyword', e.target.value)}
          className="filter-input keyword-input"
          placeholder="Search keyword..."
        />

        {hasFilters && (
          <button className="btn-ghost" onClick={clearFilters}>Clear</button>
        )}
      </div>

      {/* Results count */}
      <div className="results-meta">
        {loading ? 'Loading...' : `${total} update${total !== 1 ? 's' : ''} found`}
      </div>

      {/* Updates list */}
      {loading ? (
        <div className="loading">Loading updates...</div>
      ) : updates.length === 0 ? (
        <div className="empty-state large">
          No updates found. {hasFilters ? 'Try adjusting your filters.' : 'Post the first update to get started.'}
        </div>
      ) : (
        <>
          <div className="updates-list">
            {updates.map(u => (
              <UpdateCard key={u.id} update={u} onDeleted={() => fetchUpdates(offset)} />
            ))}
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="pagination">
              <button
                className="btn-secondary"
                disabled={offset === 0}
                onClick={() => fetchUpdates(Math.max(0, offset - LIMIT))}
              >
                Previous
              </button>
              <span className="page-info">
                {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
              </span>
              <button
                className="btn-secondary"
                disabled={offset + LIMIT >= total}
                onClick={() => fetchUpdates(offset + LIMIT)}
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
