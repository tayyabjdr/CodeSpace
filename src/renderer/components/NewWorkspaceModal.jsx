import { useState, useEffect, useRef } from 'react'
import './NewWorkspaceModal.css'

export default function NewWorkspaceModal({ onCancel, onCreate, defaultDir = '' }) {
  const [name, setName] = useState('')
  const [dir, setDir] = useState(defaultDir)
  const [count, setCount] = useState(2)
  const nameRef = useRef(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleBrowse = async () => {
    const picked = await window.electronAPI.selectDirectory()
    if (picked) setDir(picked)
  }

  const folderName = dir ? (dir.split(/[\\/]/).filter(Boolean).pop() || dir) : '—'

  const canSubmit = name.trim().length > 0 && dir.length > 0

  const handleSubmit = (e) => {
    e?.preventDefault?.()
    if (!canSubmit) return
    onCreate({ name: name.trim(), dir, agentCount: count })
  }

  return (
    <div className="nwm-backdrop" onClick={onCancel}>
      <form
        className="nwm-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="nwm-head">
          <span className="nwm-mark">✦</span>
          <h2 className="nwm-title">New workspace</h2>
        </header>

        <div className="nwm-section">
          <label className="nwm-label">Name</label>
          <input
            ref={nameRef}
            className="nwm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CodeSpace"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="nwm-section">
          <label className="nwm-label">Project directory</label>
          <div className="nwm-dir-row">
            <div className="nwm-dir-display" title={dir}>
              <span className="nwm-dir-folder">⌂</span>
              <span className="nwm-dir-name">{folderName}</span>
              <span className="nwm-dir-path">{dir}</span>
            </div>
            <button type="button" className="nwm-browse" onClick={handleBrowse}>Browse</button>
          </div>
        </div>

        <div className="nwm-section">
          <label className="nwm-label">Agent count</label>
          <div className="nwm-count-grid">
            {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
              <div
                key={n}
                className={`nwm-count-card${count === n ? ' active' : ''}`}
                onClick={() => setCount(n)}
              >
                <span className="nwm-count-num">{n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="nwm-actions">
          <button type="button" className="nwm-cancel" onClick={onCancel}>Cancel</button>
          <button
            type="submit"
            className="nwm-submit"
            disabled={!canSubmit}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
