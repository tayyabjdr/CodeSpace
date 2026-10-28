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
    const { container, rerender } = render(<Sidebar {...base} onToggleExpand={onToggleExpand} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onToggleExpand).toHaveBeenCalledWith('w1')

    // Controlled component: re-render as the caller would after honoring
    // the toggle, then verify the reverse key collapses the same row.
    onToggleExpand.mockClear()
    rerender(<Sidebar {...base} expandedIds={new Set(['w1'])} onToggleExpand={onToggleExpand} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onToggleExpand).toHaveBeenCalledWith('w1')
  })

  it('moves focus to the first session when ArrowRight is pressed on an already-expanded workspace', async () => {
    const { container } = render(<Sidebar {...base} expandedIds={new Set(['w1'])} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('t1')
  })

  it('absorbs ArrowRight on a workspace with no sessions instead of moving focus', async () => {
    // Regression: a childless workspace fell into the same branch as a
    // collapsed-with-children workspace and moved focus to the next node,
    // behaving like ArrowDown. ARIA APG says Right on a node with no
    // children should do nothing. Use a non-last childless workspace so a
    // focus-index clamp at the end of the list can't mask the bug.
    const onToggleExpand = vi.fn()
    const workspaces = [
      { id: 'a', name: 'alpha', nickname: null, spawned: false, agentCounts: { claude: 0, codex: 0 }, terminals: [] },
      {
        id: 'b', name: 'beta', nickname: null, spawned: true, agentCounts: { claude: 1, codex: 0 },
        terminals: [{ id: 't1', ptyId: 'p1', shell: 'claude', name: '', autoName: 'one', agentNum: 1 }]
      }
    ]
    const { container } = render(<Sidebar {...base} workspaces={workspaces} onToggleExpand={onToggleExpand} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onToggleExpand).not.toHaveBeenCalled()
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('a')
  })

  it('moves focus to the parent workspace when ArrowLeft is pressed on a session', async () => {
    const { container } = render(<Sidebar {...base} expandedIds={new Set(['w1'])} />)
    container.querySelectorAll('[data-sb-node]')[1].focus()
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('t1')
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('w1')
  })

  it('activates a workspace with Enter, firing onSelect', async () => {
    const onSelect = vi.fn()
    const { container } = render(<Sidebar {...base} onSelect={onSelect} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('w1')
  })

  it('activates a session with Space, firing onSelectSession', async () => {
    const onSelectSession = vi.fn()
    const { container } = render(
      <Sidebar {...base} expandedIds={new Set(['w1'])} onSelectSession={onSelectSession} />
    )
    container.querySelectorAll('[data-sb-node]')[1].focus()
    await userEvent.keyboard(' ')
    expect(onSelectSession).toHaveBeenCalledWith('w1', 't1')
  })

  it('deletes a workspace on Delete', async () => {
    const onDelete = vi.fn()
    const { container } = render(<Sidebar {...base} onDelete={onDelete} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{Delete}')
    expect(onDelete).toHaveBeenCalledWith('w1')
  })

  it('deletes a workspace on Shift+Backspace', async () => {
    const onDelete = vi.fn()
    const { container } = render(<Sidebar {...base} onDelete={onDelete} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{Shift>}{Backspace}{/Shift}')
    expect(onDelete).toHaveBeenCalledWith('w1')
  })

  it('does not delete on Delete when focus is on a session row', async () => {
    const onDelete = vi.fn()
    const { container } = render(
      <Sidebar {...base} expandedIds={new Set(['w1'])} onDelete={onDelete} />
    )
    container.querySelectorAll('[data-sb-node]')[1].focus()
    await userEvent.keyboard('{Delete}')
    expect(onDelete).not.toHaveBeenCalled()
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

  it('renders a Skills nav row above the workspaces header', () => {
    const { container } = render(<Sidebar {...base} skillsOpen={false} onToggleSkills={() => {}} />)
    const nav = container.querySelector('.sb-nav-item')
    expect(nav).toBeTruthy()
    expect(nav.textContent).toBe('Skills')

    // Order matters: the nav sits above the Workspaces header, not below it.
    const header = container.querySelector('.sb-header')
    expect(nav.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders Skills and Workspaces as matching tabs with icons', () => {
    const { container } = render(<Sidebar {...base} skillsOpen={false} onToggleSkills={() => {}} />)
    const tabs = [...container.querySelectorAll('.sb-nav-item')]
    expect(tabs.map(t => t.querySelector('.sb-nav-label').textContent)).toEqual(['Skills', 'Workspaces'])
    for (const t of tabs) expect(t.querySelector('.sb-nav-icon svg')).toBeTruthy()
  })

  it('calls onToggleSkills when the Skills row is clicked', async () => {
    const onToggleSkills = vi.fn()
    render(<Sidebar {...base} skillsOpen={false} onToggleSkills={onToggleSkills} />)
    await userEvent.click(screen.getByText('Skills'))
    expect(onToggleSkills).toHaveBeenCalledTimes(1)
  })

  it('reports the panel open state to assistive tech', () => {
    const { container, rerender } = render(
      <Sidebar {...base} skillsOpen={false} onToggleSkills={() => {}} />
    )
    expect(container.querySelector('.sb-nav-item').getAttribute('aria-pressed')).toBe('false')

    rerender(<Sidebar {...base} skillsOpen onToggleSkills={() => {}} />)
    expect(container.querySelector('.sb-nav-item').getAttribute('aria-pressed')).toBe('true')
  })

  it('marks the Skills row active when its panel is open', () => {
    const { container } = render(<Sidebar {...base} skillsOpen onToggleSkills={() => {}} />)
    expect(container.querySelector('.sb-nav-item').className).toContain('is-open')
  })
})
