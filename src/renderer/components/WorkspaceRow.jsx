import { useEffect, useRef, useState } from 'react'

const ChevronGlyph = ({ open }) => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }}
    aria-hidden
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

const IsolatedGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="url(#sb-iso-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <defs>
      <linearGradient id="sb-iso-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="var(--cs-state-isolated)" />
        <stop offset="100%" stopColor="var(--cs-state-running)" />
      </linearGradient>
    </defs>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

export default function WorkspaceRow({
  ws, isActive, isExpanded, hasSessions, showDoneDot,
  onSelect, onToggleExpand, onDelete, onRenameNickname, onToggleIsolated
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const isDraft = !!ws.unconfigured
  const count = ws.spawned
    ? (ws.terminals?.length ?? 0)
    : (ws.agentCounts?.claude ?? 0) + (ws.agentCounts?.codex ?? 0)

  const liveCount = ws.terminals?.length ?? 0

  const startEdit = (e) => {
    e.stopPropagation()
    setDraft(ws.nickname ?? '')
    setEditing(true)
  }

  const commit = () => {
    if (!editing) return
    setEditing(false)
    onRenameNickname?.(ws.id, draft)
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
  }

  const handleNicknameKeyDown = (e) => {
    if (e.key === 'Enter')       { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
    e.stopPropagation()   // never let input chars reach the tree's roving nav
  }

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-selected={isActive}
      aria-expanded={hasSessions ? isExpanded : undefined}
      tabIndex={isActive ? 0 : -1}
      data-sb-node
      data-sb-kind="workspace"
      data-sb-id={ws.id}
      className={`sb-item${isActive ? ' active' : ''}${isDraft ? ' draft' : ''}`}
      onClick={() => onSelect(ws.id)}
      onDoubleClick={startEdit}
    >
      {hasSessions ? (
        <button
          type="button"
          className="sb-chevron"
          tabIndex={-1}
          aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(ws.id) }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronGlyph open={isExpanded} />
        </button>
      ) : (
        <span className="sb-chevron-spacer" aria-hidden />
      )}

      <div className="sb-item-text">
        <span className="sb-item-name" title={ws.name}>{ws.name}</span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            className="sb-item-nickname-input"
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleNicknameKeyDown}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="Edit nickname"
          />
        ) : ws.nickname ? (
          <span className="sb-item-nickname" title={ws.nickname}>
            {ws.nickname}
          </span>
        ) : null}
      </div>

      {/* The count and the delete button share one fixed slot, centred on the
          same point, so the x lands exactly where the number was. Delete is
          absolute inside the slot, so the status row's flex gap never moves it. */}
      <span className="sb-item-status">
        {showDoneDot && !isExpanded && (
          <span className="sb-item-dot" title="An agent finished" aria-hidden />
        )}
        {ws.isolated && (
          <button
            type="button"
            className="sb-iso"
            tabIndex={-1}
            disabled={liveCount > 0}
            title={liveCount > 0
              ? "Isolated agents. Close this workspace's agents to turn off."
              : 'Isolated agents. Click to turn off.'}
            aria-label={liveCount > 0
              ? "Isolated agents. Close this workspace's agents to turn off."
              : 'Isolated agents. Click to turn off.'}
            onClick={(e) => { e.stopPropagation(); onToggleIsolated?.(ws.id, false) }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <IsolatedGlyph />
          </button>
        )}
        <span className="sb-item-slot">
          <span className="sb-item-count" aria-hidden>{isDraft ? '✦' : count}</span>
          <button
            className="sb-item-delete"
            title="Delete workspace"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onDelete(ws.id) }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </span>
      </span>
    </div>
  )
}
