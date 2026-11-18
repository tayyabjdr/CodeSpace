import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LeftoverWorkNotice from '../../src/renderer/components/LeftoverWorkNotice.jsx'

const kept = [
  { agentId: 'a1', branch: 'cs/app/aaaa1111', path: 'D:\\wt\\a1', reason: 'uncommitted' },
  { agentId: 'a2', branch: 'cs/app/bbbb2222', path: 'D:\\wt\\a2', reason: 'cleanup-failed', detail: 'EBUSY' }
]
const stranded = [
  { branch: 'cs/app/cccc3333', ahead: 3 },
  { branch: 'cs/app/dddd4444', ahead: 1 }
]

beforeEach(() => {
  window.electronAPI = { writeClipboardText: vi.fn() }
})

describe('LeftoverWorkNotice', () => {
  it('renders nothing when both lists are empty', () => {
    const { container } = render(<LeftoverWorkNotice kept={[]} stranded={[]} onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the lists are missing', () => {
    const { container } = render(<LeftoverWorkNotice onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('has the title', () => {
    render(<LeftoverWorkNotice kept={kept} stranded={[]} onDismiss={() => {}} />)
    expect(screen.getByText('Work left from an earlier session')).toBeTruthy()
  })

  it('lists each kept worktree with its path and branch', () => {
    const { container } = render(<LeftoverWorkNotice kept={kept} stranded={[]} onDismiss={() => {}} />)
    for (const k of kept) {
      expect(container.textContent).toContain(k.branch)
      expect(container.textContent).toContain(k.path)
    }
    expect(container.textContent).toContain('Uncommitted changes')
    expect(container.textContent).toContain("Couldn't be removed")
  })

  it('lists each stranded branch with its commit count', () => {
    const { container } = render(<LeftoverWorkNotice kept={[]} stranded={stranded} onDismiss={() => {}} />)
    expect(container.textContent).toContain('cs/app/cccc3333')
    expect(container.textContent).toContain('3 commits not merged')
    expect(container.textContent).toContain('cs/app/dddd4444')
    expect(container.textContent).toContain('1 commit not merged')
  })

  it('copy action copies the branch name', () => {
    render(<LeftoverWorkNotice kept={kept} stranded={stranded} onDismiss={() => {}} />)
    fireEvent.click(screen.getByTitle('Copy cs/app/cccc3333'))
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('cs/app/cccc3333')
    fireEvent.click(screen.getByTitle('Copy cs/app/aaaa1111'))
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('cs/app/aaaa1111')
  })

  it('dismiss calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(<LeftoverWorkNotice kept={kept} stranded={stranded} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('uses no em-dashes in its copy', () => {
    const { container } = render(<LeftoverWorkNotice kept={kept} stranded={stranded} onDismiss={() => {}} />)
    expect(container.textContent).not.toContain('\u2014')
  })

  it('offers Open folder on kept rows only, and Discard on every row', () => {
    const onOpenFolder = vi.fn()
    const onDiscard = vi.fn()
    render(<LeftoverWorkNotice kept={kept} stranded={stranded} onDismiss={() => {}} onOpenFolder={onOpenFolder} onDiscard={onDiscard} />)
    const opens = screen.getAllByText('Open folder')
    expect(opens).toHaveLength(2)
    expect(screen.getAllByText('Discard')).toHaveLength(4)
    fireEvent.click(opens[0])
    expect(onOpenFolder).toHaveBeenCalledWith(kept[0])
    fireEvent.click(screen.getAllByText('Discard')[2])
    expect(onDiscard).toHaveBeenCalledWith(stranded[0])
  })

  it('says when a discard failed', () => {
    render(<LeftoverWorkNotice kept={[{ ...kept[0], discardFailed: true }]} stranded={[{ ...stranded[0], discardFailed: true }]} onDismiss={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/Couldn't discard. Close anything using it/)).toBeTruthy()
    expect(screen.getByText("Couldn't discard this branch")).toBeTruthy()
  })
})
