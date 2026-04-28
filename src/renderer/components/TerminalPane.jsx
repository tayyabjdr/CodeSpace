import { useRef } from 'react'
import useTerminal from '../hooks/useTerminal.js'
import './TerminalPane.css'

export default function TerminalPane({ id, shell, onClose, onFocus }) {
  const containerRef = useRef(null)
  const { error, exitCode } = useTerminal(id, shell, containerRef)

  return (
    <div className="pane" onClick={() => onFocus(id)}>
      <div className={`pane-header${exitCode !== null ? ' exited' : ''}`}>
        <span className="pane-shell">{shell}</span>
        {exitCode !== null && (
          <span className="exit-label">exited: {exitCode}</span>
        )}
        <button
          className="close-btn"
          title="Close terminal"
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
