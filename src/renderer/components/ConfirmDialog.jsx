import { useEffect, useRef } from 'react'
import './ConfirmDialog.css'

export default function ConfirmDialog({
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
      if (e.key === 'Enter') onConfirm?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div className="cd-backdrop" onClick={onCancel}>
      <div className="cd-card" onClick={(e) => e.stopPropagation()}>
        <header className="cd-head">
          <h2 className="cd-title">{title}</h2>
        </header>

        <p className="cd-message">{message}</p>

        <div className="cd-actions">
          <button type="button" className="cd-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`cd-confirm${destructive ? ' destructive' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
