import { useState } from 'react'
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

export default function Toolbar({ onAdd, agentCount }) {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleMinimize = () => window.electronAPI.windowMinimize()
  const handleMaximize = () => {
    window.electronAPI.windowMaximize()
    setIsMaximized(p => !p)
  }
  const handleClose = () => window.electronAPI.windowClose()

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-mark">
          <span style={{ height: '4px',  opacity: 0.55 }} />
          <span style={{ height: '7px',  opacity: 0.75 }} />
          <span style={{ height: '11px', opacity: 1    }} />
          <span style={{ height: '5px',  opacity: 0.65 }} />
        </div>
        <span className="titlebar-name">CodeSpace</span>
      </div>

      <div className="titlebar-actions" />

      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize} title="Minimize">
          <MinusIcon />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="titlebar-btn titlebar-close" onClick={handleClose} title="Close">
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
