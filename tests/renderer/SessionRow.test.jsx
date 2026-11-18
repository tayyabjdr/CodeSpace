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

  it('shows status as a dot on the right and keeps the logo unstyled', () => {
    const { rerender, container } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-dot.running')).toBeTruthy()
    expect(container.querySelector('.sb-session-logo').className).toBe('sb-session-logo')

    rerender(<SessionRow term={TERM} status="done" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-dot.done')).toBeTruthy()

    rerender(<SessionRow term={TERM} status="exited" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-dot.exited')).toBeTruthy()
    expect(container.querySelector('.sb-session').className).toContain('exited')
  })

  it('shows the agent type and branch on a second line', () => {
    const { container, rerender } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-sub').textContent).toBe('Claude')

    rerender(<SessionRow term={{ ...TERM, branch: 'cs/repo/ab12' }} status="running" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-sub').textContent).toBe('Claude · ab12')

    rerender(<SessionRow term={{ ...TERM, shell: 'codex', branch: 'cs/repo/ab12' }} status="exited" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-sub').textContent).toBe('Codex · exited')
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

  it('draws no logo for a shell without one but still shows its status', () => {
    const { container } = render(
      <SessionRow term={{ ...TERM, shell: 'other' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-logo svg')).toBeNull()
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
