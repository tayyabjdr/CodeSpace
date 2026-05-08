import { useEffect, useState } from 'react'
import './UpdateToast.css'

export default function UpdateToast() {
  const [ready, setReady] = useState(null)

  useEffect(() => {
    return window.electronAPI.onUpdateReady((info) => setReady(info))
  }, [])

  if (!ready) return null

  return (
    <div className="update-toast" role="status">
      <span className="update-toast-icon" aria-hidden="true">↻</span>
      <span className="update-toast-text">
        Update ready (v{ready.version})
      </span>
      <div className="update-toast-actions">
        <button
          className="update-toast-btn update-toast-btn-primary"
          onClick={() => window.electronAPI.installUpdate()}
        >
          Restart now
        </button>
        <button
          className="update-toast-btn"
          onClick={() => setReady(null)}
        >
          Later
        </button>
      </div>
    </div>
  )
}
