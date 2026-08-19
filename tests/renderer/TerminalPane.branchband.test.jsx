import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// TerminalPane pulls in xterm and the pty pool; stub the hook so the test
// exercises only the sub-header markup.
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

describe('TerminalPane branch band', () => {
  it('renders no sub-header band for a non-isolated agent', () => {
    // The band used to be unconditional and carried agent type and cwd. Both
    // repeated what the pane name and the chosen workspace already said, so a
    // plain pane now goes straight from header to terminal.
    const { container } = render(<TerminalPane {...props} />)
    expect(container.querySelector('.pane-subheader')).toBeNull()
  })

  it('does not render the working directory anywhere in the pane chrome', () => {
    const { container } = render(<TerminalPane {...props} />)
    expect(container.textContent).not.toContain('CodeSpace')
    expect(container.querySelector('[title="D:\\\\PC Backup\\\\ControlDeck\\\\CodeSpace"]')).toBeNull()
  })

  it('renders the band with the branch for an isolated agent', () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    const band = container.querySelector('.pane-subheader')
    expect(band).toBeTruthy()
    expect(band.textContent).toContain('cs/a1f2')
  })

  it('carries only the branch in the band, not the agent type or path', () => {
    // Guards the reason the band survives at all: a worktree branch is the one
    // thing here the user cannot read off the pane name or the sidebar.
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    const band = container.querySelector('.pane-subheader')
    expect(band.textContent.trim()).toBe('cs/a1f2')
  })

  it('still copies the branch on click', () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    container.querySelector('.tp-branch').click()
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('cs/a1f2')
  })

  it('keeps the branch button titled for its copy affordance', () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    expect(container.querySelector('.tp-branch').getAttribute('title'))
      .toBe('cs/a1f2 — click to copy')
  })
})
