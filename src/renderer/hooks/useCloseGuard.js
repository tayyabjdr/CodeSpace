import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Renderer half of the close handshake. Main blocks the close and asks us to
 * prompt; we ack so main knows we are alive, then surface closeRequested so
 * the caller can render the dialog.
 *
 * `ready` gates whether we can actually draw that dialog (the caller may
 * still be showing its own `!loaded` null render). The subscription is
 * created once in a mount-only effect, so `ready` is tracked in a ref that
 * the handler reads at request time rather than a dependency that would
 * force a resubscribe — a resubscribe has a window where the old listener
 * is torn down and the new one isn't attached yet, and a close request
 * landing in that gap would be silently dropped instead of falling through
 * to main's failsafe. When not ready we must NOT ack and must NOT set
 * closeRequested: leave main's 1500ms failsafe to fire and close the window,
 * which is the intended behaviour for a window that cannot render a dialog.
 */
export default function useCloseGuard(ready) {
  const [closeRequested, setCloseRequested] = useState(false)
  const readyRef = useRef(ready)
  useEffect(() => { readyRef.current = ready }, [ready])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCloseRequested) return undefined
    return api.onCloseRequested(() => {
      if (!readyRef.current) return
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
