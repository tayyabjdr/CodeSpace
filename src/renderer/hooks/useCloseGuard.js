import { useCallback, useEffect, useState } from 'react'

/**
 * Renderer half of the close handshake. Main blocks the close and asks us to
 * prompt; we ack so main knows we are alive, then surface closeRequested so
 * the caller can render the dialog.
 */
export default function useCloseGuard() {
  const [closeRequested, setCloseRequested] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCloseRequested) return undefined
    return api.onCloseRequested(() => {
      // Receiving this at all proves the renderer is pumping IPC, which is
      // exactly what the ack means. No reason to wait for paint.
      api.closePrompted?.()
      setCloseRequested(true)
    })
  }, [])

  const cancelClose = useCallback(() => setCloseRequested(false), [])

  const confirmClose = useCallback(() => {
    setCloseRequested(false)
    window.electronAPI?.confirmClose?.()
  }, [])

  return { closeRequested, cancelClose, confirmClose }
}
