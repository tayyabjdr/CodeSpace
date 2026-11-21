import { useEffect, useMemo, useRef, useState } from 'react'
import WorkspaceRow from './WorkspaceRow.jsx'
import SessionRow, { sessionLabel } from './SessionRow.jsx'
import AgentCard from './AgentCard.jsx'
import './Sidebar.css'

// How long a drag has to rest on a workspace before it opens.
const SPRING_OPEN_MS = 500

const PlusGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const GearGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const SkillsGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5h6a4 4 0 0 1 4 4V20a3 3 0 0 0-3-3H2z" />
    <path d="M22 4.5h-6a4 4 0 0 0-4 4V20a3 3 0 0 1 3-3h7z" />
  </svg>
)

export default function Sidebar({
  collapsed = false,
  workspaces, activeId, expandedIds, doneTermIds, exitedPtyIds, focusedTerminalId,
  skillsOpen, onToggleSkills,
  onSelect, onToggleExpand, onSelectSession, onCreate, onDelete, onOpenSettings, onRenameNickname, onToggleIsolated
}) {
  const listRef = useRef(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
  }, [])

  const sessionsOf = (ws) => (ws.spawned ? (ws.terminals ?? []) : [])

  // Spring-loaded workspaces: while dragging a file or skill, holding it over
  // another workspace's block opens that workspace so the drop can land in
  // one of its panes. Pane-swap drags are excluded — a pane can't be swapped
  // into a different workspace. The sidebar never accepts the drop itself.
  const [dragHoverId, setDragHoverId] = useState(null)
  const springTimerRef = useRef(null)
  const clearSpring = () => {
    clearTimeout(springTimerRef.current)
    springTimerRef.current = null
    setDragHoverId(null)
  }
  useEffect(() => {
    const end = () => clearSpring()
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
      clearTimeout(springTimerRef.current)
    }
  }, [])
  const isSpringDrag = (e) => {
    const types = Array.from(e.dataTransfer?.types ?? [])
    return types.length > 0 && !types.includes('application/x-codespace-terminal')
  }
  const handleGroupDragOver = (e, wsId) => {
    if (!isSpringDrag(e)) return
    if (wsId === activeId) { if (dragHoverId) clearSpring(); return }
    if (dragHoverId === wsId) return
    clearTimeout(springTimerRef.current)
    setDragHoverId(wsId)
    springTimerRef.current = setTimeout(() => {
      springTimerRef.current = null
      setDragHoverId(null)
      onSelect(wsId)
    }, SPRING_OPEN_MS)
  }
  const handleGroupDragLeave = (e, wsId) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dragHoverId === wsId) clearSpring()
  }

  // The agent card follows the focused agent of the active workspace, and
  // only for an isolated workspace, where each agent has its own branch.
  const activeWs = workspaces.find(w => w.id === activeId)
  const cardTerm = activeWs?.isolated && activeWs.dir
    ? sessionsOf(activeWs).find(t => t.id === focusedTerminalId && t.branch) ?? null
    : null

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

  // The same nodes bunched per workspace, each keeping its index into `flat`
  // for roving navigation. A workspace and its agents render inside one
  // container, so the active workspace highlights as a single block.
  const groups = useMemo(() => {
    const out = []
    flat.forEach((node, i) => {
      if (node.kind === 'workspace') out.push({ ws: node.ws, nodes: [] })
      out[out.length - 1].nodes.push({ node, i })
    })
    return out
  }, [flat])

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
      // A childless workspace (or a session leaf) has nothing to expand
      // into — ARIA APG says Right should absorb the keypress there, not
      // behave like ArrowDown.
      if (node.kind === 'workspace' && sessionsOf(node.ws).length > 0) {
        if (!expandedIds?.has(node.ws.id)) onToggleExpand(node.ws.id)
        else focus(index + 1)
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
    <aside
      className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-hidden={collapsed || undefined}
    >
      {/* Skills is a tab that toggles its panel. */}
      <nav className="sb-nav" aria-label="Tools">
        <button
          type="button"
          className={`sb-nav-item${skillsOpen ? ' is-open' : ''}`}
          aria-pressed={skillsOpen}
          onClick={onToggleSkills}
        >
          <span className="sb-nav-icon" aria-hidden><SkillsGlyph /></span>
          <span className="sb-nav-label">Skills</span>
        </button>
      </nav>

      {/* A section label, not a tab: it heads the list and carries the add
          button, so it shouldn't look like another Skills-style button. */}
      <div className="sb-section">
        <span className="sb-section-label">Workspaces</span>
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
        {groups.map(group => (
          <div
            key={'group' + group.ws.id}
            className={`sb-group${group.ws.id === activeId ? ' active' : ''}${group.ws.id === dragHoverId ? ' drag-hover' : ''}`}
            onDragOver={(e) => handleGroupDragOver(e, group.ws.id)}
            onDragLeave={(e) => handleGroupDragLeave(e, group.ws.id)}
          >
          {group.nodes.map(({ node, i }) => (
          <div key={node.kind + node.id} onKeyDown={(e) => handleKeyDown(e, i)}>
            {node.kind === 'workspace' ? (
              <WorkspaceRow
                ws={node.ws}
                isActive={node.ws.id === activeId}
                isExpanded={!!expandedIds?.has(node.ws.id)}
                hasSessions={sessionsOf(node.ws).length > 0}
                doneCount={sessionsOf(node.ws).filter(t => doneTermIds?.has(t.id) && !exitedPtyIds?.has(t.ptyId)).length}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onDelete={onDelete}
                onRenameNickname={onRenameNickname}
                onToggleIsolated={onToggleIsolated}
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
        ))}
      </div>

      {cardTerm && (
        <AgentCard
          key={cardTerm.id}
          agentId={cardTerm.id}
          ptyId={cardTerm.ptyId}
          repoDir={activeWs.dir}
          agentName={sessionLabel(cardTerm)}
          branch={cardTerm.branch}
        />
      )}

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
