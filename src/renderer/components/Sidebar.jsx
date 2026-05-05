import './Sidebar.css'

const PlusGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export default function Sidebar({ workspaces, activeId, onSelect, onCreate, onDelete }) {
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

      <div className="sb-list">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeId
          const liveCount = ws.terminals?.length ?? 0
          return (
            <div
              key={ws.id}
              className={`sb-item${isActive ? ' active' : ''}`}
              onClick={() => onSelect(ws.id)}
            >
              <span className="sb-item-bar" />
              <span className="sb-item-name" title={ws.name}>{ws.name}</span>
              <span className="sb-item-status" aria-hidden>
                {liveCount > 0 && <span className="sb-item-dot" />}
                <span className="sb-item-count">{liveCount}</span>
              </span>
              <button
                className="sb-item-delete"
                title="Delete workspace"
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
