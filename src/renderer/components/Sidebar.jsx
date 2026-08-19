import { useEffect, useMemo, useRef, useState } from 'react'
import WorkspaceRow from './WorkspaceRow.jsx'
import SessionRow from './SessionRow.jsx'
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

export default function Sidebar({
  workspaces, activeId, expandedIds, doneTermIds, exitedPtyIds, focusedTerminalId,
  onSelect, onToggleExpand, onSelectSession, onCreate, onDelete, onOpenSettings, onRenameNickname
}) {
  const listRef = useRef(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
  }, [])

  const sessionsOf = (ws) => (ws.spawned ? (ws.terminals ?? []) : [])

  const statusOf = (term) => {
    if (exitedPtyIds?.has(term.ptyId)) return 'exited'
    if (doneTermIds?.has(term.id)) return 'done'
    return 'running'
  }

  // The visible flattened list drives roving navigation: a collapsed
  // workspace's sessions are not in the sequence at all.
  const flat = useMemo(() => {
    const out = []
    for (const ws of workspaces) {
      out.push({ kind: 'workspace', id: ws.id, ws })
      if (expandedIds?.has(ws.id)) {
        for (const t of sessionsOf(ws)) out.push({ kind: 'session', id: t.id, ws, term: t })
      }
    }
    return out
  }, [workspaces, expandedIds])

  const handleKeyDown = (e, index) => {
    // A focused nickname input owns its keys; bail before touching anything.
    if (e.target.tagName === 'INPUT') return

    const nodes = listRef.current?.querySelectorAll('[data-sb-node]')
    if (!nodes || nodes.length === 0) return
    const focus = (i) => nodes[Math.max(0, Math.min(nodes.length - 1, i))]?.focus()
    const node = flat[index]

    if (e.key === 'ArrowDown') { e.preventDefault(); focus(index + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(index - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(nodes.length - 1) }
    else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (node.kind === 'workspace' && sessionsOf(node.ws).length > 0 && !expandedIds?.has(node.ws.id)) {
        onToggleExpand(node.ws.id)
      } else if (node.kind === 'workspace') {
        focus(index + 1)
      }
    }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (node.kind === 'session') {
        focus(flat.findIndex(n => n.kind === 'workspace' && n.ws.id === node.ws.id))
      } else if (expandedIds?.has(node.ws.id)) {
        onToggleExpand(node.ws.id)
      }
    }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (node.kind === 'workspace') onSelect(node.ws.id)
      else onSelectSession(node.ws.id, node.term.id)
    }
    else if (e.key === 'Delete' || (e.shiftKey && e.key === 'Backspace')) {
      if (node.kind !== 'workspace') return
      e.preventDefault()
      onDelete(node.ws.id)
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

      <div className="sb-list" role="tree" aria-label="Workspaces" ref={listRef}>
        {flat.map((node, i) => (
          <div key={node.kind + node.id} onKeyDown={(e) => handleKeyDown(e, i)}>
            {node.kind === 'workspace' ? (
              <WorkspaceRow
                ws={node.ws}
                isActive={node.ws.id === activeId}
                isExpanded={!!expandedIds?.has(node.ws.id)}
                hasSessions={sessionsOf(node.ws).length > 0}
                showDoneDot={sessionsOf(node.ws).some(t => doneTermIds?.has(t.id))}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onDelete={onDelete}
                onRenameNickname={onRenameNickname}
              />
            ) : (
              <div role="group">
                <SessionRow
                  term={node.term}
                  status={statusOf(node.term)}
                  isFocused={node.ws.id === activeId && node.term.id === focusedTerminalId}
                  onSelect={(termId) => onSelectSession(node.ws.id, termId)}
                />
              </div>
            )}
          </div>
        ))}
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
