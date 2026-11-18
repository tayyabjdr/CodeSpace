import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toolbar from '../../src/renderer/components/Toolbar.jsx'

beforeEach(() => {
  window.electronAPI = {
    onMaximizeChanged: () => () => {},
    windowMinimize: vi.fn(), windowMaximize: vi.fn(), windowClose: vi.fn()
  }
})
afterEach(() => { delete window.electronAPI })

describe('Toolbar sidebar toggle', () => {
  it('says what a click will do and reports the open state', () => {
    const { rerender } = render(<Toolbar sidebarCollapsed={false} onToggleSidebar={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.title).toBe('Hide sidebar (Ctrl+B)')

    rerender(<Toolbar sidebarCollapsed onToggleSidebar={() => {}} />)
    expect(screen.getByRole('button', { name: 'Show sidebar' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('calls onToggleSidebar when clicked', async () => {
    const onToggleSidebar = vi.fn()
    render(<Toolbar sidebarCollapsed={false} onToggleSidebar={onToggleSidebar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('renders no toggle when no handler is given', () => {
    render(<Toolbar />)
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull()
  })
})
