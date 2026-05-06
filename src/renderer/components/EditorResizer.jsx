import { useCallback, useRef, useState } from 'react'
import { clampWidth } from '../editor-state.js'
import './EditorResizer.css'

export default function EditorResizer({ width, bodyWidth, onResize, onResizeEnd, onReset }) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, w: width })

  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    e.target.setPointerCapture?.(e.pointerId)
    setDragging(true)
    startRef.current = { x: e.clientX, w: width }
  }, [width])

  const onPointerMove = useCallback((e) => {
    if (!dragging) return
    const delta = startRef.current.x - e.clientX
    const next  = clampWidth(startRef.current.w + delta, bodyWidth)
    onResize?.(next)
  }, [dragging, bodyWidth, onResize])

  const onPointerUp = useCallback((e) => {
    if (!dragging) return
    setDragging(false)
    e.target.releasePointerCapture?.(e.pointerId)
    onResizeEnd?.()
  }, [dragging, onResizeEnd])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`editor-resizer ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  )
}
