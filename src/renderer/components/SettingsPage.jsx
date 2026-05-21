import { useEffect, useState } from 'react'
import Toggle from './Toggle.jsx'
import { getSettings, setSettings, subscribe } from '../settings-store.js'
import './SettingsPage.css'

const FONT_MIN = 10
const FONT_MAX = 22

const RELEASES_URL = (v) => `https://github.com/tayyabjdr/CodeSpace/releases/tag/v${v}`

const AppearanceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)
const NotificationsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
)
const AgentsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </svg>
)
const UpdatesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </svg>
)
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

const CATEGORIES = [
  { id: 'appearance',    label: 'Appearance',    Icon: AppearanceIcon,    description: 'How terminal panes look.' },
  { id: 'notifications', label: 'Notifications', Icon: NotificationsIcon, description: 'Alerts when an agent finishes.' },
  { id: 'agents',        label: 'Agents',        Icon: AgentsIcon,        description: 'How agent CLIs are launched.' },
  { id: 'updates',       label: 'Updates',       Icon: UpdatesIcon,       description: 'Keep CodeSpace up to date.' },
]

export default function SettingsPage({ onClose }) {
  const [s, setS] = useState(getSettings())
  const [active, setActive] = useState('appearance')
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)

  useEffect(() => subscribe(setS), [])

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Clear any stale update-check result when switching categories, so arriving
  // at the Updates page always starts fresh.
  useEffect(() => { setUpdateStatus(null) }, [active])

  const update = (patch) => {
    setSettings(patch).catch((err) => console.warn('[settings] save failed:', err))
  }

  const onCheckUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    const res = await window.electronAPI?.checkForUpdates?.()
    setUpdateStatus(res ?? { status: 'error', message: 'No response' })
  }

  const activeCategory = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]

  return (
    <div className="cs-settings-page" role="dialog" aria-modal="true" aria-label="Settings">
      <nav className="cs-settings-nav">
        <div className="cs-settings-nav-head">Settings</div>
        {CATEGORIES.map((cat) => {
          const { Icon } = cat
          return (
            <button
              key={cat.id}
              type="button"
              className={`cs-settings-nav-item${active === cat.id ? ' active' : ''}`}
              aria-current={active === cat.id ? 'page' : undefined}
              onClick={() => setActive(cat.id)}
            >
              <Icon />
              <span>{cat.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="cs-settings-content">
        <button
          type="button"
          className="cs-settings-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="cs-settings-col">
          {/* key={active} remounts the panel so the slide-in animation replays on each category switch */}
          <div className="cs-settings-panel" key={active}>
            <h1 className="cs-settings-title">{activeCategory.label}</h1>
            <p className="cs-settings-desc">{activeCategory.description}</p>
            <div className="cs-settings-card">
              {active === 'appearance' && (
                <Row label="Default pane font size" caption="Applied to new terminal panes">
                  <input
                    type="range"
                    className="cs-settings-range"
                    style={{ '--fill': `${((s.appearance.defaultPaneFontSize - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%` }}
                    min={FONT_MIN}
                    max={FONT_MAX}
                    step={1}
                    value={s.appearance.defaultPaneFontSize}
                    onChange={(e) => update({ appearance: { defaultPaneFontSize: Number(e.target.value) } })}
                    aria-label="Default pane font size"
                  />
                  <span className="cs-settings-value">{s.appearance.defaultPaneFontSize}px</span>
                </Row>
              )}

              {active === 'notifications' && (
                <>
                  <Row label="Done sound volume">
                    <input
                      type="range"
                      className="cs-settings-range"
                      style={{ '--fill': `${s.notifications.doneSoundVolume}%` }}
                      min={0}
                      max={100}
                      value={s.notifications.doneSoundVolume}
                      onChange={(e) => update({ notifications: { doneSoundVolume: Number(e.target.value) } })}
                      aria-label="Done sound volume"
                    />
                    <span className="cs-settings-value">{s.notifications.doneSoundVolume}%</span>
                  </Row>
                  <Row label="Flash taskbar on done">
                    <Toggle
                      checked={s.notifications.taskbarFlashOnDone}
                      onChange={(v) => update({ notifications: { taskbarFlashOnDone: v } })}
                      ariaLabel="Flash taskbar on done"
                    />
                  </Row>
                </>
              )}

              {active === 'agents' && (
                <>
                  <Row
                    label="Skip permission prompts"
                    caption={<>Runs <code>claude</code> with <code>--dangerously-skip-permissions</code></>}
                  >
                    <Toggle
                      checked={s.agents.dangerouslySkipPermissions}
                      onChange={(v) => update({ agents: { dangerouslySkipPermissions: v } })}
                      ariaLabel="Skip permission prompts"
                    />
                  </Row>
                  <Row
                    label="Codex — bypass approvals and sandbox"
                    caption={<>Runs <code>codex</code> with <code>--dangerously-bypass-approvals-and-sandbox</code></>}
                  >
                    <Toggle
                      checked={s.agents.codexDangerouslyBypassApprovals}
                      onChange={(v) => update({ agents: { codexDangerouslyBypassApprovals: v } })}
                      ariaLabel="Codex bypass approvals and sandbox"
                    />
                  </Row>
                </>
              )}

              {active === 'updates' && (
                <>
                  <Row label="Version">
                    <div className="cs-settings-control">
                      {version ? (
                        <a
                          href="#"
                          className="cs-settings-version-link"
                          onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.(RELEASES_URL(version)) }}
                        >v{version}</a>
                      ) : <span className="cs-settings-value">—</span>}
                      <button type="button" className="cs-settings-btn" onClick={onCheckUpdates}>
                        Check
                      </button>
                    </div>
                  </Row>
                  <Row label="Auto-update">
                    <Toggle
                      checked={s.updates.autoUpdate}
                      onChange={(v) => update({ updates: { autoUpdate: v } })}
                      ariaLabel="Auto-update"
                    />
                  </Row>
                  {updateStatus && (
                    <div className="cs-settings-status">
                      {updateStatus.status === 'checking' && <span>Checking…</span>}
                      {updateStatus.status === 'downloading' && <span>Downloading v{updateStatus.version}…</span>}
                      {updateStatus.status === 'up-to-date' && <span>Up to date</span>}
                      {updateStatus.status === 'error' && <span className="cs-settings-value error">Couldn't check for updates</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, caption, children }) {
  return (
    <div className="cs-settings-row">
      <div className="cs-settings-label">
        <span>{label}</span>
        {caption && <span className="cs-settings-caption">{caption}</span>}
      </div>
      <div className="cs-settings-control">{children}</div>
    </div>
  )
}
