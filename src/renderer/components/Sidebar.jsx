import { useRef } from 'react'
import './Sidebar.css'

const PlusGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export default function Sidebar({ workspaces, activeId, notifyingIds, onSelect, onCreate, onDelete }) {
  const listRef = useRef(null)

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
          const count = ws.spawned ? (ws.terminals?.length ?? 0) : ws.agentCount
          return (
            <div
              key={ws.id}
              data-sb-item
              role="option"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`sb-item${isActive ? ' active' : ''}`}
              onClick={() => onSelect(ws.id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
            >
              <span className="sb-item-bar" />
              <span className="sb-item-name" title={ws.name}>{ws.name}</span>
              {ws.isolated && (
                <span className="sb-iso" title="Isolated agents" aria-label="Isolated agents">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </span>
              )}
              <span className="sb-item-status" aria-hidden>
                {isNotifying && <span className="sb-item-dot" title="An agent finished" />}
                <span className="sb-item-count">{count}</span>
              </span>
              <button
                className="sb-item-delete"
                title="Delete workspace"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(ws.id)
                }}
              >×</button>
            </div>
          )
        })}
      </div>

      <button className="sb-new-btn" onClick={onCreate}>
        <PlusGlyph />
        <span>New Workspace</span>
      </button>
    </aside>
  )
}
