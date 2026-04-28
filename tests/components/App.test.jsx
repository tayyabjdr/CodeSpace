import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../../src/renderer/App.jsx'

// Mock TerminalPane so xterm.js never initialises in tests
vi.mock('../../src/renderer/components/TerminalPane.jsx', () => ({
  default: ({ id, shell, onClose, onFocus }) => (
    <div data-testid={`pane-${id}`} onClick={() => onFocus(id)}>
      <span className="pane-shell-label">{shell}</span>
      <button onClick={(e) => { e.stopPropagation(); onClose(id) }}>×</button>
    </div>
  )
}))

// Stub crypto.randomUUID so IDs are predictable
let uuidCounter = 0
vi.stubGlobal('crypto', { randomUUID: () => `id-${++uuidCounter}` })

describe('App', () => {
  beforeEach(() => {
    uuidCounter = 0
  })

  it('renders toolbar', () => {
    render(<App />)
    expect(screen.getByText('+ Add Terminal')).toBeInTheDocument()
  })

  it('starts with no terminal panes', () => {
    render(<App />)
    expect(screen.queryByTestId(/^pane-/)).not.toBeInTheDocument()
  })

  it('adds a terminal when + Add Terminal is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(screen.getByTestId('pane-id-1')).toBeInTheDocument()
  })

  it('removes a terminal when × is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    fireEvent.click(screen.getByText('×'))
    expect(screen.queryByTestId('pane-id-1')).not.toBeInTheDocument()
  })

  it('sets grid to 1 column for 1 terminal', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(1, 1fr)')
  })

  it('sets grid to 4 columns for 4 terminals', () => {
    const { container } = render(<App />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 1fr)')
  })

  it('caps grid at 4 columns for 5+ terminals', () => {
    const { container } = render(<App />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('+ Add Terminal'))
    const grid = container.querySelector('.grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 1fr)')
  })
})
