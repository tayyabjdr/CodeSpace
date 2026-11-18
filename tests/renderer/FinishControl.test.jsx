import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'

// Capture each PTY's data listener so a test can make the pane "print".
const dataListeners = new Map()
vi.mock('../../src/renderer/pty-pool.js', () => ({
  writePty: vi.fn(),
  onWrite: vi.fn(() => () => {}),
  attach: vi.fn((ptyId, { onData }) => {
    if (onData) {
      onData('old ring buffer') // replay must not count as fresh output
      dataListeners.set(ptyId, onData)
    }
    return () => dataListeners.delete(ptyId)
  })
}))

import * as ptyPool from '../../src/renderer/pty-pool.js'
import * as activity from '../../src/renderer/pty-activity.js'
import * as mergeStatus from '../../src/renderer/merge-status.js'
import { startHandoffs } from '../../src/renderer/merge-handoff.js'
import FinishControl from '../../src/renderer/components/FinishControl.jsx'

let info
let merge

const props = { agentId: 'a1', ptyId: 'p1', repoDir: 'D:\\PC Backup\\repo', agentName: 'Agent 01' }

function emit(payload) {
  act(() => { mergeStatus.handleStatus({ agentId: 'a1', target: 'master', ...payload }) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function renderQuiet(p = props) {
  const utils = render(<FinishControl {...p} />)
  await flush()
  act(() => { vi.advanceTimersByTime(4000) })
  await flush()
  return utils
}

const finishBtn = (c) => c.querySelector('.fc-finish')

beforeEach(() => {
  vi.useFakeTimers()
  activity._resetForTests()
  mergeStatus._resetForTests()
  dataListeners.clear()
  ptyPool.writePty.mockClear()
  info = { ahead: 3, files: 5, dirty: false, target: 'master' }
  merge = {
    finish: vi.fn(async () => ({ accepted: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    info: vi.fn(async () => info),
    onStatus: vi.fn(() => () => {})
  }
  window.electronAPI = { merge, writeClipboardText: vi.fn() }
})
afterEach(() => { vi.useRealTimers() })

describe('FinishControl', () => {
  it('shows "3 commits, 5 files"', async () => {
    const { container } = await renderQuiet()
    expect(container.textContent).toContain('3 commits, 5 files')
  })

  it('uses singular counts', async () => {
    info = { ahead: 1, files: 1, dirty: false, target: 'master' }
    const { container } = await renderQuiet()
    expect(container.textContent).toContain('1 commit, 1 file')
  })

  it('tooltip names the target branch', async () => {
    const { container } = await renderQuiet()
    expect(finishBtn(container).getAttribute('title')).toBe('Test and merge into master')
  })

  it('Finish is disabled while the pane is busy, when nothing is ahead, and while queued or testing', async () => {
    const { container, unmount } = render(<FinishControl {...props} />)
    await flush()
    // Fresh pane: not yet quiet.
    expect(finishBtn(container).disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(4000) })
    await flush()
    expect(finishBtn(container).disabled).toBe(false)

    // Output makes it busy again, for another 4000ms.
    act(() => { dataListeners.get('p1')('working...') })
    expect(finishBtn(container).disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(3999) })
    expect(finishBtn(container).disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    await flush()
    expect(finishBtn(container).disabled).toBe(false)

    emit({ state: 'queued' })
    await flush()
    expect(finishBtn(container).disabled).toBe(true)
    emit({ state: 'testing' })
    await flush()
    expect(finishBtn(container).disabled).toBe(true)
    emit({ state: 'tests-failed', logPath: 'L' })
    await flush()
    expect(finishBtn(container).disabled).toBe(false)
    unmount()

    // Nothing ahead and a clean tree: nothing to merge.
    activity._resetForTests()
    info = { ahead: 0, files: 0, dirty: false, target: 'master' }
    const second = await renderQuiet()
    expect(finishBtn(second.container).disabled).toBe(true)
    second.unmount()

    // Nothing committed yet but uncommitted edits: Finish commits them.
    activity._resetForTests()
    info = { ahead: 0, files: 2, dirty: true, target: 'master' }
    const third = await renderQuiet()
    expect(finishBtn(third.container).disabled).toBe(false)
  })

  it('clicking Finish passes repoDir, agentId and the display name', async () => {
    const { container } = await renderQuiet()
    fireEvent.click(finishBtn(container))
    await flush()
    expect(merge.finish).toHaveBeenCalledTimes(1)
    expect(merge.finish).toHaveBeenCalledWith({ repoDir: props.repoDir, agentId: 'a1', agentName: 'Agent 01' })
  })

  it('a click still lands when pressing Finish makes the pane print', async () => {
    const { container } = await renderQuiet()
    const btn = finishBtn(container)
    const down = fireEvent.mouseDown(btn)
    expect(down).toBe(false) // default prevented: terminal keeps focus
    act(() => { dataListeners.get('p1')('focus redraw') })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await flush()
    expect(merge.finish).toHaveBeenCalledTimes(1)
  })

  it('stays ready through the redraw after the pane gains or loses focus', async () => {
    const { container } = await renderQuiet()
    const btn = finishBtn(container)
    act(() => { activity.noteWrite('p1', '\x1b[O') })
    act(() => { dataListeners.get('p1')('redraw') })
    expect(btn.disabled).toBe(false)
    act(() => { vi.advanceTimersByTime(300) })
    act(() => { activity.noteWrite('p1', '\x1b[I') })
    act(() => { dataListeners.get('p1')('redraw') })
    expect(btn.disabled).toBe(false)
    // A focus report is not the user typing.
    expect(activity.lastInputAt('p1')).toBeNull()

    // Past the grace, output is real work again.
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { dataListeners.get('p1')('working...') })
    expect(btn.disabled).toBe(true)
  })

  it('real typing still counts as input and output after it still busies the pane', async () => {
    const { container } = await renderQuiet()
    act(() => { activity.noteWrite('p1', 'hello') })
    expect(activity.lastInputAt('p1')).not.toBeNull()
    act(() => { dataListeners.get('p1')('echo') })
    expect(finishBtn(container).disabled).toBe(true)
  })

  it('a press while busy does not arm Finish, and leaving the button disarms it', async () => {
    const { container } = await renderQuiet()
    const btn = finishBtn(container)
    act(() => { dataListeners.get('p1')('working...') })
    fireEvent.mouseDown(btn)
    expect(btn.disabled).toBe(true)

    act(() => { vi.advanceTimersByTime(4000) })
    await flush()
    fireEvent.mouseDown(btn)
    act(() => { dataListeners.get('p1')('more') })
    fireEvent.mouseLeave(btn)
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    await flush()
    expect(merge.finish).not.toHaveBeenCalled()
  })

  it('calls merge.info when the pane goes quiet and after each status change, without polling', async () => {
    render(<FinishControl {...props} />)
    await flush()
    const afterMount = merge.info.mock.calls.length
    act(() => { vi.advanceTimersByTime(4000) })
    await flush()
    expect(merge.info.mock.calls.length).toBe(afterMount + 1)
    expect(merge.info).toHaveBeenLastCalledWith({ repoDir: props.repoDir, agentId: 'a1' })

    // A long idle stretch makes no further calls.
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(merge.info.mock.calls.length).toBe(afterMount + 1)

    emit({ state: 'merged' })
    await flush()
    expect(merge.info.mock.calls.length).toBe(afterMount + 2)
  })

  it('renders each state label', async () => {
    const { container } = await renderQuiet()
    const label = () => container.querySelector('.fc-status')?.textContent
    const cases = [
      [{ state: 'queued' }, 'Queued'],
      [{ state: 'testing' }, 'Testing'],
      [{ state: 'merged' }, 'Merged into master'],
      [{ state: 'merged-untested' }, 'Merged, untested'],
      [{ state: 'tests-failed', logPath: 'L' }, 'Tests failed'],
      [{ state: 'conflict', logPath: 'L' }, 'Conflict'],
      [{ state: 'blocked', detail: 'nothing to merge' }, 'Blocked: nothing to merge']
    ]
    for (const [payload, text] of cases) {
      emit(payload)
      await flush()
      expect(label()).toBe(text)
    }
    emit({ state: 'idle' })
    await flush()
    expect(container.querySelector('.fc-status')).toBeNull()
  })

  it('colours only success and failure moments', async () => {
    const { container } = await renderQuiet()
    const tone = () => container.querySelector('.fc-status').dataset.tone
    emit({ state: 'queued' }); await flush(); expect(tone()).toBe('plain')
    emit({ state: 'testing' }); await flush(); expect(tone()).toBe('plain')
    emit({ state: 'merged' }); await flush(); expect(tone()).toBe('success')
    emit({ state: 'tests-failed' }); await flush(); expect(tone()).toBe('failure')
    emit({ state: 'conflict' }); await flush(); expect(tone()).toBe('failure')
    emit({ state: 'blocked', detail: 'x' }); await flush(); expect(tone()).toBe('failure')
  })

  it('a failed status exposes its detail as a tooltip and copies nothing on click', async () => {
    const { container } = await renderQuiet()
    emit({ state: 'tests-failed', detail: 'Timed out after 10 minutes', logPath: 'L' })
    await flush()
    const status = container.querySelector('.fc-status')
    expect(status.getAttribute('title')).toContain('Timed out after 10 minutes')
    expect(status.getAttribute('title')).toContain('L')
    fireEvent.click(status)
    expect(window.electronAPI.writeClipboardText).not.toHaveBeenCalled()
  })

  it('asks for an install in the main folder when the lockfile changed', async () => {
    const { container } = await renderQuiet()
    emit({ state: 'merged', lockfileChanged: true })
    await flush()
    expect(container.textContent).toContain('Run an install in the main folder.')
    emit({ state: 'merged' })
    await flush()
    expect(container.textContent).not.toContain('Run an install')
  })

  it('uses no em-dashes in its copy', async () => {
    const { container } = await renderQuiet()
    emit({ state: 'merged', lockfileChanged: true })
    await flush()
    expect(container.innerHTML).not.toContain('\u2014')
  })

  it('renders nothing without a merge API', () => {
    window.electronAPI = {}
    const { container } = render(<FinishControl {...props} />)
    expect(container.innerHTML).toBe('')
  })

  it('fires a handoff once per failure, not on re-render', async () => {
    const stop = startHandoffs({
      onMergeEvent: mergeStatus.onMergeEvent,
      resolveAgent: (id) => (id === 'a1' ? { ptyId: 'p1', shell: 'claude' } : null),
      lastOutputAt: activity.lastOutputAt,
      lastInputAt: activity.lastInputAt
    })
    const { container, rerender } = await renderQuiet()
    const texts = () => ptyPool.writePty.mock.calls.filter(c => c[1] !== '\r')

    emit({ state: 'queued' })
    emit({ state: 'testing' })
    act(() => { vi.advanceTimersByTime(30000) })
    emit({ state: 'tests-failed', logPath: 'L' })
    await flush()
    for (let i = 0; i < 5; i++) {
      rerender(<FinishControl {...props} agentName={`Agent ${i}`} />)
      await flush()
    }
    act(() => { vi.advanceTimersByTime(200) })
    expect(texts()).toHaveLength(1)
    expect(texts()[0][1]).toContain('into master: tests failed. Details are in L.')
    expect(container.querySelector('.fc-status').textContent).toBe('Tests failed')

    // A second Finish that fails is a new handoff.
    emit({ state: 'queued' })
    act(() => { vi.advanceTimersByTime(1000) })
    emit({ state: 'conflict', logPath: 'L' })
    await flush()
    expect(texts()).toHaveLength(2)
    stop()
  })

  it('writes nothing when the user typed into the quiet pane after Finish', async () => {
    const stop = startHandoffs({
      onMergeEvent: mergeStatus.onMergeEvent,
      resolveAgent: () => ({ ptyId: 'p1', shell: 'claude' }),
      lastOutputAt: activity.lastOutputAt,
      lastInputAt: activity.lastInputAt
    })
    const { container } = await renderQuiet()
    emit({ state: 'queued' })
    act(() => { vi.advanceTimersByTime(10) })
    activity.noteInput('p1')
    act(() => { vi.advanceTimersByTime(60000) })
    emit({ state: 'tests-failed', logPath: 'L' })
    await flush()
    act(() => { vi.advanceTimersByTime(200) })
    expect(ptyPool.writePty).not.toHaveBeenCalled()
    expect(container.querySelector('.fc-status').textContent).toBe('Tests failed')
    stop()
  })

  it('shows the status but writes nothing when the pane is busy', async () => {
    const stop = startHandoffs({
      onMergeEvent: mergeStatus.onMergeEvent,
      resolveAgent: () => ({ ptyId: 'p1', shell: 'claude' }),
      lastOutputAt: activity.lastOutputAt,
      lastInputAt: activity.lastInputAt
    })
    const { container } = await renderQuiet()
    emit({ state: 'queued' })
    act(() => { dataListeners.get('p1')('user typing') })
    emit({ state: 'tests-failed', logPath: 'L' })
    await flush()
    act(() => { vi.advanceTimersByTime(200) })
    expect(ptyPool.writePty).not.toHaveBeenCalled()
    expect(container.querySelector('.fc-status').textContent).toBe('Tests failed')
    stop()
  })
})
