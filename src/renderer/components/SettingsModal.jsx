import { useEffect, useState } from 'react'
import Toggle from './Toggle.jsx'
import { getSettings, setSettings, subscribe } from '../settings-store.js'
import './SettingsModal.css'

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22]

const RELEASES_URL = (v) => `https://github.com/tayyabjdr/CodeSpace/releases/tag/v${v}`

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
          <button type="button" className="cs-settings-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <section>
          <h3>Appearance</h3>
          <Row label="Default pane font size">
            <select
              value={s.appearance.defaultPaneFontSize}
              onChange={(e) => update({ appearance: { defaultPaneFontSize: Number(e.target.value) } })}
            >
              {FONT_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Row>
        </section>

        <section>
          <h3>Notifications</h3>
          <Row label="Done sound volume">
            <input
              type="range"
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

        <section>
          <h3>Updates</h3>
          <Row label="Version">
            {version ? (
              <a
                href="#"
                className="cs-settings-link"
                onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.(RELEASES_URL(version)) }}
              >v{version}</a>
            ) : <span className="cs-settings-value">—</span>}
          </Row>
          <Row label="Auto-update">
            <Toggle
              checked={s.updates.autoUpdate}
              onChange={(v) => update({ updates: { autoUpdate: v } })}
              ariaLabel="Auto-update"
            />
          </Row>
          <div className="cs-settings-row cs-settings-actions">
            {updateStatus?.status === 'downloading' && <span className="cs-settings-value">Downloading v{updateStatus.version}…</span>}
            {updateStatus?.status === 'up-to-date' && <span className="cs-settings-value">Up to date</span>}
            {updateStatus?.status === 'error' && <span className="cs-settings-value error">Couldn't check for updates</span>}
            {updateStatus?.status === 'checking' && <span className="cs-settings-value">Checking…</span>}
            <button type="button" className="cs-settings-btn" onClick={onCheckUpdates}>Check for updates</button>
          </div>
        </section>

        <section>
          <h3>Agents</h3>
          <Row
            label="Skip permission prompts"
            caption="Runs claude with --dangerously-skip-permissions"
          >
            <Toggle
              checked={s.agents.dangerouslySkipPermissions}
              onChange={(v) => update({ agents: { dangerouslySkipPermissions: v } })}
              ariaLabel="Skip permission prompts"
            />
          </Row>
        </section>
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
