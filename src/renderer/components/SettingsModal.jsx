import { useEffect, useState } from 'react'
import Toggle from './Toggle.jsx'
import { getSettings, setSettings, subscribe } from '../settings-store.js'
import './SettingsModal.css'

const FONT_MIN = 10
const FONT_MAX = 22

const RELEASES_URL = (v) => `https://github.com/tayyabjdr/CodeSpace/releases/tag/v${v}`

const CloseGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

export default function SettingsModal({ open, onClose }) {
  const [s, setS] = useState(getSettings())
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)

  useEffect(() => subscribe(setS), [])

  useEffect(() => {
    if (!open) return
    setUpdateStatus(null)
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const update = (patch) => {
    setSettings(patch).catch((err) => console.warn('[settings] save failed:', err))
  }

  const onCheckUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    const res = await window.electronAPI?.checkForUpdates?.()
    setUpdateStatus(res ?? { status: 'error', message: 'No response' })
  }

  return (
    <div className="cs-settings-backdrop" onMouseDown={onClose}>
      <div
        className="cs-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cs-settings-header">
          <h2>Settings</h2>
          <button type="button" className="cs-settings-close" aria-label="Close" onClick={onClose}>
            <CloseGlyph />
          </button>
        </header>

        <div className="cs-settings-body">
          <section className="cs-settings-card">
            <h3>Appearance</h3>
            <Row label="Default pane font size">
              <input
                type="range"
                className="cs-settings-range"
                style={{ '--fill': `${((s.appearance.defaultPaneFontSize - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%` }}
                min={FONT_MIN}
                max={FONT_MAX}
                step={1}
                value={s.appearance.defaultPaneFontSize}
                onChange={(e) => update({ appearance: { defaultPaneFontSize: Number(e.target.value) } })}
              />
              <span className="cs-settings-value">{s.appearance.defaultPaneFontSize}px</span>
            </Row>
          </section>

          <section className="cs-settings-card">
            <h3>Notifications</h3>
            <Row label="Done sound volume">
              <input
                type="range"
                className="cs-settings-range"
                style={{ '--fill': `${s.notifications.doneSoundVolume}%` }}
                min={0}
                max={100}
                value={s.notifications.doneSoundVolume}
                onChange={(e) => update({ notifications: { doneSoundVolume: Number(e.target.value) } })}
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
          </section>

          <section className="cs-settings-card">
            <h3>Updates</h3>
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
          </section>

          <section className="cs-settings-card">
            <h3>Agents</h3>
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
          </section>
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
