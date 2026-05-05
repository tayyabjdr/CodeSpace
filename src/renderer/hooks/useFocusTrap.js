import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Trap Tab/Shift+Tab inside the container, restoring focus on cleanup.
// Usage: useFocusTrap(containerRef, isOpen)
export default function useFocusTrap(containerRef, active = true) {
  useEffect(() => {
    if (!active || !containerRef.current) return
    const previouslyFocused = document.activeElement
    const root = containerRef.current

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const items = Array.from(root.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const focused = document.activeElement
      if (e.shiftKey) {
        if (focused === first || !root.contains(focused)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (focused === last || !root.contains(focused)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus() } catch {}
      }
    }
  }, [active, containerRef])
}
