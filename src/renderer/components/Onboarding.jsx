import { useState, useEffect, useRef } from 'react'
import { ONBOARDING_BOOT_DELAY_MS } from '../constants.js'
import AppIcon from './AppIcon.jsx'
import './Onboarding.css'

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

// Mirrors App.jsx grid logic.
// 1→1 · 2→2 · 3→3 · 4→2 · 5–6→3 · 7+→4 (max)
function colsFor(n) {
  if (n <= 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  if (n === 4) return 2
  if (n <= 6) return 3
  return 4
}

function gridShape(n) {
  const cols = colsFor(n)
  const rows = Math.ceil(n / cols)
  return { cols, rows }
}

function TerminalPreview({ count }) {
  const { cols, rows } = gridShape(count)
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
  // Tracks whether the user has typed in the name field directly. Folder-name
  // auto-fill should populate the input (so it's editable) but NOT bubble up
  // to onNameChange — the sidebar should stay on its default ("New Workspace")
  // until the user actually types or hits Initialize.
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
    const folder = projectDir.split(/[\\/]/).filter(Boolean).pop() || ''
    setName(folder)
  }, [projectDir])

  // Bubble up name changes so an embedded host (e.g. sidebar workspace label)
  // can stay in sync — both with the user's typing and with the folder-driven
  // auto-fill, so the sidebar item renames as the user browses folders.
  useEffect(() => {
    onNameChange?.(name)
  }, [name, onNameChange])

  const handleBrowse = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setProjectDir(dir)
  }

  const canLaunch = name.trim().length > 0 && projectDir.length > 0 && !launching

  const handleLaunch = () => {
    if (!canLaunch) return
    setLaunching(true)
    // Allow the boot animation a beat before swapping to the workspace
    setTimeout(() => onLaunch(selectedCount, projectDir, name.trim()), ONBOARDING_BOOT_DELAY_MS)
  }

  const handleClose = () => {
    if (embedded) onDiscard?.()
    else window.electronAPI.windowClose()
  }

  const dirLabel = projectDir
    ? projectDir.split(/[\\/]/).filter(Boolean).pop() || projectDir
    : '—'

  return (
    <div className={`onboarding${embedded ? ' ob-embedded' : ''}${launching ? ' ob-exit' : ''}`}>
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
            <AppIcon size={48} />
          </span>
          <h1 className="ob-wordmark">CodeSpace</h1>
          <p className="ob-tagline">Multi-agent workspace</p>
        </header>

        <div className="ob-grid">
          {/* LEFT — identity */}
          <section className="ob-col">
            <div className="ob-field">
              <label className="ob-label">Workspace name</label>
              <input
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

            <div className="ob-field">
              <label className="ob-label">Project directory</label>
              <div className="ob-dir-display" title={projectDir}>
                <span className="ob-dir-folder"><FolderIcon /></span>
                <div className="ob-dir-text">
                  <span className="ob-dir-name">{dirLabel}</span>
                  <span className="ob-dir-path">{projectDir}</span>
                </div>
                <button
                  type="button"
                  className="ob-browse-btn"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              </div>
            </div>
          </section>

          {/* RIGHT — agent grid selector */}
          <section className="ob-col">
            <div className="ob-field">
              <div className="ob-label-row">
                <label className="ob-label">Agents</label>
                <span className="ob-label-meta">
                  {selectedCount.toString().padStart(2, '0')}
                </span>
              </div>
              <div className="ob-cards">
                {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`ob-card${selectedCount === n ? ' active' : ''}`}
                    onClick={() => setSelectedCount(n)}
                    aria-label={`${n} agents`}
                  >
                    <TerminalPreview count={n} />
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="ob-footer">
          <button
            className="ob-launch"
            onClick={handleLaunch}
            disabled={!canLaunch}
          >
            {launching ? (
              <span className="ob-launch-loading">
                <span className="ob-launch-text">Initializing</span>
                <span className="ob-launch-dots">
                  <span /><span /><span />
                </span>
              </span>
            ) : 'Initialize'}
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
