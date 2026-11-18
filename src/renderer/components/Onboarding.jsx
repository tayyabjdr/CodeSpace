import { useState, useEffect, useRef } from 'react'
import { ONBOARDING_BOOT_DELAY_MS } from '../constants.js'
import AppIcon from './AppIcon.jsx'
import AgentLogo from './AgentLogo.jsx'
import { ISOLATION_NOTES } from '../isolation-notice.js'
import RecentDirectories from './RecentDirectories.jsx'
import { gridShape, cellStyle } from '../grid-layout.js'
import { basename, parentLabel } from '../path-display.js'
import './Onboarding.css'

const MAX_AGENTS = 8

const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

const CloseIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const MinusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </svg>
)

// `claude` = how many panes run Claude. App spawns the Claude panes first, so
// every cell after that is a Codex pane and gets the violet tint.
function TerminalPreview({ count, claude = count }) {
  const shape = gridShape(count)
  const { cols, rows } = shape
  return (
    <div
      className="ob-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`ob-preview-cell${i >= claude ? ' codex' : ''}`}
          style={cellStyle(shape, i, count)}
        />
      ))}
    </div>
  )
}

// One row per agent CLI: logo, name and a − n + stepper. The two counts add up
// to the layout, so + on either one grows the grid by a pane.
function AgentStepper({ shell, label, value, canDec, canInc, onDec, onInc }) {
  return (
    <div className={`ob-stepper ob-stepper-${shell}${value > 0 ? ' on' : ''}`}>
      <span className="ob-stepper-logo"><AgentLogo shell={shell} size={14} /></span>
      <span className="ob-stepper-name">{label}</span>
      <div className="ob-stepper-ctl">
        <button type="button" onClick={onDec} disabled={!canDec} aria-label={`One fewer ${label}`}>
          <MinusIcon />
        </button>
        <span className="ob-stepper-value" data-testid={`count-${shell}`}>{value}</span>
        <button type="button" onClick={onInc} disabled={!canInc} aria-label={`One more ${label}`}>
          <PlusIcon />
        </button>
      </div>
    </div>
  )
}

