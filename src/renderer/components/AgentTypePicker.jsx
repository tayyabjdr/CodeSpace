import { useEffect, useRef } from 'react'
import { AGENT_TYPES, AGENT_LABELS } from '../constants.js'
import './AgentTypePicker.css'

const DESCRIPTIONS = {
  claude: 'Anthropic Claude CLI',
  codex:  'OpenAI Codex CLI'
}

const MISSING_HINTS = {
  claude: 'claude not found on PATH — install Claude Code',
  codex:  'codex not found on PATH — install OpenAI Codex CLI'
}

// Floating popover anchored to an existing button (toolbar/pane "+", empty-
// workspace "New Agent", or Ctrl+T virtual anchor). Closes on selection,
// ESC, outside-click, and window blur.
//
// Props:
//   - availability: { claude: boolean, codex: boolean }
//   - anchorRect:   DOMRect-like { left, top, right, bottom } in viewport coords,
//                   or null to center near the top of the active workspace.
//   - onPick:       (shell) => void  — called with the chosen agent type
//   - onClose:      () => void
export default function AgentTypePicker({ availability, anchorRect, onPick, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onBlur = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  const style = (() => {
    if (!anchorRect) {
      return { left: '50%', top: 80, transform: 'translateX(-50%)' }
    }
    return { left: anchorRect.left, top: anchorRect.bottom + 6 }
  })()

  const allMissing = AGENT_TYPES.every(t => !availability?.[t])

  return (
    <div className="agent-picker" ref={ref} style={style} role="menu" aria-label="Choose agent type">
      {allMissing && (
        <div className="agent-picker-empty">
          Neither <code>claude</code> nor <code>codex</code> was found on PATH. Install one of them and restart CodeSpace.
        </div>
      )}
      {!allMissing && AGENT_TYPES.map(shell => {
        const available = !!availability?.[shell]
        return (
          <button
            key={shell}
            type="button"
            className={`agent-picker-row agent-picker-row-${shell}${available ? '' : ' is-disabled'}`}
            disabled={!available}
            title={available ? '' : MISSING_HINTS[shell]}
            onClick={() => available && onPick(shell)}
            role="menuitem"
          >
            <span className={`agent-picker-badge agent-picker-badge-${shell}`}>{shell}</span>
            <span className="agent-picker-label">{AGENT_LABELS[shell]}</span>
            <span className="agent-picker-desc">{DESCRIPTIONS[shell]}</span>
          </button>
        )
      })}
    </div>
  )
}
