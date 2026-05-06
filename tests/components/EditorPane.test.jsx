import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import EditorPane from '../../src/renderer/components/EditorPane.jsx'

const baseProps = {
  file: null, line: null, dirty: false, width: 600,
  fontSize: 13, isExternal: false,
  onSave: vi.fn(), onClose: vi.fn(), onResize: vi.fn(), onRevealInFolder: vi.fn(),
}

describe('EditorPane', () => {
  it('renders empty state when file is null', () => {
    render(<EditorPane {...baseProps} />)
    expect(screen.getByText(/Ctrl\+click any path/i)).toBeInTheDocument()
  })

  it('renders filename in header when file is set', () => {
    render(<EditorPane {...baseProps} file="C:\\Users\\TJ\\src\\foo.ts" loadState="content" content="hi" />)
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
  })

  it('shows dirty dot when dirty is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" dirty loadState="content" content="" />)
    expect(screen.getByTestId('dirty-dot')).toHaveClass('is-dirty')
  })

  it('shows external badge when isExternal is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" isExternal loadState="content" content="" />)
    expect(screen.getByText(/external/i)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<EditorPane {...baseProps} file="C:\\foo.ts" onClose={onClose} loadState="content" content="" />)
    fireEvent.click(screen.getByTitle('Close editor'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error UI for too-large state', () => {
    render(<EditorPane {...baseProps} file="C:\\big" loadState="error" errorReason="too-large" />)
    expect(screen.getByText(/too large/i)).toBeInTheDocument()
    expect(screen.getByText(/reveal in folder/i)).toBeInTheDocument()
  })
})
