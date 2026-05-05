import { useRef, useState, useEffect, useCallback } from 'react'
import useTerminal from '../hooks/useTerminal.js'
import './TerminalPane.css'

function playDoneSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)
    setTimeout(() => ctx.close(), 1000)
  } catch {}
}

export default function TerminalPane({ id, ptyId, shell, cwd, agentNum, name, fontSize, onClose, onFocus, onRename, onPtyReady, onFontSizeChange, onAddAgent, onSwap, isFocused }) {
  const containerRef = useRef(null)
  const [done, setDone] = useState(false)
  const isFocusedRef = useRef(isFocused)
  const activityTimerRef = useRef(null)
  const awaitingResponseRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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

  // Keep isFocusedRef in sync without re-creating handleActivity
  useEffect(() => { isFocusedRef.current = isFocused }, [isFocused])

  // Clear done state when pane is focused
  useEffect(() => {
    if (isFocused && done) {
      setDone(false)
      clearTimeout(activityTimerRef.current)
    }
  }, [isFocused, done])

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(activityTimerRef.current), [])

  const handleUserInput = useCallback((data) => {
    // Only treat Enter as a prompt submission. Arrow keys, Tab,
    // typing characters, etc. shouldn't arm the "done" timer.
    if (typeof data === 'string' && (data.includes('\r') || data.includes('\n'))) {
      awaitingResponseRef.current = true
    }
  }, [])

  const handleActivity = useCallback(() => {
    if (!awaitingResponseRef.current) return
    clearTimeout(activityTimerRef.current)
    // 4s of silence after activity → assume Claude finished and is waiting
    activityTimerRef.current = setTimeout(() => {
      awaitingResponseRef.current = false
      if (!isFocusedRef.current) {
        setDone(true)
        playDoneSound()
      }
    }, 4000)
  }, [])

  const handlePtyReady = useCallback((newPtyId) => {
    onPtyReady?.(id, newPtyId)
  }, [id, onPtyReady])

  const { error, exitCode } = useTerminal(ptyId, shell, cwd, containerRef, handleActivity, handleUserInput, handlePtyReady, fontSize, onFontSizeChange)

  const handleFocus = () => {
    onFocus(id)
    if (done) {
      setDone(false)
      clearTimeout(activityTimerRef.current)
    }
  }

  // Drag-to-swap — handled on the header (so xterm content stays interactive)
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/x-codespace-terminal', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }
  const handleDragEnd = () => setDragging(false)
  const handleDragOver = (e) => {
    if (!Array.from(e.dataTransfer.types).includes('application/x-codespace-terminal')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
  const handleDrop = (e) => {
    if (!Array.from(e.dataTransfer.types).includes('application/x-codespace-terminal')) return
    e.preventDefault()
    setDragOver(false)
    const srcId = e.dataTransfer.getData('application/x-codespace-terminal')
    if (srcId && srcId !== id) onSwap?.(srcId, id)
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
        {done && !isFocused && <span className="done-badge">done</span>}
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
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : (
        <div className="xterm-container" ref={containerRef} />
      )}
    </div>
  )
}
