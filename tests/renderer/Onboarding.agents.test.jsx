import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Onboarding from '../../src/renderer/components/Onboarding.jsx'
import RecentDirectories from '../../src/renderer/components/RecentDirectories.jsx'
import { parentLabel, basename } from '../../src/renderer/path-display.js'

let canIsolate

beforeEach(() => {
  canIsolate = vi.fn().mockResolvedValue({ ok: true, reason: null })
  window.electronAPI = {
    worktree: { canIsolate },
    getDesktopPath: vi.fn().mockResolvedValue('D:/desk'),
    recents: { get: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue([]), remove: vi.fn() },
    agents: { getAvailability: vi.fn().mockResolvedValue({ claude: true, codex: true }) },
    selectDirectory: vi.fn()
  }
})
afterEach(() => { cleanup(); delete window.electronAPI })

const count = shell => screen.getByTestId(`count-${shell}`).textContent
const launchButton = () => screen.getByRole('button', { name: /^Launch/ })

describe('Onboarding agent steppers', () => {
  it('starts at 2 Claude, 0 Codex', async () => {
    render(<Onboarding onLaunch={vi.fn()} initialDir="D:/repo" />)
    await waitFor(() => expect(count('claude')).toBe('2'))
    expect(count('codex')).toBe('0')
    expect(launchButton().textContent).toMatch('Launch 2 agents')
  })

  it('+ Codex adds a pane instead of taking one from Claude', async () => {
    render(<Onboarding onLaunch={vi.fn()} initialDir="D:/repo" />)
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    expect(count('claude')).toBe('2')
    expect(count('codex')).toBe('1')
    expect(screen.getByRole('radio', { name: '3 agents' }).getAttribute('aria-checked')).toBe('true')
    expect(launchButton().textContent).toMatch('Launch 3 agents')
  })

  it('− Claude removes a pane and never goes below one agent', async () => {
    render(<Onboarding onLaunch={vi.fn()} initialDir="D:/repo" />)
    await userEvent.click(screen.getByRole('button', { name: 'One fewer Claude' }))
    expect(count('claude')).toBe('1')
    expect(screen.getByRole('button', { name: 'One fewer Claude' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'One fewer Codex' }).disabled).toBe(true)
  })

  it('caps the total at 8', async () => {
    render(<Onboarding onLaunch={vi.fn()} initialDir="D:/repo" />)
    await userEvent.click(screen.getByRole('radio', { name: '8 agents' }))
    expect(screen.getByRole('button', { name: 'One more Claude' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'One more Codex' }).disabled).toBe(true)
  })

  it('a smaller layout keeps the Codex count when it still fits', async () => {
    render(<Onboarding onLaunch={vi.fn()} initialDir="D:/repo" />)
    await userEvent.click(screen.getByRole('radio', { name: '6 agents' }))
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    expect(count('claude')).toBe('6')
    expect(count('codex')).toBe('2')
    await userEvent.click(screen.getByRole('radio', { name: '3 agents' }))
    expect(count('claude')).toBe('1')
    expect(count('codex')).toBe('2')
  })

  it('launches with the chosen mix', async () => {
    const onLaunch = vi.fn()
    render(<Onboarding onLaunch={onLaunch} initialDir="D:/repo" />)
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    await userEvent.click(launchButton())
    await waitFor(() => expect(onLaunch).toHaveBeenCalled(), { timeout: 2000 })
    expect(onLaunch.mock.calls[0][0]).toEqual({ claude: 2, codex: 1 })
    expect(onLaunch.mock.calls[0][1]).toBe('D:/repo')
    expect(onLaunch.mock.calls[0][2]).toBe('repo')
  })

  it('with only Codex installed, every pane is Codex whatever the layout', async () => {
    window.electronAPI.agents.getAvailability.mockResolvedValue({ claude: false, codex: true })
    const onLaunch = vi.fn()
    render(<Onboarding onLaunch={onLaunch} initialDir="D:/repo" />)
    await screen.findByText(/was found on this machine/)
    await userEvent.click(screen.getByRole('radio', { name: '4 agents' }))
    await userEvent.click(launchButton())
    await waitFor(() => expect(onLaunch).toHaveBeenCalled(), { timeout: 2000 })
    expect(onLaunch.mock.calls[0][0]).toEqual({ claude: 0, codex: 4 })
  })

  it('Enter in the name field launches', async () => {
    const onLaunch = vi.fn()
    render(<Onboarding onLaunch={onLaunch} initialDir="D:/repo" />)
    const input = screen.getByLabelText('Workspace name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Mine{Enter}')
    await waitFor(() => expect(onLaunch).toHaveBeenCalled(), { timeout: 2000 })
    expect(onLaunch.mock.calls[0][2]).toBe('Mine')
  })

  it('double-clicking a recent folder launches it, re-checking git for that folder', async () => {
    window.electronAPI.recents.get.mockResolvedValue(['D:/other'])
    canIsolate.mockImplementation(dir => Promise.resolve(dir === 'D:/other' ? { ok: false, reason: 'not-a-repo' } : { ok: true }))
    const onLaunch = vi.fn()
    render(<Onboarding onLaunch={onLaunch} initialDir="D:/repo" />)
    const row = await screen.findByTitle('D:/other')
    fireEvent.doubleClick(row)
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [, dir, name, isolated] = onLaunch.mock.calls[0]
    expect(dir).toBe('D:/other')
    expect(name).toBe('other')
    expect(isolated).toBe(false)
  })
})

describe('RecentDirectories', () => {
  it('shows the parent folder, not the folder repeated', () => {
    render(
      <RecentDirectories
        recents={['D:\\PC Backup\\ControlDeck\\Hub']}
        currentDir=""
        onPick={() => {}}
        onRemove={() => {}}
      />
    )
    expect(screen.getByText('Hub')).toBeTruthy()
    expect(screen.getByText('D:\\PC Backup\\ControlDeck')).toBeTruthy()
  })
})

describe('path-display', () => {
  it('basename handles both separators and trailing slashes', () => {
    expect(basename('D:\\a\\b\\')).toBe('b')
    expect(basename('C:/x/y')).toBe('y')
  })

  it('parentLabel keeps short parents whole', () => {
    expect(parentLabel('C:\\Users\\TJ\\Desktop')).toBe('C:\\Users\\TJ')
  })

  it('parentLabel shortens from the middle, keeping the drive and nearest folders', () => {
    const p = 'C:\\Users\\TJ\\Downloads\\Clients\\Some Long Client Name\\site'
    const label = parentLabel(p, 30)
    expect(label.startsWith('C:\\…\\')).toBe(true)
    expect(label.endsWith('Some Long Client Name')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(30)
  })

  it('parentLabel is empty for a drive root', () => {
    expect(parentLabel('D:\\')).toBe('')
  })
})
