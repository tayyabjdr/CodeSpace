import { useState, useEffect } from 'react'
import './Onboarding.css'

export default function Onboarding({ onLaunch }) {
  const [selectedCount, setSelectedCount] = useState(2)
  const [projectDir, setProjectDir] = useState('')
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    window.electronAPI.getDesktopPath().then(p => setProjectDir(p || ''))
  }, [])

  const handleBrowse = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setProjectDir(dir)
  }

  const handleLaunch = () => {
    setLaunching(true)
    setTimeout(() => onLaunch(selectedCount, projectDir), 350)
  }

  const dirLabel = projectDir
    ? projectDir.split(/[\\/]/).pop() || projectDir
    : '—'

  return (
    <div className={`onboarding${launching ? ' ob-exit' : ''}`}>
      <div className="ob-content">
        <header className="ob-brand">
          <span className="ob-mark">✦</span>
          <h1 className="ob-wordmark">CodeSpace</h1>
          <p className="ob-tagline">Multi-agent workspace</p>
        </header>

        <section className="ob-selector">
          <p className="ob-selector-label">Agent count</p>
          <div className="ob-cards">
            {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
              <div
                key={n}
                className={`ob-card${selectedCount === n ? ' active' : ''}`}
                onClick={() => setSelectedCount(n)}
              >
                <span className="ob-card-num">{n}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ob-dir-section">
          <p className="ob-selector-label">Project directory</p>
          <div className="ob-dir-row">
            <div className="ob-dir-display" title={projectDir}>
              <span className="ob-dir-folder">⌂</span>
              <span className="ob-dir-name">{dirLabel}</span>
              <span className="ob-dir-path">{projectDir}</span>
            </div>
            <button className="ob-browse-btn" onClick={handleBrowse}>Browse</button>
          </div>
        </section>

        <button
          className="ob-launch"
          onClick={handleLaunch}
          disabled={launching || !projectDir}
        >
          {launching ? 'Starting…' : 'Initialize'}
        </button>

        <p className="ob-hint">
          Ctrl+T &nbsp;new &nbsp;·&nbsp; Ctrl+W &nbsp;close
        </p>
      </div>
    </div>
  )
}
