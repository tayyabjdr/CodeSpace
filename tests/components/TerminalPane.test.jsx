import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUseTerminal = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/hooks/useTerminal.js', () => ({
  default: mockUseTerminal
}))

import TerminalPane from '../../src/renderer/components/TerminalPane.jsx'

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTerminal.mockReturnValue({ error: null, exitCode: null })
  })

  it('renders pane header with shell name', () => {
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText('powershell')).toBeInTheDocument()
  })

  it('renders close button', () => {
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByTitle('Close terminal')).toBeInTheDocument()
  })

  it('calls onClose with id when × is clicked', () => {
    const onClose = vi.fn()
    render(<TerminalPane id="abc" shell="powershell" onClose={onClose} onFocus={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Close terminal'))
    expect(onClose).toHaveBeenCalledWith('abc')
  })

  it('calls onFocus with id when pane is clicked', () => {
    const onFocus = vi.fn()
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={onFocus} />)
    fireEvent.click(screen.getByText('powershell'))
    expect(onFocus).toHaveBeenCalledWith('abc')
  })

  it('shows error message when useTerminal returns an error', () => {
    mockUseTerminal.mockReturnValue({ error: 'spawn failed', exitCode: null })
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText('spawn failed')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('adds exited class to header when exitCode is not null', () => {
    mockUseTerminal.mockReturnValue({ error: null, exitCode: 1 })
    render(<TerminalPane id="abc" shell="powershell" onClose={vi.fn()} onFocus={vi.fn()} />)
    expect(screen.getByText(/exited: 1/)).toBeInTheDocument()
  })
})
