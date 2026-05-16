import { useEffect, useRef, useState } from 'react'
import './Sidebar.css'

const PlusGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const GearGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default function Sidebar({ workspaces, activeId, notifyingIds, onSelect, onCreate, onDelete, onOpenSettings }) {
  const listRef = useRef(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
  }, [])

  // Roving keyboard nav across workspace items: Up/Down to move focus,
  // Enter/Space to activate, Home/End to jump to extremes.
  const handleKeyDown = (e, index) => {
    const items = listRef.current?.querySelectorAll('[data-sb-item]')
    if (!items || items.length === 0) return
    const focus = (i) => items[Math.max(0, Math.min(items.length - 1, i))]?.focus()
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(index + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(index - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(items.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(workspaces[index].id)
    }
    else if (e.key === 'Delete' || (e.shiftKey && e.key === 'Backspace')) {
      e.preventDefault()
      onDelete(workspaces[index].id)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <span className="sb-header-label">workspaces</span>
        <button
          type="button"
          className="sb-header-add"
          title="New workspace"
          onClick={onCreate}
        >
          <PlusGlyph />
        </button>
      </div>

      <div className="sb-list" role="listbox" aria-label="Workspaces" ref={listRef}>
        {workspaces.map((ws, i) => {
          const isActive = ws.id === activeId
          const isNotifying = notifyingIds?.has(ws.id) ?? false
          const isDraft = !!ws.unconfigured
          const count = ws.spawned
            ? (ws.terminals?.length ?? 0)
            : (ws.agentCounts?.claude ?? 0) + (ws.agentCounts?.codex ?? 0)
          return (
            <div
              key={ws.id}
              data-sb-item
              role="option"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`sb-item${isActive ? ' active' : ''}${isDraft ? ' draft' : ''}`}
              onClick={() => onSelect(ws.id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            >
              <span className="sb-item-bar" />
              <span className="sb-item-name" title={ws.name}>{ws.name}</span>
              <span className="sb-item-status" aria-hidden>
                {isNotifying && <span className="sb-item-dot" title="An agent finished" />}
                {ws.isolated && (
                  <span className="sb-iso" title="Isolated agents" aria-label="Isolated agents">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="url(#sb-iso-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <defs>
                        <linearGradient id="sb-iso-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#67e8f9" />
                          <stop offset="100%" stopColor="#86efac" />
                        </linearGradient>
                      </defs>
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                  </span>
                )}
                <span className="sb-item-count">{isDraft ? '✦' : count}</span>
              </span>
              <button
                className="sb-item-delete"
                title="Delete workspace"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(ws.id)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      <div className="sb-footer">
        <button
          type="button"
          className="sb-footer-btn"
          title="Settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <GearGlyph />
        </button>
        {version && (
          <a
            href="#"
            className="sb-footer-version"
            title={`Release notes for v${version}`}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI?.openExternal?.(`https://github.com/tayyabjdr/CodeSpace/releases/tag/v${version}`)
            }}
          >
            v{version}
          </a>
        )}
      </div>
    </aside>
  )
}
