import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkspaceRow from '../../src/renderer/components/WorkspaceRow.jsx'

const WS = {
  id: 'w1',
  name: 'CodeSpace',
  nickname: 'shell redesign',
  isolated: false,
  unconfigured: false,
  spawned: true,
  terminals: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  agentCounts: { claude: 3, codex: 0 }
}

const noop = () => {}
const base = {
  isActive: false, isExpanded: false, hasSessions: true, showDoneDot: false,
  onSelect: noop, onToggleExpand: noop, onDelete: noop, onRenameNickname: noop
}

describe('WorkspaceRow', () => {
  it('renders name and nickname on separate lines', () => {
    render(<WorkspaceRow ws={WS} {...base} />)
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('shell redesign')).toBeTruthy()
  })

  it('shows the add-nickname hint when there is no nickname', () => {
    render(<WorkspaceRow ws={{ ...WS, nickname: null }} {...base} />)
    expect(screen.getByText('add nickname')).toBeTruthy()
  })

  it('shows the live terminal count for a spawned workspace', () => {
    render(<WorkspaceRow ws={WS} {...base} />)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('falls back to agentCounts when not yet spawned', () => {
    render(
      <WorkspaceRow ws={{ ...WS, spawned: false, terminals: [], agentCounts: { claude: 2, codex: 2 } }} {...base} />
    )
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('renders no chevron when the workspace has no sessions', () => {
    const { container } = render(<WorkspaceRow ws={WS} {...base} hasSessions={false} />)
    expect(container.querySelector('.sb-chevron')).toBeNull()
  })

  it('toggles expansion without activating the workspace', async () => {
    const onToggleExpand = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(
      <WorkspaceRow ws={WS} {...base} onToggleExpand={onToggleExpand} onSelect={onSelect} />
    )
    await userEvent.click(container.querySelector('.sb-chevron'))
    expect(onToggleExpand).toHaveBeenCalledWith('w1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('activates the workspace when the row body is clicked', async () => {
    const onSelect = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('CodeSpace'))
    expect(onSelect).toHaveBeenCalledWith('w1')
  })

  it('shows the aggregate done dot only when collapsed', () => {
    const { container, rerender } = render(
      <WorkspaceRow ws={WS} {...base} showDoneDot isExpanded={false} />
    )
    expect(container.querySelector('.sb-item-dot')).toBeTruthy()

    rerender(<WorkspaceRow ws={WS} {...base} showDoneDot isExpanded />)
    expect(container.querySelector('.sb-item-dot')).toBeNull()
  })

  it('commits a nickname edit on Enter', async () => {
    const onRenameNickname = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onRenameNickname={onRenameNickname} />)
    await userEvent.dblClick(screen.getByText('shell redesign'))
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.clear(input)
    await userEvent.type(input, 'new nick{Enter}')
    expect(onRenameNickname).toHaveBeenCalledWith('w1', 'new nick')
  })

  it('cancels a nickname edit on Escape without calling the handler', async () => {
    const onRenameNickname = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onRenameNickname={onRenameNickname} />)
    await userEvent.dblClick(screen.getByText('shell redesign'))
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.type(input, 'xyz{Escape}')
    expect(onRenameNickname).not.toHaveBeenCalled()
  })

  it('deletes via the button that occupies the count slot', async () => {
    const onDelete = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onDelete={onDelete} />)
    await userEvent.click(screen.getByTitle('Delete workspace'))
    expect(onDelete).toHaveBeenCalledWith('w1')
  })

  it('reports expansion state to assistive tech', () => {
    const { container, rerender } = render(<WorkspaceRow ws={WS} {...base} isExpanded={false} />)
    expect(container.querySelector('[role="treeitem"]').getAttribute('aria-expanded')).toBe('false')

    rerender(<WorkspaceRow ws={WS} {...base} isExpanded />)
    expect(container.querySelector('[role="treeitem"]').getAttribute('aria-expanded')).toBe('true')
  })
})
