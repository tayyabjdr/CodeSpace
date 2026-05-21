import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetSettings = vi.fn(() => Promise.resolve({}))
let mockState

vi.mock('../../src/renderer/settings-store.js', () => ({
  getSettings: () => mockState,
  setSettings: (patch) => mockSetSettings(patch),
  subscribe: () => () => {},
}))

import SettingsPage from '../../src/renderer/components/SettingsPage.jsx'

beforeEach(() => {
  mockState = {
    appearance: { defaultPaneFontSize: 13 },
    notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
    updates: { autoUpdate: true },
    agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true },
  }
  mockSetSettings.mockClear()
  window.electronAPI = {
    getAppVersion: () => Promise.resolve('1.3.1'),
    checkForUpdates: () => Promise.resolve({ status: 'up-to-date' }),
    openExternal: vi.fn(),
  }
})

describe('SettingsPage', () => {
  it('renders the Appearance category by default', () => {
    render(<SettingsPage onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByLabelText('Default pane font size')).toBeTruthy()
  })

  it('switches category when a nav item is clicked', async () => {
    render(<SettingsPage onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /agents/i }))
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByLabelText('Skip permission prompts')).toBeTruthy()
  })

  it('calls setSettings when a toggle is changed', async () => {
    render(<SettingsPage onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await userEvent.click(screen.getByLabelText('Flash taskbar on done'))
    expect(mockSetSettings).toHaveBeenCalledWith({ notifications: { taskbarFlashOnDone: false } })
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close settings/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
