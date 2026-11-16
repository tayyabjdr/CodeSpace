import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionRow from '../../src/renderer/components/SessionRow.jsx'

const TERM = { id: 't1', shell: 'claude', name: '', autoName: 'fix the pty bug', agentNum: 1 }

describe('SessionRow', () => {
  it('renders the auto-generated name', () => {
    render(<SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />)
    expect(screen.getByText('fix the pty bug')).toBeTruthy()
  })

  it('prefers an explicit name over the auto name', () => {
    render(
      <SessionRow term={{ ...TERM, name: 'renamed' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(screen.getByText('renamed')).toBeTruthy()
  })

  it('falls back to a padded agent number when unnamed', () => {
    render(
      <SessionRow term={{ ...TERM, name: '', autoName: '' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(screen.getByText('Agent 01')).toBeTruthy()
  })

  it('marks the logo running, done, or exited from status', () => {
    const { rerender, container } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-logo.running')).toBeTruthy()

    rerender(<SessionRow term={TERM} status="done" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-logo.done')).toBeTruthy()

    rerender(<SessionRow term={TERM} status="exited" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-logo.exited')).toBeTruthy()
    expect(container.querySelector('.sb-session-dot')).toBeNull()
  })

  it('shows the agent logo for the shell', () => {
    const { container } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-logo svg').getAttribute('aria-label')).toBe('Claude')

    const { container: c2 } = render(
      <SessionRow term={{ ...TERM, shell: 'codex' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(c2.querySelector('.sb-session-logo svg').getAttribute('aria-label')).toBe('Codex')
  })

  it('falls back to a dot for a shell without a logo', () => {
    const { container } = render(
      <SessionRow term={{ ...TERM, shell: 'other' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-dot.running')).toBeTruthy()
  })

  it('fires onSelect with the term id when clicked', async () => {
    const onSelect = vi.fn()
    render(<SessionRow term={TERM} status="running" isFocused={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('fix the pty bug'))
    expect(onSelect).toHaveBeenCalledWith('t1')
  })

  it('marks itself selected for assistive tech when focused', () => {
    const { container } = render(
      <SessionRow term={TERM} status="running" isFocused onSelect={() => {}} />
    )
    const row = container.querySelector('[role="treeitem"]')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.className).toContain('focused')
  })
})