export default function Onboarding({
  onLaunch,
  mode = 'standalone',
  onDiscard,
  onNameChange,
  initialName = '',
  initialDir = ''
}) {
  const embedded = mode === 'embedded'
  const [name, setName] = useState(initialName)
  const [selectedCount, setSelectedCount] = useState(2)
  const [projectDir, setProjectDir] = useState(initialDir)
  const [launching, setLaunching] = useState(false)
  // null while the eligibility check is in flight, so no note flashes.
  const [canIso, setCanIso] = useState(null)
  // The user's explicit toggle choice (null = never touched). Survives folder changes.
  const [override, setOverride] = useState(null)
  const [availability, setAvailability] = useState({ claude: true, codex: true })
  const [codexShare, setCodexShare] = useState(0)
  const [recents, setRecents] = useState([])

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.agents?.getAvailability?.().then(av => {
      if (!cancelled && av) setAvailability(av)
    })
    return () => { cancelled = true }
  }, [])

  // Load the recent-directories list once when the onboarding form mounts.
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.recents?.get?.().then(list => {
      if (!cancelled) setRecents(Array.isArray(list) ? list : [])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setCodexShare(prev => Math.max(0, Math.min(selectedCount, prev)))
  }, [selectedCount])

  // With only one CLI installed every pane is that CLI, whatever the layout.
  const bothAvailable = availability.claude && availability.codex
  const codexCount = bothAvailable
    ? Math.min(codexShare, selectedCount)
    : (availability.codex && !availability.claude ? selectedCount : 0)
  const claudeShare = selectedCount - codexCount

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
    } else if (claudeShare <= 0) {
      return
    }
    setSelectedCount(selectedCount - 1)
  }

  useEffect(() => {
    setCanIso(null)
    if (!projectDir) return
    let cancelled = false
    window.electronAPI.worktree.canIsolate(projectDir)
      .then(v => { if (!cancelled) setCanIso(v || { ok: false, reason: null }) })
      .catch(() => { if (!cancelled) setCanIso({ ok: false, reason: null }) })
    return () => { cancelled = true }
  }, [projectDir])

  const isolated = !!canIso?.ok && (override ?? true)
  const isolationNote = canIso && !canIso.ok ? ISOLATION_NOTES[canIso.reason] : null

  // Tracks whether the user has typed in the name field directly. Folder-name
  // auto-fill should populate the input (so it's editable) but NOT bubble up
  // to onNameChange — the sidebar should stay on its default ("New Workspace")
  // until the user actually types or hits Launch.
  const userEditedNameRef = useRef(false)

  useEffect(() => {
    if (projectDir) return
    window.electronAPI.getDesktopPath().then(p => setProjectDir(p || ''))
  }, [projectDir])

  // Auto-fill workspace name from the selected folder's basename. Tracks
  // every directory change until the user types in the name field, so
  // browsing Desktop → Socials updates the name from "Desktop" to "Socials".
  useEffect(() => {
    if (!projectDir) return
    if (userEditedNameRef.current) return
    setName(basename(projectDir))
  }, [projectDir])

  // Bubble up name changes so an embedded host (e.g. sidebar workspace label)
  // can stay in sync — both with the user's typing and with the folder-driven
  // auto-fill, so the sidebar item renames as the user browses folders.
  useEffect(() => {
    onNameChange?.(name)
  }, [name, onNameChange])

  const handleBrowse = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setProjectDir(dir)
    const list = await window.electronAPI.recents.add(dir)
    setRecents(Array.isArray(list) ? list : [])
  }

  const handlePickRecent = (dir) => {
    setProjectDir(dir)
  }

  const handleRemoveRecent = async (dir) => {
    const list = await window.electronAPI.recents.remove(dir)
    setRecents(Array.isArray(list) ? list : [])
  }

  const canLaunch =
    name.trim().length > 0 &&
    projectDir.length > 0 &&
    !launching

  // `dir` lets a double-clicked recent launch before its pick has re-rendered.
  // The name follows that folder too unless the user typed their own.
  const launchingRef = useRef(false)
  const handleLaunch = (dir = projectDir, iso = isolated) => {
    if (launchingRef.current || !dir) return
    const finalName = (userEditedNameRef.current ? name : basename(dir)).trim()
    if (!finalName) return
    launchingRef.current = true
    setLaunching(true)
    window.electronAPI?.recents?.add?.(dir)
    const counts = { claude: claudeShare, codex: codexCount }
    setTimeout(() => onLaunch(counts, dir, finalName, iso), ONBOARDING_BOOT_DELAY_MS)
  }

  // A double-click can land before the folder's git check has come back, so
  // ask again here rather than launch with the previous folder's answer.
  const handleLaunchRecent = async (dir) => {
    if (launchingRef.current) return
    setProjectDir(dir)
    let ok = false
    try { ok = !!(await window.electronAPI.worktree.canIsolate(dir))?.ok } catch { ok = false }
    handleLaunch(dir, ok && (override ?? true))
  }

  const handleClose = () => {
    if (embedded) onDiscard?.()
    else window.electronAPI.windowClose()
  }

  // Enter anywhere on the form launches. Buttons and the recent rows handle
  // their own Enter, so only plain targets (the name field, the page) count.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent?.isComposing) return
    if (e.target.closest?.('button, [role="button"]')) return
    e.preventDefault()
    if (canLaunch) handleLaunch()
  }

  const dirLabel = projectDir ? basename(projectDir) : 'No folder chosen'
  const dirParent = projectDir ? parentLabel(projectDir, 34) : ''
  const launchLabel = `Launch ${selectedCount} ${selectedCount === 1 ? 'agent' : 'agents'}`

  return (
    <div
      className={`onboarding${embedded ? ' ob-embedded' : ''}${launching ? ' ob-exit' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="ob-close"
        title={embedded ? 'Discard draft' : 'Close'}
        aria-label={embedded ? 'Discard draft' : 'Close'}
        onClick={handleClose}
        disabled={launching}
      >
        <CloseIcon />
      </button>
      <div className={`ob-shell${launching ? ' ob-launching' : ''}`}>
        <header className="ob-brand">
          <span className="ob-mark" aria-hidden>
            <AppIcon size={44} />
          </span>
          <h1 className="ob-wordmark">CodeSpace</h1>
          <p className="ob-tagline">Pick a folder, choose your agents, launch.</p>
        </header>

        <div className="ob-grid">
          {/* LEFT — where */}
          <section className="ob-col">
            <div className="ob-field">
              <label className="ob-label" htmlFor="ob-dir">Project folder</label>
              <div className="ob-dir-display" title={projectDir}>
                <span className="ob-dir-folder"><FolderIcon /></span>
                <div className="ob-dir-text">
                  <span className="ob-dir-name">{dirLabel}</span>
                  {dirParent && <span className="ob-dir-path">{dirParent}</span>}
                </div>
                <button
                  id="ob-dir"
                  type="button"
                  className="ob-browse-btn"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              </div>
            </div>

            <RecentDirectories
              recents={recents}
              currentDir={projectDir}
              onPick={handlePickRecent}
              onRemove={handleRemoveRecent}
              onLaunch={handleLaunchRecent}
            />

            <div className="ob-field ob-name-field">
              <label className="ob-label" htmlFor="ob-name">Workspace name</label>
              <input
                id="ob-name"
                className="ob-input"
                value={name}
                onChange={e => {
                  userEditedNameRef.current = true
                  setName(e.target.value)
                }}
                placeholder="e.g. CodeSpace"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </section>

          {/* RIGHT — who */}
          <section className="ob-col">
            <div className="ob-field">
              <div className="ob-label-row">
                <label className="ob-label">Layout</label>
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
                      <TerminalPreview count={n} claude={active ? claudeShare : n} />
                      <span className="ob-card-num" aria-hidden>{n}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="ob-field">
              <label className="ob-label">Agents</label>
              {bothAvailable ? (
                <div className="ob-steppers">
                  <AgentStepper
                    shell="claude"
                    label="Claude"
                    value={claudeShare}
                    canDec={claudeShare > 0 && selectedCount > 1}
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

            <div className={`ob-field ob-isolation${isolationNote ? ' unavailable' : ''}`}>
              <label className="ob-toggle">
                <input
                  type="checkbox"
                  checked={isolated}
                  disabled={!canIso?.ok}
                  onChange={e => setOverride(e.target.checked)}
                />
                <span className="ob-toggle-track" aria-hidden />
                <span className="ob-toggle-text">
                  <span className="ob-toggle-title">Isolated agents</span>
                  {isolationNote ? (
                    <span className="ob-toggle-help ob-isolation-note">{isolationNote}</span>
                  ) : (
                    <span className="ob-toggle-help">
                      Each agent gets its own git branch and folder, so their changes can't collide.
                    </span>
                  )}
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className="ob-footer">
          <button
            type="button"
            className="ob-launch"
            onClick={() => handleLaunch()}
            disabled={!canLaunch}
          >
            {launching ? (
              <span className="ob-launch-loading">
                <span className="ob-launch-text">Launching</span>
                <span className="ob-launch-dots">
                  <span /><span /><span />
                </span>
              </span>
            ) : (
              <>
                <span>{launchLabel}</span>
                <ArrowIcon />
              </>
            )}
          </button>
          <p className="ob-hint">
            <kbd>Enter</kbd> launch
            <span className="ob-sep" />
            double-click a recent folder to open it straight away
          </p>
        </div>
      </div>
    </div>
  )
}
