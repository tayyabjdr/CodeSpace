import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RightToolbar from '../../src/renderer/components/RightToolbar.jsx'

describe('RightToolbar', () => {
  it('renders the Skills icon button', () => {
    render(<RightToolbar activePanel={null} onSelectPanel={() => {}} />)
    expect(screen.getByRole('button', { name: /skills/i })).toBeTruthy()
  })

  it('marks the active panel button with aria-pressed=true', () => {
    render(<RightToolbar activePanel="skills" onSelectPanel={() => {}} />)
    const btn = screen.getByRole('button', { name: /skills/i })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('fires onSelectPanel with "skills" when the Skills icon is clicked', async () => {
    const onSelect = vi.fn()
    render(<RightToolbar activePanel={null} onSelectPanel={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /skills/i }))
    expect(onSelect).toHaveBeenCalledWith('skills')
  })

  it('passes the same panel id again when clicking the already-active icon (toggle close)', async () => {
    const onSelect = vi.fn()
    render(<RightToolbar activePanel="skills" onSelectPanel={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /skills/i }))
    // App.jsx is responsible for interpreting "click active → close"; the
    // toolbar's job is to fire the same id so the parent can compare.
    expect(onSelect).toHaveBeenCalledWith('skills')
  })

  it('does not render a Settings button (settings lives in the left sidebar)', () => {
    render(<RightToolbar activePanel={null} onSelectPanel={() => {}} />)
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull()
  })

  it('does not fire onSelectPanel when a disabled stub button is clicked', async () => {
    const onSelect = vi.fn()
    render(<RightToolbar activePanel={null} onSelectPanel={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /slash commands/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
