import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Onboarding from '../../src/renderer/components/Onboarding.jsx'

const OK = { ok: true, reason: null }
let canIsolate

function setup(dir = 'D:/repo') {
  const onLaunch = vi.fn()
  const utils = render(<Onboarding onLaunch={onLaunch} initialDir={dir} />)
  return { onLaunch, ...utils }
}

const toggle = () => screen.getByRole('checkbox')

async function launch() {
  await userEvent.click(screen.getByRole('button', { name: 'Initialize' }))
  await waitFor(() => {}, { timeout: 50 })
}

beforeEach(() => {
  canIsolate = vi.fn().mockResolvedValue(OK)
  window.electronAPI = {
    worktree: { canIsolate },
    getDesktopPath: vi.fn().mockResolvedValue('D:/desk'),
    recents: { get: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue([]), remove: vi.fn() },
    agents: { getAvailability: vi.fn().mockResolvedValue({ claude: true, codex: true }) },
    selectDirectory: vi.fn()
  }
})
afterEach(() => { delete window.electronAPI })

describe('Onboarding isolation default', () => {
  it('turns on for an eligible repo', async () => {
    const { onLaunch } = setup()
    await waitFor(() => expect(toggle().checked).toBe(true))
    await launch()
    await waitFor(() => expect(onLaunch).toHaveBeenCalled(), { timeout: 2000 })
    expect(onLaunch.mock.calls[0][3]).toBe(true)
  })

  it('stays off and allows launch for a non-repo', async () => {
    canIsolate.mockResolvedValue({ ok: false, reason: 'not-a-repo' })
    const { onLaunch } = setup()
    await screen.findByText("This folder isn't a git repo, so agents will share it.")
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Initialize' }).disabled).toBe(false)
    await launch()
    await waitFor(() => expect(onLaunch).toHaveBeenCalled(), { timeout: 2000 })
    expect(onLaunch.mock.calls[0][3]).toBe(false)
  })

  it('stays off for a repo with no commits', async () => {
    canIsolate.mockResolvedValue({ ok: false, reason: 'no-commits' })
    setup()
    const note = await screen.findByText(/Make a first commit to separate them/)
    expect(note.textContent).toMatch(/no commits yet/)
    expect(toggle().checked).toBe(false)
  })

  it('explains when git is missing', async () => {
    canIsolate.mockResolvedValue({ ok: false, reason: 'git-missing' })
    setup()
    await screen.findByText("Git wasn't found, so agents will share this folder.")
  })

  it('shows no note while the check is pending, and launch stays usable', async () => {
    canIsolate.mockReturnValue(new Promise(() => {}))
    setup()
    expect(screen.getByRole('button', { name: 'Initialize' }).disabled).toBe(false)
    expect(document.querySelector('.ob-isolation-note')).toBeNull()
    expect(toggle().checked).toBe(false)
  })

  it("keeps the user's choice when they turned it off, across folder changes", async () => {
    window.electronAPI.recents.get.mockResolvedValue(['D:/other'])
    setup()
    await waitFor(() => expect(toggle().checked).toBe(true))
    await userEvent.click(screen.getByText('Isolated agents'))
    expect(toggle().checked).toBe(false)
    await userEvent.click(await screen.findByTitle('D:/other'))
    await waitFor(() => expect(canIsolate).toHaveBeenCalledWith('D:/other'))
    await act(async () => {})
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(false)
  })
})
