import { useEffect, useRef, useState } from 'react'
import { AGENT_TYPES, AGENT_LABELS } from '../constants.js'
import './AgentTypePicker.css'

const MISSING_HINTS = {
  claude: 'claude not found on PATH — install Claude Code',
  codex:  'codex not found on PATH — install OpenAI Codex CLI'
}

// Floating popover anchored to a button. Right-aligns to the anchor so it
// never bleeds into adjacent panes. Closes on confirm, ESC, outside-click,
// or window blur.
//
// Props:
//   - availability: { claude: boolean, codex: boolean }
//   - anchorRect:   DOMRect or null (centers near top if null)
//   - onPick:       ({ claude: number, codex: number }) => void
//   - onClose:      () => void
export default function AgentTypePicker({ availability, anchorRect, onPick, onClose }) {
  const ref = useRef(null)
  const [counts, setCounts] = useState({ claude: 0, codex: 0 })

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

  // Right-align to anchor so the picker opens leftward and stays within the pane.
  const style = anchorRect
    ? { right: window.innerWidth - anchorRect.right, top: anchorRect.bottom + 6 }
    : { left: '50%', top: 80, transform: 'translateX(-50%)' }

  const total = counts.claude + counts.codex
  const allMissing = AGENT_TYPES.every(t => !availability?.[t])

  const adjust = (shell, delta) => {
    setCounts(c => ({ ...c, [shell]: Math.max(0, c[shell] + delta) }))
  }

  const handleConfirm = () => {
    if (total === 0) return
    onPick(counts)
    onClose()
  }

  return (
    <div className="agent-picker" ref={ref} style={style} role="dialog" aria-label="Add agents">
      {allMissing ? (
        <div className="agent-picker-empty">
          Neither <code>claude</code> nor <code>codex</code> found on PATH.
        </div>
      ) : (
        <>
          {AGENT_TYPES.map(shell => {
            const available = !!availability?.[shell]
            const count = counts[shell]
            return (
              <div
                key={shell}
                className={`agent-picker-row${available ? '' : ' is-disabled'}`}
                title={available ? '' : MISSING_HINTS[shell]}
              >
                <span className={`agent-picker-name ap-name-${shell}`}>{AGENT_LABELS[shell]}</span>
                <div className="agent-picker-stepper">
                  <button
                    type="button"
                    className="ap-step"
                    onClick={() => adjust(shell, -1)}
                    disabled={!available || count === 0}
                    aria-label={`Fewer ${AGENT_LABELS[shell]}`}
                  >−</button>
                  <span className="ap-count">{count}</span>
                  <button
                    type="button"
                    className="ap-step"
                    onClick={() => adjust(shell, 1)}
                    disabled={!available}
                    aria-label={`More ${AGENT_LABELS[shell]}`}
                  >+</button>
                </div>
              </div>
            )
          })}
          <button
            type="button"
            className={`agent-picker-confirm${total === 0 ? ' is-zero' : ''}`}
            onClick={handleConfirm}
            disabled={total === 0}
          >
            Add {total > 0 ? total : ''} agent{total !== 1 ? 's' : ''}
          </button>
        </>
      )}
    </div>
  )
}
