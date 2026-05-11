import { useRef, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import useTerminal from '../hooks/useTerminal.js'
import * as ptyPool from '../pty-pool.js'
import * as doneTracker from '../done-tracker.js'
import './TerminalPane.css'

export default function TerminalPane({ id, ptyId, shell, cwd, workspaceDir, agentNum, name, autoName, branch, fontSize, onClose, onFocus, onRename, onPtyReady, onFontSizeChange, onAddAgent, onSwap, onOpenFile, isFocused, isFullscreen, isHiddenForFullscreen, onToggleFullscreen }) {
  const containerRef = useRef(null)
  const done = useSyncExternalStore(
    doneTracker.subscribe,
    () => doneTracker.isDone(id)
  )
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Stable refs for the linkProvider — changing cwd or workspaceDir doesn't
  // re-register the provider; activation reads .current at click time.
  const cwdRef = useRef(cwd)
  const workspaceDirRef = useRef(workspaceDir)
  useEffect(() => { cwdRef.current = cwd }, [cwd])
  useEffect(() => { workspaceDirRef.current = workspaceDir }, [workspaceDir])

  const displayName = name?.trim() || autoName?.trim() || `Agent ${String(agentNum).padStart(2, '0')}`

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = (e) => {
    e.stopPropagation()
    setDraftName(displayName)
    setEditing(true)
  }

  const commitEdit = () => {
    const next = draftName.trim()
    onRename?.(id, next.length > 0 ? next : '')
    setEditing(false)
  }

  const cancelEdit = () => {
    setEditing(false)
  }

  // No auto-clear on isFocused — switching back to a workspace re-mounts its
  // focusedTerminalId pane already focused, and we don't want that passive
  // refocus to wipe the done flag before the user has seen which pane finished.
  // Done is cleared by handleFocus (mousedown on the pane) and by the window
  // focus handler in App.jsx for OS-level alt-tab returns.

  const handleUserInput = useCallback((data) => {
    doneTracker.noteUserInput(id, data)
  }, [id])

  const handlePtyReady = useCallback((newPtyId) => {
    onPtyReady?.(id, newPtyId)
  }, [id, onPtyReady])

  // No onActivity — the done-tracker subscribes to the PTY pool directly so
  // the silence timer keeps running while this pane is unmounted.
  const { error, exitCode } = useTerminal(
    id, ptyId, shell, cwd, containerRef,
    undefined, handleUserInput, handlePtyReady,
    fontSize, onFontSizeChange,
    { cwdRef, workspaceDirRef, onOpenFile }
  )

  const handleFocus = () => {
    onFocus(id)
    doneTracker.noteFocus(id)
  }

  // Drag-to-swap — handled on the header (so xterm content stays interactive).
  // The pane itself is also a drop target for OS files (images, etc.) — dropped
  // file paths are written into the PTY so Claude CLI can attach them.
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/x-codespace-terminal', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }
  const handleDragEnd = () => setDragging(false)
  const handleDragOver = (e) => {
    const types = Array.from(e.dataTransfer.types)
    const isPaneSwap = types.includes('application/x-codespace-terminal')
    const isFileDrop = types.includes('Files')
    if (!isPaneSwap && !isFileDrop) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isPaneSwap ? 'move' : 'copy'
    setDragOver(true)
  }
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
  const handleDrop = (e) => {
    const types = Array.from(e.dataTransfer.types)
    const isPaneSwap = types.includes('application/x-codespace-terminal')
    const isFileDrop = types.includes('Files')
    if (!isPaneSwap && !isFileDrop) return
    e.preventDefault()
    setDragOver(false)
    if (isPaneSwap) {
      const srcId = e.dataTransfer.getData('application/x-codespace-terminal')
      if (srcId && srcId !== id) onSwap?.(srcId, id)
      return
    }
    const paths = Array.from(e.dataTransfer.files)
      .map(f => f.path)
      .filter(p => typeof p === 'string' && p.length > 0)
    if (paths.length === 0 || !ptyId) return
    const text = paths.map(p => /[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p).join(' ')
    ptyPool.writePty(ptyId, text)
    onFocus?.(id)
  }

  return (
    <div
      className={[
        'pane',
        isFocused ? 'focused' : '',
        exitCode !== null ? 'exited' : '',
        done ? 'done' : '',
        dragging ? 'dragging' : '',
        dragOver ? 'drag-over' : '',
        isFullscreen ? 'fullscreen' : '',
        isHiddenForFullscreen ? 'hidden-fs' : ''
      ].filter(Boolean).join(' ')}
      onMouseDownCapture={handleFocus}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="pane-header"
        draggable={!editing && !isFullscreen}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDoubleClick={(e) => {
          // Ignore double-clicks on header children (label, buttons) — those
          // have their own handlers (rename, etc.). Only the bare header area
          // toggles fullscreen.
          if (e.target === e.currentTarget) onToggleFullscreen?.()
        }}
      >
        <span className={`status-dot ${exitCode !== null ? 'status-exited' : 'status-running'}`} />
        {editing ? (
          <input
            ref={inputRef}
            className="pane-label-input"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onMouseDownCapture={e => e.stopPropagation()}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
              if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
          />
        ) : (
          <span
            className="pane-label"
            title="Double-click to rename"
            onDoubleClick={startEdit}
          >
            {displayName}
          </span>
        )}
        {done && (
          <svg
            className="done-tick"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Done"
          >
            <polyline points="5 12.5 10 17.5 19 7.5" />
          </svg>
        )}
        <div className="pane-header-actions">
          <button
            className="pane-add-btn"
            title="New agent"
            onClick={e => { e.stopPropagation(); onAddAgent?.() }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className="pane-fs-btn"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={e => { e.stopPropagation(); onToggleFullscreen?.() }}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="9 4 9 9 4 9" />
                <polyline points="20 9 15 9 15 4" />
                <polyline points="15 20 15 15 20 15" />
                <polyline points="4 15 9 15 9 20" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="4 9 4 4 9 4" />
                <polyline points="15 4 20 4 20 9" />
                <polyline points="20 15 20 20 15 20" />
                <polyline points="9 20 4 20 4 15" />
              </svg>
            )}
          </button>
          <button
            className="close-btn"
            title="Close agent"
            onClick={e => { e.stopPropagation(); onClose(id) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {branch && (
        <div className="pane-subheader">
          <button
            type="button"
            className="tp-branch"
            title={`${branch} — click to copy`}
            onClick={(e) => {
              e.stopPropagation()
              window.electronAPI.writeClipboardText(branch)
            }}
          >
            <span className="tp-branch-icon" aria-hidden>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </span>
            <span className="tp-branch-text">{branch}</span>
          </button>
        </div>
      )}
      {error ? (
        <div className="pane-error">
          <div className="pane-error-title">{error.title ?? error}</div>
          {error.body && <div className="pane-error-body">{error.body}</div>}
          <button className="pane-error-btn" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      ) : (
        <div className="xterm-container" ref={containerRef} />
      )}
      {done && !error && (
        <div className="pane-done-pulse" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="pane-done-pulse-cell" />
          ))}
        </div>
      )}
    </div>
  )
}
