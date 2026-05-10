import { useEffect, useState } from 'react'
import VolumeControl from './VolumeControl.jsx'
import AppIcon from './AppIcon.jsx'
import './Toolbar.css'

const MinusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const MaximizeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </svg>
)

const RestoreIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="8" width="13" height="13" rx="2" />
    <path d="M8 8V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
  </svg>
)

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4.5 4 1.5 7 4.5 10" />
    <polyline points="9.5 4 12.5 7 9.5 10" />
    <line x1="8.2" y1="3" x2="5.8" y2="11" />
  </svg>
)

export default function Toolbar({ onAdd, agentCount, editorOpen, onToggleEditor }) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => window.electronAPI.onMaximizeChanged(setIsMaximized), [])

  const handleMinimize = () => window.electronAPI.windowMinimize()
  const handleMaximize = () => window.electronAPI.windowMaximize()
  const handleClose = () => window.electronAPI.windowClose()

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-mark" aria-hidden>
          <AppIcon size={16} />
        </span>
        <span className="titlebar-name">CodeSpace</span>
      </div>

      <div className="titlebar-controls">
        <VolumeControl />
        <button
          className={`titlebar-btn titlebar-editor-toggle${editorOpen ? ' is-open' : ''}`}
          title="Editor (Ctrl+E)"
          onClick={onToggleEditor}
        >
          <CodeIcon />
        </button>
        <span className="titlebar-divider" aria-hidden />
        <div className="titlebar-window-controls">
          <button className="titlebar-window-btn" onClick={handleMinimize} title="Minimize">
            <MinusIcon />
          </button>
          <button className="titlebar-window-btn" onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button className="titlebar-window-btn titlebar-close" onClick={handleClose} title="Close">
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
