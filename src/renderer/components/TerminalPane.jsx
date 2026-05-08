import { useRef, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import useTerminal from '../hooks/useTerminal.js'
import * as ptyPool from '../pty-pool.js'
import * as doneTracker from '../done-tracker.js'
import './TerminalPane.css'

export default function TerminalPane({ id, ptyId, shell, cwd, workspaceDir, agentNum, name, fontSize, onClose, onFocus, onRename, onPtyReady, onFontSizeChange, onAddAgent, onSwap, onOpenFile, isFocused }) {
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

  const displayName = name?.trim() || `Agent ${String(agentNum).padStart(2, '0')}`

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

  // Clear done when this pane becomes attended (workspace active + focused).
  useEffect(() => {
    if (isFocused) doneTracker.noteFocus(id)
  }, [isFocused, id])

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
        done && !isFocused ? 'done' : '',
        dragging ? 'dragging' : '',
        dragOver ? 'drag-over' : ''
      ].filter(Boolean).join(' ')}
      onMouseDownCapture={handleFocus}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="pane-header"
        draggable={!editing}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
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
        {done && !isFocused && (
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
            +
          </button>
          <button
            className="close-btn"
            title="Close agent"
            onClick={e => { e.stopPropagation(); onClose(id) }}
          >
            ×
          </button>
        </div>
      </div>
      {error ? (
        <div className="pane-error">
          <div className="pane-error-title">{error.title ?? error}</div>
          {error.body && <div className="pane-error-body">{error.body}</div>}
          <button className="pane-error-btn" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      ) : (
        <div className="xterm-container" ref={containerRef} />
      )}
    </div>
  )
}
