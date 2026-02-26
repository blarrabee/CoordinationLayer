import { useState } from 'react'
import Dashboard from './components/Dashboard'
import Feed from './components/Feed'
import Alerts from './components/Alerts'
import PostUpdate from './components/PostUpdate'
import ChannelView from './components/ChannelView'
import './App.css'

const CHANNELS = ['Blaise', 'Alex', 'Joey', 'Matt', 'Sam', 'Kayla', 'Mia', 'Devon', 'Kinsey']

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = () => setRefreshKey(k => k + 1)

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'feed', label: 'Activity Feed' },
    { id: 'alerts', label: 'Opportunity Alerts' },
    { id: 'post', label: 'Post Update' },
  ]

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
        {activeTab === 'post' && <PostUpdate channels={CHANNELS} onSuccess={handleRefresh} />}
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
