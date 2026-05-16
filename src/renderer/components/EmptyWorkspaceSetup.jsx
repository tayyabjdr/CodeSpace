import { useState, useEffect } from 'react'
import AppIcon from './AppIcon.jsx'
import './Onboarding.css'

function colsFor(n) {
  if (n <= 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  if (n === 4) return 2
  if (n <= 6) return 3
  return 4
}

function TerminalPreview({ count }) {
  const cols = colsFor(count)
  const rows = Math.ceil(count / cols)
  return (
    <div
      className="ob-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="ob-preview-cell" />
      ))}
    </div>
  )
}

// Same full-area layout as Onboarding (embedded mode), but only shows the
// agent count grid + split control — no name/dir/isolation fields.
// Calls onAdd({ claude, codex }) instead of creating a new workspace.
export default function EmptyWorkspaceSetup({ availability, onAdd }) {
  const [selectedCount, setSelectedCount] = useState(2)
  const [codexShare, setCodexShare] = useState(0)

  useEffect(() => {
    if (availability.codex && !availability.claude) setCodexShare(selectedCount)
    else setCodexShare(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setCodexShare(prev => Math.max(0, Math.min(selectedCount, prev)))
  }, [selectedCount])

  const claudeShare = selectedCount - codexShare
  const bothAvailable = availability.claude && availability.codex

  const handleAdd = () => {
    const counts = bothAvailable
      ? { claude: claudeShare, codex: codexShare }
      : { claude: availability.claude ? selectedCount : 0, codex: availability.codex ? selectedCount : 0 }
    onAdd(counts)
  }

  return (
    <div className="onboarding ob-embedded">
      <div className="ob-shell">
        <header className="ob-brand">
          <span className="ob-mark" aria-hidden>
            <AppIcon size={48} />
          </span>
          <h1 className="ob-wordmark">CodeSpace</h1>
          <p className="ob-tagline">Multi-agent workspace</p>
        </header>

        <div className="ob-col" style={{ maxWidth: 340, width: '100%', alignSelf: 'center' }}>
          <div className="ob-field">
            <div className="ob-label-row">
              <span className="ob-label">Agents</span>
              <span className="ob-label-meta">{String(selectedCount).padStart(2, '0')}</span>
            </div>
            <div className="ob-cards">
              {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  type="button"
                  className={`ob-card${selectedCount === n ? ' active' : ''}`}
                  onClick={() => setSelectedCount(n)}
                  aria-label={`${n} agent${n !== 1 ? 's' : ''}`}
                >
                  <TerminalPreview count={n} />
                </button>
              ))}
            </div>

            {bothAvailable && (
              <div className="ob-split">
                <div className="ob-split-title">
                  <span>{claudeShare} Claude</span>
                  <span className="ob-split-dot">·</span>
                  <span>{codexShare} Codex</span>
                </div>
                <div className="ob-split-bar" role="group" aria-label="Split agents between Claude and Codex">
                  <button
                    type="button"
                    className="ob-split-seg ob-split-claude"
                    onClick={() => setCodexShare(s => Math.max(0, s - 1))}
                    disabled={claudeShare <= 0}
                    title="More Claude (fewer Codex)"
                  >
                    − Claude
                  </button>
                  <button
                    type="button"
                    className="ob-split-seg ob-split-codex"
                    onClick={() => setCodexShare(s => Math.min(selectedCount, s + 1))}
                    disabled={codexShare >= selectedCount}
                    title="More Codex (fewer Claude)"
                  >
                    + Codex
                  </button>
                </div>
              </div>
            )}

            {!bothAvailable && (
              <p className="ob-split-hint">
                Only <code>{availability.claude ? 'claude' : 'codex'}</code> detected — all agents will be {availability.claude ? 'Claude' : 'Codex'}.
              </p>
            )}
          </div>
        </div>

        <div className="ob-footer">
          <button type="button" className="ob-launch" onClick={handleAdd}>
            Add {selectedCount} agent{selectedCount !== 1 ? 's' : ''}
          </button>
          <p className="ob-hint">
            Ctrl+T <span className="ob-dot">·</span> new
            <span className="ob-sep" />
            Ctrl+W <span className="ob-dot">·</span> close
          </p>
        </div>
      </div>
    </div>
  )
}
