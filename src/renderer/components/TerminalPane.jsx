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

export default function TerminalPane({ id, shell, cwd, agentNum, onClose, onFocus, isFocused }) {
  const containerRef = useRef(null)
  const [done, setDone] = useState(false)
  const isFocusedRef = useRef(isFocused)
  const activityTimerRef = useRef(null)
  const hasHadActivityRef = useRef(false)

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

  const handleActivity = useCallback(() => {
    hasHadActivityRef.current = true
    clearTimeout(activityTimerRef.current)
    // 4s of silence after activity → assume Claude finished and is waiting
    activityTimerRef.current = setTimeout(() => {
      if (!isFocusedRef.current) {
        setDone(true)
        playDoneSound()
      }
    }, 4000)
  }, [])

  const { error, exitCode } = useTerminal(id, shell, cwd, containerRef, handleActivity)

  const handleFocus = () => {
    onFocus(id)
    if (done) {
      setDone(false)
      clearTimeout(activityTimerRef.current)
    }
  }

  return (
    <div
      className={[
        'pane',
        isFocused ? 'focused' : '',
        exitCode !== null ? 'exited' : '',
        done && !isFocused ? 'done' : ''
      ].filter(Boolean).join(' ')}
      onClick={handleFocus}
    >
      <div className="pane-header">
        <span className={`status-dot ${exitCode !== null ? 'status-exited' : 'status-running'}`} />
        <span className="pane-label">Agent {String(agentNum).padStart(2, '0')}</span>
        {done && !isFocused && <span className="done-badge">done</span>}
        <button
          className="close-btn"
          title="Close agent"
          onClick={e => { e.stopPropagation(); onClose(id) }}
        >
          ×
        </button>
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
