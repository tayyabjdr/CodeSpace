import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// TerminalPane pulls in xterm and the pty pool; stub the hook so the test
// exercises only the breadcrumb markup.
vi.mock('../../src/renderer/hooks/useTerminal.js', () => ({
  default: () => ({ error: null, exitCode: null })
}))

import TerminalPane from '../../src/renderer/components/TerminalPane.jsx'

const props = {
  id: 't1', ptyId: 'p1', shell: 'claude',
  cwd: 'D:\\PC Backup\\ControlDeck\\CodeSpace',
  workspaceDir: 'D:\\PC Backup\\ControlDeck\\CodeSpace',
  agentNum: 1, name: '', autoName: 'alpha', branch: null, fontSize: 13,
  onClose: () => {}, onFocus: () => {}, onRename: () => {}, onPtyReady: () => {},
  onFontSizeChange: () => {}, onAddAgent: () => {}, onSwap: () => {}, onOpenFile: () => {},
  isFocused: false, isFullscreen: false, isHiddenForFullscreen: false,
  onToggleFullscreen: () => {}, themeId: 'sarvis-dark'
}

beforeEach(() => {
  window.electronAPI = { writeClipboardText: vi.fn() }
})

describe('TerminalPane breadcrumb', () => {
  it('always renders, showing agent type and shortened cwd', () => {
    const { container } = render(<TerminalPane {...props} />)
    const crumb = container.querySelector('.pane-subheader')
    expect(crumb).toBeTruthy()
    expect(crumb.textContent).toContain('claude')
    expect(crumb.textContent).toContain('D:\\…\\ControlDeck\\CodeSpace')
  })

  it('exposes the full cwd as a title', () => {
    const { container } = render(<TerminalPane {...props} />)
    expect(container.querySelector('.tp-crumb-cwd').getAttribute('title'))
      .toBe('D:\\PC Backup\\ControlDeck\\CodeSpace')
  })

  it('omits the branch for a non-isolated agent', () => {
    const { container } = render(<TerminalPane {...props} />)
    expect(container.querySelector('.tp-branch')).toBeNull()
  })

  it('folds the branch into the same row for an isolated agent', () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    const crumb = container.querySelector('.pane-subheader')
    expect(crumb.querySelector('.tp-branch')).toBeTruthy()
    expect(crumb.textContent).toContain('cs/a1f2')
  })

  it('still copies the branch on click', async () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    container.querySelector('.tp-branch').click()
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('cs/a1f2')
  })
})
