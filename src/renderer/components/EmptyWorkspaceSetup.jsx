import { useState } from 'react'
import AppIcon from './AppIcon.jsx'
import { AgentStepper, ArrowIcon, MAX_AGENTS, TerminalPreview } from './Onboarding.jsx'
import './Onboarding.css'

// Same full-area layout as Onboarding (embedded mode), but only the layout
// tiles and the Claude/Codex steppers: no name, folder or isolation fields.
// Built from Onboarding's own pieces so the two screens can't drift apart.
// Calls onAdd({ claude, codex }) instead of creating a new workspace.
export default function EmptyWorkspaceSetup({ availability, onAdd }) {
  const [selectedCount, setSelectedCount] = useState(2)
  const [codexShare, setCodexShare] = useState(0)

  // With only one CLI installed every pane is that CLI, whatever the layout.
  const bothAvailable = availability.claude && availability.codex
  const codexCount = bothAvailable
    ? Math.min(codexShare, selectedCount)
    : (availability.codex && !availability.claude ? selectedCount : 0)
  const claudeCount = selectedCount - codexCount

  const addAgent = (shell) => {
    if (selectedCount >= MAX_AGENTS) return
    if (shell === 'codex') setCodexShare(codexCount + 1)
    setSelectedCount(selectedCount + 1)
  }
  const removeAgent = (shell) => {
    if (selectedCount <= 1) return
    if (shell === 'codex') {
      if (codexCount <= 0) return
      setCodexShare(codexCount - 1)
    } else if (claudeCount <= 0) {
      return
    }
    setSelectedCount(selectedCount - 1)
  }

  const handleAdd = () => onAdd({ claude: claudeCount, codex: codexCount })

  const addLabel = `Add ${selectedCount} ${selectedCount === 1 ? 'agent' : 'agents'}`

  return (
    <div className="onboarding ob-embedded">
      <div className="ob-shell">
        <header className="ob-brand">
          <span className="ob-mark" aria-hidden>
            <AppIcon size={44} />
          </span>
          <h1 className="ob-wordmark">CodeSpace</h1>
          <p className="ob-tagline">This workspace has no agents. Choose some to start.</p>
        </header>

        <div className="ob-col" style={{ maxWidth: 360, width: '100%', alignSelf: 'center' }}>
          <div className="ob-field">
            <div className="ob-label-row">
              <span className="ob-label">Layout</span>
              <span className="ob-label-meta">
                {selectedCount} {selectedCount === 1 ? 'pane' : 'panes'}
              </span>
            </div>
            <div className="ob-cards" role="radiogroup" aria-label="Number of agents">
              {Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).map(n => {
                const active = selectedCount === n
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`ob-card${active ? ' active' : ''}`}
                    onClick={() => setSelectedCount(n)}
                    aria-label={`${n} ${n === 1 ? 'agent' : 'agents'}`}
                  >
                    <TerminalPreview count={n} claude={active ? claudeCount : n} />
                    <span className="ob-card-num" aria-hidden>{n}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="ob-field">
            <span className="ob-label">Agents</span>
            {bothAvailable ? (
              <div className="ob-steppers">
                <AgentStepper
                  shell="claude"
                  label="Claude"
                  value={claudeCount}
                  canDec={claudeCount > 0 && selectedCount > 1}
                  canInc={selectedCount < MAX_AGENTS}
                  onDec={() => removeAgent('claude')}
                  onInc={() => addAgent('claude')}
                />
                <AgentStepper
                  shell="codex"
                  label="Codex"
                  value={codexCount}
                  canDec={codexCount > 0 && selectedCount > 1}
                  canInc={selectedCount < MAX_AGENTS}
                  onDec={() => removeAgent('codex')}
                  onInc={() => addAgent('codex')}
                />
              </div>
            ) : (
              <p className="ob-split-hint">
                Only <code>{availability.claude ? 'claude' : 'codex'}</code> was found on this machine, so every pane runs {availability.claude ? 'Claude' : 'Codex'}.
              </p>
            )}
          </div>
        </div>

        <div className="ob-footer">
          <button type="button" className="ob-launch" onClick={handleAdd}>
            <span>{addLabel}</span>
            <ArrowIcon />
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
