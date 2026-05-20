import { useCallback, useRef, useState } from 'react'
import { clampPanelWidth } from '../skills-state.js'
import './SkillsPanelResizer.css'

export default function SkillsPanelResizer({ width, bodyWidth, onResize, onResizeEnd, onReset, style }) {
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
    const delta = startRef.current.x - e.clientX  // moving left → positive delta → wider
    onResize?.(clampPanelWidth(startRef.current.w + delta, bodyWidth))
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
      className={`skills-panel-resizer${dragging ? ' dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
    />
  )
}
