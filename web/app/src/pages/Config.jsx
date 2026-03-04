import { useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import './Config.css'

export default function Config() {
  const [tab, setTab] = useState('off-limits')

  return (
    <div>
      <div className="page-header">
        <h2>Config</h2>
      </div>
      <div className="config-tabs">
        {['off-limits', 'sources', 'sectors'].map(t => (
          <button
            key={t}
            className={`config-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'off-limits' ? 'Off-limits' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'off-limits' && <OffLimitsTab />}
      {tab === 'sources' && <SourcesTab />}
      {tab === 'sectors' && <SectorsTab />}
    </div>
  )
}

function OffLimitsTab() {
  const { data, loading, error, saving, save } = useConfig('off-limits')
  const [draft, setDraft] = useState(null)
  const [newCompany, setNewCompany] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [showOlder, setShowOlder] = useState(false)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const currentWeek = `week_${getCurrentWeekNumber()}`
  const working = draft || data
  const currentEntries = working[currentWeek] || []

  // Sort weeks descending
  const weeks = Object.keys(working).filter(k => k.startsWith('week_')).sort((a, b) => {
    const na = parseInt(a.split('_')[1])
    const nb = parseInt(b.split('_')[1])
    return nb - na
  })

  const recentWeeks = weeks.filter(w => w !== currentWeek).slice(0, 2)
  const olderWeeks = weeks.filter(w => w !== currentWeek).slice(2)

  function addEntry() {
    if (!newCompany.trim() || !newTopic.trim()) return
    const updated = { ...working }
    updated[currentWeek] = [...currentEntries, { company: newCompany.trim(), topic: newTopic.trim() }]
    setDraft(updated)
    setNewCompany('')
    setNewTopic('')
  }

  function removeEntry(idx) {
    const updated = { ...working }
    updated[currentWeek] = currentEntries.filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    try {
      await save(draft)
      setDraft(null)
    } catch {
      // error state is set by useConfig hook
    }
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>Current week ({currentWeek})</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      <table className="config-table">
        <thead>
          <tr><th>Company</th><th>Topic</th><th></th></tr>
        </thead>
        <tbody>
          {currentEntries.map((entry, i) => (
            <tr key={i}>
              <td>{entry.company}</td>
              <td>{entry.topic}</td>
              <td><button className="action-btn delete-btn" onClick={() => removeEntry(i)}>{'\u2715'}</button></td>
            </tr>
          ))}
          <tr className="add-row">
            <td><input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Company" className="config-input" /></td>
            <td><input value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Topic" className="config-input" /></td>
            <td><button className="btn btn-primary btn-sm" onClick={addEntry}>Add</button></td>
          </tr>
        </tbody>
      </table>

      {recentWeeks.length > 0 && (
        <div className="config-readonly">
          <h3>Recent weeks</h3>
          {recentWeeks.map(w => (
            <ReadOnlyWeek key={w} week={w} entries={working[w]} />
          ))}
        </div>
      )}

      {olderWeeks.length > 0 && (
        <div className="config-readonly">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowOlder(!showOlder)}>
            {showOlder ? 'Hide older' : `Show ${olderWeeks.length} older weeks`}
          </button>
          {showOlder && olderWeeks.map(w => (
            <ReadOnlyWeek key={w} week={w} entries={working[w]} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReadOnlyWeek({ week, entries }) {
  return (
    <details className="readonly-week">
      <summary>{week} ({entries.length} entries)</summary>
      <ul>
        {entries.map((e, i) => <li key={i}><strong>{e.company}</strong>: {e.topic}</li>)}
      </ul>
    </details>
  )
}

function SourcesTab() {
  const { data, loading, error, saving, save } = useConfig('sources')
  const [draft, setDraft] = useState(null)
  const [newFeedInputs, setNewFeedInputs] = useState({})
  const [newQuery, setNewQuery] = useState('')

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const working = draft || data

  function addFeed(category) {
    const inputs = newFeedInputs[category]
    if (!inputs?.name?.trim() || !inputs?.url?.trim()) return
    const updated = { ...working, rss_feeds: { ...working.rss_feeds } }
    updated.rss_feeds[category] = [...(updated.rss_feeds[category] || []), { name: inputs.name.trim(), url: inputs.url.trim() }]
    setDraft(updated)
    setNewFeedInputs(prev => ({ ...prev, [category]: { name: '', url: '' } }))
  }

  function removeFeed(category, idx) {
    const updated = { ...working, rss_feeds: { ...working.rss_feeds } }
    updated.rss_feeds[category] = updated.rss_feeds[category].filter((_, i) => i !== idx)
    setDraft(updated)
  }

  function addQuery() {
    if (!newQuery.trim()) return
    const updated = { ...working }
    updated.general_search_queries = [...(updated.general_search_queries || []), newQuery.trim()]
    setDraft(updated)
    setNewQuery('')
  }

  function removeQuery(idx) {
    const updated = { ...working }
    updated.general_search_queries = updated.general_search_queries.filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    try {
      await save(draft)
      setDraft(null)
    } catch {
      // error state is set by useConfig hook
    }
  }

  function updateFeedInput(category, field, value) {
    setNewFeedInputs(prev => ({
      ...prev,
      [category]: { ...prev[category], [field]: value }
    }))
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>RSS Feeds</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      {Object.entries(working.rss_feeds || {}).map(([cat, feeds]) => (
        <div key={cat} className="feed-category">
          <h4>{cat.replace(/_/g, ' ')}</h4>
          <ul className="feed-list">
            {feeds.map((feed, i) => (
              <li key={i} className="feed-item">
                <span className="feed-name">{feed.name}</span>
                <span className="feed-url">{feed.url}</span>
                <button className="action-btn delete-btn" onClick={() => removeFeed(cat, i)}>{'\u2715'}</button>
              </li>
            ))}
          </ul>
          <div className="add-row-inline">
            <input
              className="config-input"
              placeholder="Feed name"
              value={newFeedInputs[cat]?.name || ''}
              onChange={e => updateFeedInput(cat, 'name', e.target.value)}
            />
            <input
              className="config-input"
              placeholder="Feed URL"
              value={newFeedInputs[cat]?.url || ''}
              onChange={e => updateFeedInput(cat, 'url', e.target.value)}
            />
            <button className="btn btn-primary btn-sm" onClick={() => addFeed(cat)}>Add</button>
          </div>
        </div>
      ))}

      <div className="feed-category">
        <h4>Search queries</h4>
        <ul className="feed-list">
          {(working.general_search_queries || []).map((q, i) => (
            <li key={i} className="feed-item">
              <span className="feed-name">{q}</span>
              <button className="action-btn delete-btn" onClick={() => removeQuery(i)}>{'\u2715'}</button>
            </li>
          ))}
        </ul>
        <div className="add-row-inline">
          <input
            className="config-input"
            placeholder="Search query"
            value={newQuery}
            onChange={e => setNewQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuery() } }}
          />
          <button className="btn btn-primary btn-sm" onClick={addQuery}>Add</button>
        </div>
      </div>

      {working.url_date_patterns && (
        <div className="feed-category readonly">
          <h4>URL date patterns (read-only)</h4>
          <pre className="config-readonly-block">{JSON.stringify(working.url_date_patterns, null, 2)}</pre>
        </div>
      )}

      {working.paywall_domains && (
        <div className="feed-category readonly">
          <h4>Paywall domains (read-only)</h4>
          <ul className="feed-list">
            {working.paywall_domains.map((d, i) => (
              <li key={i} className="feed-item"><span className="feed-name">{d}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SectorsTab() {
  const { data, loading, error, saving, save } = useConfig('sectors')
  const [draft, setDraft] = useState(null)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const working = draft || data

  function updateDisplayName(sectorKey, value) {
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey].display_name = value
    setDraft(updated)
  }

  function addKeyword(sectorKey, group, value) {
    if (!value.trim()) return
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey][group] = [...updated.sectors[sectorKey][group], value.trim()]
    setDraft(updated)
  }

  function removeKeyword(sectorKey, group, idx) {
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey][group] = updated.sectors[sectorKey][group].filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    try {
      await save(draft)
      setDraft(null)
    } catch {
      // error state is set by useConfig hook
    }
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>Sector Keywords</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      {Object.entries(working.sectors || {}).map(([key, sector]) => (
        <div key={key} className="sector-config">
          <div className="sector-header">
            <input
              className="sector-display-name"
              value={sector.display_name}
              onChange={e => updateDisplayName(key, e.target.value)}
            />
            <span className="sector-key">({key})</span>
          </div>

          {['required_any_group_1', 'required_any_group_2', 'boost'].map(group => (
            <KeywordGroup
              key={group}
              label={group.replace(/_/g, ' ')}
              keywords={sector[group] || []}
              onAdd={(val) => addKeyword(key, group, val)}
              onRemove={(idx) => removeKeyword(key, group, idx)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function KeywordGroup({ label, keywords, onAdd, onRemove }) {
  const [input, setInput] = useState('')

  function handleAdd() {
    if (!input.trim()) return
    onAdd(input)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="keyword-group">
      <span className="keyword-group-label">{label}</span>
      <div className="keyword-pills">
        {keywords.map((k, i) => (
          <span key={i} className="keyword-pill editable">
            {k}
            <button className="pill-remove" onClick={() => onRemove(i)}>{'\u2715'}</button>
          </span>
        ))}
        <input
          className="keyword-input"
          placeholder="Add..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleAdd}
        />
      </div>
    </div>
  )
}

function getCurrentWeekNumber() {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const start = new Date(jan4)
  start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const diff = now - start
  const oneWeek = 604800000
  return Math.ceil(diff / oneWeek)
}
