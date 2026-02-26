import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import Feed from './components/Feed'
import Alerts from './components/Alerts'
import PostUpdate from './components/PostUpdate'
import ChannelView from './components/ChannelView'
import KeyManager from './components/KeyManager'
import ApiKeyLogin from './components/ApiKeyLogin'
import { getStoredApiKey, setStoredApiKey, getMyKeyInfo } from './api'
import './App.css'

const CHANNELS = ['Blaise', 'Alex', 'Joey', 'Matt', 'Sam', 'Kayla', 'Mia', 'Devon', 'Kinsey']

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [keyInfo, setKeyInfo] = useState(null) // null = not authenticated
  const [authLoading, setAuthLoading] = useState(true)

  // On mount, try to restore session from stored key
  useEffect(() => {
    const stored = getStoredApiKey()
    if (stored) {
      getMyKeyInfo()
        .then(info => setKeyInfo(info))
        .catch(() => {
          setStoredApiKey('')
          setKeyInfo(null)
        })
        .finally(() => setAuthLoading(false))
    } else {
      setAuthLoading(false)
    }
  }, [])

  const handleRefresh = () => setRefreshKey(k => k + 1)

  const handleLogout = () => {
    setStoredApiKey('')
    setKeyInfo(null)
    setActiveTab('dashboard')
  }

  const isAdmin = keyInfo?.role === 'admin'

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'feed', label: 'Activity Feed' },
    { id: 'alerts', label: 'Opportunity Alerts' },
    { id: 'post', label: 'Post Update' },
    ...(isAdmin ? [{ id: 'keys', label: 'API Keys' }] : []),
  ]

  if (authLoading) {
    return (
      <div className="app">
        <div className="loading" style={{ marginTop: '30vh', fontSize: '1rem' }}>
          Connecting...
        </div>
      </div>
    )
  }

  if (!keyInfo) {
    return <ApiKeyLogin onAuthenticated={(info) => setKeyInfo(info)} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo">TP</div>
          <div className="brand-text">
            <span className="brand-name">TruxParking</span>
            <span className="brand-sub">Agent Coordination Layer</span>
          </div>
        </div>
        <nav className="app-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-btn ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(item.id); setSelectedChannel(null) }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="channel-pills">
          {CHANNELS.map(ch => (
            <button
              key={ch}
              className={`channel-pill ${selectedChannel === ch && activeTab === 'channel' ? 'active' : ''}`}
              onClick={() => {
                setSelectedChannel(ch)
                setActiveTab('channel')
              }}
              title={ch}
            >
              {ch[0]}
            </button>
          ))}
        </div>
        <div className="header-user">
          <span className="user-badge">
            <span className="user-role-dot" style={{ background: keyInfo.role === 'admin' ? '#ef4444' : keyInfo.role === 'readonly' ? '#64748b' : '#3b82f6' }} />
            {keyInfo.channel_name || keyInfo.label}
          </span>
          <button className="btn-ghost-sm" onClick={handleLogout} title="Sign out">
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'dashboard' && (
          <Dashboard
            key={refreshKey}
            onChannelSelect={(ch) => { setSelectedChannel(ch); setActiveTab('channel') }}
          />
        )}
        {activeTab === 'feed' && <Feed key={refreshKey} channels={CHANNELS} />}
        {activeTab === 'alerts' && <Alerts key={refreshKey} channels={CHANNELS} />}
        {activeTab === 'post' && (
          <PostUpdate
            channels={CHANNELS}
            onSuccess={handleRefresh}
            defaultChannel={keyInfo.role === 'agent' ? keyInfo.channel_name : null}
            isAgent={keyInfo.role === 'agent'}
          />
        )}
        {activeTab === 'keys' && isAdmin && <KeyManager />}
        {activeTab === 'channel' && selectedChannel && (
          <ChannelView
            key={`${selectedChannel}-${refreshKey}`}
            channel={selectedChannel}
            onBack={() => setActiveTab('dashboard')}
          />
        )}
      </main>
    </div>
  )
}
