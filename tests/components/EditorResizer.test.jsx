import { render, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EditorResizer from '../../src/renderer/components/EditorResizer.jsx'

function renderResizer(props = {}) {
  return render(<EditorResizer
    width={500}
    bodyWidth={1400}
    onResize={vi.fn()}
    onResizeEnd={vi.fn()}
    onReset={vi.fn()}
    {...props}
  />)
}

describe('EditorResizer', () => {
  it('renders a handle element with role=separator', () => {
    renderResizer()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('calls onResize during pointer drag', () => {
    const onResize = vi.fn()
    renderResizer({ onResize })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { clientX: 900 })
    fireEvent.pointerMove(handle, { clientX: 700 })
    expect(onResize).toHaveBeenCalled()
  })

  it('calls onResizeEnd after pointer up', () => {
    const onResizeEnd = vi.fn()
    renderResizer({ onResizeEnd })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { clientX: 900 })
    fireEvent.pointerUp(handle, { clientX: 900 })
    expect(onResizeEnd).toHaveBeenCalled()
  })

  it('calls onReset on double click', () => {
    const onReset = vi.fn()
    renderResizer({ onReset })
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(onReset).toHaveBeenCalled()
  })
})
