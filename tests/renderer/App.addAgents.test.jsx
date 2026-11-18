import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/renderer/components/TerminalPane.jsx', () => ({
  default: ({ id, onClose }) => (
    <div data-testid="pane">
      <button type="button" onClick={() => onClose(id)}>close {id}</button>
    </div>
  )
}))

import App from '../../src/renderer/App.jsx'

afterEach(() => { cleanup(); delete window.electronAPI })

function api(saved) {
  return new Proxy({
    loadWorkspaces: vi.fn(async () => ({ workspaces: [saved], activeWorkspaceId: saved.id })),
    getDesktopPath: vi.fn(async () => ''),
    getSettings: vi.fn(async () => ({
      version: 1,
      appearance: { theme: 'sarvis-dark', defaultPaneFontSize: 13 },
      notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
      updates: { autoUpdate: true },
      agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true }
    })),
    agentsAvailability: vi.fn(async () => ({ claude: true, codex: true })),
    saveWorkspaces: vi.fn(async () => {}),
    onCloseRequested: vi.fn(() => vi.fn()),
    onUpdateReady: vi.fn(() => vi.fn()),
    closePrompted: vi.fn(), confirmClose: vi.fn(), windowClose: vi.fn()
  }, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? vi.fn(() => vi.fn()) : vi.fn(async () => null)))
  })
}

const countText = (container) => container.querySelector('.sb-item-count')?.textContent

describe('App / adding agents to an empty workspace', () => {
  it('the sidebar counts agents added to a workspace restored with none', async () => {
    window.electronAPI = api({ id: 'w1', name: 'Desktop', dir: 'C:/Users/me/Desktop', agentCounts: { claude: 0, codex: 0 }, isolated: false })
    const { container } = render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Add 2 agents/ }, { timeout: 3000 }))
    await waitFor(() => expect(screen.getAllByTestId('pane').length).toBe(2))
    expect(countText(container)).toBe('2')
  })

  it('offers no add screen until the restored agents have spawned', async () => {
    let release
    const gate = new Promise(r => { release = r })
    window.electronAPI = api({ id: 'w1', name: 'Repo', dir: 'C:/repo', agentCounts: { claude: 1, codex: 0 }, isolated: true })
    window.electronAPI.worktree = {
      wipeAll: vi.fn(() => gate.then(() => ({ ok: true, kept: [], stranded: [] }))),
      create: vi.fn(async ({ agentId }) => ({ path: `C:/wt/${agentId}`, branch: `cs/repo/${agentId.slice(0, 8)}` })),
      close: vi.fn(async () => ({ ok: true })),
      isGitAvailable: vi.fn(async () => true),
      canIsolate: vi.fn(async () => ({ ok: true })),
      repairOrphans: vi.fn(async () => ({ ok: true }))
    }
    const { container } = render(<App />)
    await screen.findByText('Repo', {}, { timeout: 3000 })
    expect(screen.queryByRole('button', { name: /^Add \d agent/ })).toBeNull()
    release()
    await waitFor(() => expect(screen.getAllByTestId('pane').length).toBe(1))
    expect(countText(container)).toBe('1')
  })

  it('the sidebar counts agents added after closing every agent', async () => {
    window.electronAPI = api({ id: 'w1', name: 'Desktop', dir: 'C:/Users/me/Desktop', agentCounts: { claude: 2, codex: 0 }, isolated: false })
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getAllByTestId('pane').length).toBe(2), { timeout: 3000 })
    expect(countText(container)).toBe('2')
    for (const btn of screen.getAllByRole('button', { name: /^close / })) await userEvent.click(btn)
    await waitFor(() => expect(screen.queryAllByTestId('pane').length).toBe(0))
    expect(countText(container)).toBe('0')
    await userEvent.click(await screen.findByRole('button', { name: /^Add 2 agents/ }))
    await waitFor(() => expect(screen.getAllByTestId('pane').length).toBe(2))
    expect(countText(container)).toBe('2')
  })
})
