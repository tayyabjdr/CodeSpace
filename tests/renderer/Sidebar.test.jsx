import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar from '../../src/renderer/components/Sidebar.jsx'

const WORKSPACES = [
  {
    id: 'w1', name: 'CodeSpace', nickname: null, spawned: true, agentCounts: { claude: 2, codex: 0 },
    terminals: [
      { id: 't1', ptyId: 'p1', shell: 'claude', name: '', autoName: 'alpha', agentNum: 1 },
      { id: 't2', ptyId: 'p2', shell: 'claude', name: '', autoName: 'beta',  agentNum: 2 }
    ]
  },
  {
    id: 'w2', name: 'portfolio', nickname: null, spawned: true, agentCounts: { claude: 1, codex: 0 },
    terminals: [{ id: 't3', ptyId: 'p3', shell: 'codex', name: '', autoName: 'gamma', agentNum: 1 }]
  },
  { id: 'w3', name: 'idle', nickname: null, spawned: false, agentCounts: { claude: 0, codex: 0 }, terminals: [] }
]

const base = {
  workspaces: WORKSPACES,
  activeId: 'w1',
  expandedIds: new Set(),
  doneTermIds: new Set(),
  exitedPtyIds: new Set(),
  focusedTerminalId: null,
  onSelect: () => {}, onToggleExpand: () => {}, onSelectSession: () => {},
  onCreate: () => {}, onDelete: () => {}, onOpenSettings: () => {}, onRenameNickname: () => {}
}

describe('Sidebar tree', () => {
  it('renders a tree containing every workspace', () => {
    render(<Sidebar {...base} />)
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('portfolio')).toBeTruthy()
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('hides sessions of collapsed workspaces', () => {
    render(<Sidebar {...base} />)
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('shows sessions of expanded workspaces, including non-active ones', () => {
    render(<Sidebar {...base} expandedIds={new Set(['w2'])} />)
    expect(screen.getByText('gamma')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('marks a session exited when its ptyId is in exitedPtyIds', () => {
    const { container } = render(
      <Sidebar {...base} expandedIds={new Set(['w1'])} exitedPtyIds={new Set(['p2'])} />
    )
    const rows = container.querySelectorAll('.sb-session')
    expect(rows[0].querySelector('.sb-session-dot').className).toContain('running')
    expect(rows[1].querySelector('.sb-session-dot').className).toContain('exited')
  })

  it('prefers exited over done when both apply', () => {
    const { container } = render(
      <Sidebar {...base}
        expandedIds={new Set(['w1'])}
        doneTermIds={new Set(['t1'])}
        exitedPtyIds={new Set(['p1'])} />
    )
    const dot = container.querySelector('.sb-session .sb-session-dot')
    expect(dot.className).toContain('exited')
  })

  it('fires onSelectSession with workspace and terminal ids', async () => {
    const onSelectSession = vi.fn()
    render(<Sidebar {...base} expandedIds={new Set(['w2'])} onSelectSession={onSelectSession} />)
    await userEvent.click(screen.getByText('gamma'))
    expect(onSelectSession).toHaveBeenCalledWith('w2', 't3')
  })

  it('shows the aggregate done dot on a collapsed workspace with a done agent', () => {
    const { container } = render(<Sidebar {...base} doneTermIds={new Set(['t3'])} />)
    expect(container.querySelectorAll('.sb-item-dot').length).toBe(1)
  })

  it('moves focus down through the visible flattened list', async () => {
    const { container } = render(<Sidebar {...base} expandedIds={new Set(['w1'])} />)
    const nodes = () => Array.from(container.querySelectorAll('[data-sb-node]'))
    nodes()[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    // w1 expanded, so its first session is next — not w2
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('t1')
  })

  it('skips hidden sessions when the workspace is collapsed', async () => {
    const { container } = render(<Sidebar {...base} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('w2')
  })

  it('expands with ArrowRight and collapses with ArrowLeft', async () => {
    const onToggleExpand = vi.fn()
    const { container } = render(<Sidebar {...base} onToggleExpand={onToggleExpand} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onToggleExpand).toHaveBeenCalledWith('w1')
  })

  it('does not steal keys while a nickname is being edited', async () => {
    const onToggleExpand = vi.fn()
    render(<Sidebar {...base} onToggleExpand={onToggleExpand} />)
    await userEvent.dblClick(screen.getAllByText('add nickname', { selector: '.sb-item-nickname-hint' })[0])
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.type(input, 'ab')
    expect(input.value).toBe('ab')
    expect(onToggleExpand).not.toHaveBeenCalled()
  })
})
