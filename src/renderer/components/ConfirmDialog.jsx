import { useEffect, useRef } from 'react'
import useFocusTrap from '../hooks/useFocusTrap.js'
import './ConfirmDialog.css'

export default function ConfirmDialog({
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  extraLabel,
  destructive = false,
  initialFocus = 'confirm',
  onConfirm,
  onCancel,
  onExtra
}) {
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)
  const extraRef = useRef(null)
  const cardRef = useRef(null)

  useFocusTrap(cardRef, true)

  useEffect(() => {
    const target = initialFocus === 'cancel' ? cancelRef.current : confirmRef.current
    target?.focus()
  }, [initialFocus])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel?.()
        return
      }
      if (e.key !== 'Enter') return
      // Only act when focus is actually inside the dialog. Otherwise an Enter
      // typed elsewhere (e.g. into a terminal) would dismiss it.
      const card = cardRef.current
      const active = document.activeElement
      if (!card || (card !== active && !card.contains(active))) return
      e.preventDefault()
      // Route to whichever button holds focus. Enter must never confirm just
      // because the dialog is open; the close guard focuses cancel on purpose.
      if (active === cancelRef.current) onCancel?.()
      else if (active === extraRef.current) onExtra?.()
      else onConfirm?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm, onExtra])

  return (
    <div className="cd-backdrop" onClick={onCancel}>
      <div ref={cardRef} className="cd-card" onClick={(e) => e.stopPropagation()}>
        <header className="cd-head">
          <h2 className="cd-title">{title}</h2>
        </header>

        <p className="cd-message">{message}</p>

        <div className="cd-actions">
          <button type="button" ref={cancelRef} className="cd-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          {extraLabel && (
            <button type="button" ref={extraRef} className="cd-extra" onClick={onExtra}>
              {extraLabel}
            </button>
          )}
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
