import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/App.jsx'

afterEach(() => { delete window.electronAPI })

function api(closeAllResult) {
  const worktree = {
    isGitAvailable: vi.fn(async () => true),
    isGitRepo: vi.fn(async () => true),
    canIsolate: vi.fn(async () => ({ ok: true, reason: null })),
    wipeAll: vi.fn(async () => ({ ok: true, kept: [], stranded: [] })),
    closeAll: vi.fn(async () => closeAllResult),
    close: vi.fn(async () => ({ ok: true })),
    create: vi.fn(),
    repairOrphans: vi.fn(async () => ({ ok: true }))
  }
  return new Proxy({
    loadWorkspaces: vi.fn(async () => ({
      workspaces: [{ id: 'w1', name: 'Repo', dir: 'C:\repo', agentCounts: { claude: 0, codex: 0 }, isolated: true }],
      activeWorkspaceId: 'w1'
    })),
    getDesktopPath: vi.fn(async () => ''),
    getSettings: vi.fn(async () => ({
      version: 1,
      appearance: { theme: 'sarvis-dark', defaultPaneFontSize: 13 },
      notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
      updates: { autoUpdate: true },
      agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true }
    })),
    saveWorkspaces: vi.fn(async () => {}),
    onCloseRequested: vi.fn(() => vi.fn()),
    onUpdateReady: vi.fn(() => vi.fn()),
    closePrompted: vi.fn(), confirmClose: vi.fn(), windowClose: vi.fn(),
    worktree
  }, {
    // Anything else the shell asks for is a harmless stub.
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? vi.fn(() => vi.fn()) : vi.fn(async () => null)))
  })
}

describe('App / leftover folders dialog', () => {
  it('shows the folders a deleted workspace could not clean up, even when it was the last workspace', async () => {
    const left = [{ agentId: 'a1', path: 'C:\wt\a1', detail: 'locked' }]
    window.electronAPI = api({ ok: true, failures: left })
    // closeAll only runs for a workspace with live agents' ids; an empty one still calls it.
    render(<App />)
    await userEvent.click(await screen.findByTitle('Delete workspace'))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    // Last workspace gone: only Onboarding renders, and the dialog must still appear.
    expect(await screen.findByText('C:\wt\a1', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'CodeSpace' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText('C:\wt\a1')).toBeNull())
  })

  it('treats a thrown cleanup ({ error }) as a failure too', async () => {
    window.electronAPI = api({ error: 'unknown' })
    render(<App />)
    await userEvent.click(await screen.findByTitle('Delete workspace'))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/Unknown folder \(unknown\)/, {}, { timeout: 3000 })).toBeTruthy()
  })
})
