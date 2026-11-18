import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'

vi.mock('../../src/renderer/pty-pool.js', () => ({
  writePty: vi.fn(),
  onWrite: vi.fn(() => () => {}),
  attach: vi.fn(() => () => {})
}))

import * as activity from '../../src/renderer/pty-activity.js'
import * as mergeStatus from '../../src/renderer/merge-status.js'
import AgentCard from '../../src/renderer/components/AgentCard.jsx'
import Sidebar from '../../src/renderer/components/Sidebar.jsx'

let info
let merge
let worktree

const props = { agentId: 'a1', ptyId: 'p1', repoDir: 'D:\\repo', agentName: 'Agent 01', branch: 'cs/repo/a1' }

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function renderQuiet(ui) {
  const utils = render(ui)
  await flush()
  act(() => { vi.advanceTimersByTime(4000) })
  await flush()
  return utils
}

beforeEach(() => {
  vi.useFakeTimers()
  activity._resetForTests()
  mergeStatus._resetForTests()
  info = { ahead: 2, files: 4, dirty: true, insertions: 182, deletions: 61, target: 'master' }
  merge = {
    finish: vi.fn(async () => ({ accepted: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    info: vi.fn(async () => info),
    onStatus: vi.fn(() => () => {})
  }
  worktree = { openFolder: vi.fn(async () => ({ ok: true })) }
  window.electronAPI = { merge, worktree }
})

afterEach(() => {
  vi.useRealTimers()
  delete window.electronAPI
})

describe('AgentCard', () => {
  it('shows branch, files, lines and commits ahead', async () => {
    const { container } = await renderQuiet(<AgentCard {...props} />)
    expect(container.querySelector('.sb-card-branch').textContent).toBe('cs/repo/a1')
    expect(container.querySelector('.sb-card-stats').textContent).toBe('4 files+182−61·2 ahead')
  })

  it('renders nothing while the branch has no changes', async () => {
    info = { ahead: 0, files: 0, dirty: false, insertions: 0, deletions: 0, target: 'master' }
    const { container } = await renderQuiet(<AgentCard {...props} />)
    expect(container.querySelector('.sb-card')).toBeNull()
  })

  it('renders nothing without a branch', async () => {
    const { container } = await renderQuiet(<AgentCard {...props} branch={undefined} />)
    expect(container.querySelector('.sb-card')).toBeNull()
  })

  it('finishes through the merge API once the pane is quiet', async () => {
    const { getByText } = await renderQuiet(<AgentCard {...props} />)
    const btn = getByText('Finish')
    expect(btn.disabled).toBe(false)
    fireEvent.mouseDown(btn, { button: 0 })
    fireEvent.click(btn)
    await flush()
    expect(merge.finish).toHaveBeenCalledWith({ repoDir: 'D:\\repo', agentId: 'a1', agentName: 'Agent 01' })
  })

  it('opens the agent folder', async () => {
    const { getByText } = await renderQuiet(<AgentCard {...props} />)
    fireEvent.click(getByText('Open folder'))
    expect(worktree.openFolder).toHaveBeenCalledWith({ repoDir: 'D:\\repo', agentId: 'a1' })
  })
})

describe('Sidebar agent card', () => {
  const ws = (over = {}) => ({
    id: 'w1', name: 'repo', dir: 'D:\\repo', isolated: true, spawned: true,
    agentCounts: { claude: 1, codex: 0 },
    terminals: [{ id: 'a1', ptyId: 'p1', shell: 'claude', name: '', autoName: 'alpha', agentNum: 1, branch: 'cs/repo/a1' }],
    ...over
  })
  const base = {
    activeId: 'w1', expandedIds: new Set(), doneTermIds: new Set(), exitedPtyIds: new Set(),
    onSelect: () => {}, onToggleExpand: () => {}, onSelectSession: () => {},
    onCreate: () => {}, onDelete: () => {}, onOpenSettings: () => {}, onRenameNickname: () => {}
  }

  it('follows the focused agent of an isolated workspace', async () => {
    const { container } = await renderQuiet(<Sidebar {...base} workspaces={[ws()]} focusedTerminalId="a1" />)
    expect(container.querySelector('.sb-card-branch').textContent).toBe('cs/repo/a1')
    expect(merge.info).toHaveBeenCalledWith({ repoDir: 'D:\\repo', agentId: 'a1' })
  })

  it('is absent for a shared workspace or with no focused agent', async () => {
    const { container, rerender } = await renderQuiet(<Sidebar {...base} workspaces={[ws({ isolated: false })]} focusedTerminalId="a1" />)
    expect(container.querySelector('.sb-card')).toBeNull()
    rerender(<Sidebar {...base} workspaces={[ws()]} focusedTerminalId={null} />)
    await flush()
    expect(container.querySelector('.sb-card')).toBeNull()
  })
})
