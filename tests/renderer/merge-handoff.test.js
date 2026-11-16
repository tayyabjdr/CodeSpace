import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/renderer/pty-pool.js', () => ({ writePty: vi.fn(), attach: vi.fn(() => () => {}) }))

import * as ptyPool from '../../src/renderer/pty-pool.js'
import { handoffText, deliverHandoff, handoffForStatus } from '../../src/renderer/merge-handoff.js'

const NOW = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  ptyPool.writePty.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('handoffText', () => {
  it('matches the plan wording exactly', () => {
    expect(handoffText({ target: 'master', kind: 'tests failed', logPath: 'L' })).toBe(
      'CodeSpace could not merge this branch into master: tests failed. Details are in L. Please fix it and commit. For a conflict, finish with git rebase --continue.')
  })

  it('drops the details sentence when there is no log', () => {
    expect(handoffText({ target: 'main', kind: 'rebase conflict' })).toBe(
      'CodeSpace could not merge this branch into main: rebase conflict. Please fix it and commit. For a conflict, finish with git rebase --continue.')
  })
})

describe('deliverHandoff', () => {
  it.each(['claude', 'codex'])('writes the text, then \\r 150ms later, for %s panes', (shell) => {
    const ok = deliverHandoff({ ptyId: 'p1', shell, text: 'hello', lastOutputAt: NOW - 5000, now: NOW })
    expect(ok).toBe(true)
    expect(ptyPool.writePty).toHaveBeenCalledTimes(1)
    expect(ptyPool.writePty).toHaveBeenLastCalledWith('p1', 'hello')
    vi.advanceTimersByTime(149)
    expect(ptyPool.writePty).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(ptyPool.writePty).toHaveBeenCalledTimes(2)
    expect(ptyPool.writePty).toHaveBeenLastCalledWith('p1', '\r')
  })

  it('does not write to shell panes', () => {
    for (const shell of ['shell', 'powershell', 'cmd', undefined]) {
      expect(deliverHandoff({ ptyId: 'p1', shell, text: 'x', lastOutputAt: NOW - 60000, now: NOW })).toBe(false)
    }
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
  })

  it('does not write when the pane produced output in the last 4000ms; returns false', () => {
    expect(deliverHandoff({ ptyId: 'p1', shell: 'claude', text: 'x', lastOutputAt: NOW - 3999, now: NOW })).toBe(false)
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
  })

  it('does not write when the pane was never tracked', () => {
    expect(deliverHandoff({ ptyId: 'p1', shell: 'claude', text: 'x', lastOutputAt: null, now: NOW })).toBe(false)
    expect(ptyPool.writePty).not.toHaveBeenCalled()
  })
})

describe('handoffForStatus', () => {
  const resolveAgent = (id) => (id === 'a1' ? { ptyId: 'p1', shell: 'claude' } : null)
  const lastOutputAt = () => NOW - 10000

  it('writes for tests-failed and conflict', () => {
    expect(handoffForStatus({ agentId: 'a1', state: 'tests-failed', target: 'master', logPath: 'L' },
      { resolveAgent, lastOutputAt, now: NOW })).toBe(true)
    expect(ptyPool.writePty.mock.calls[0][1]).toContain('tests failed')
    expect(handoffForStatus({ agentId: 'a1', state: 'conflict', target: 'master', logPath: 'L' },
      { resolveAgent, lastOutputAt, now: NOW })).toBe(true)
    expect(ptyPool.writePty.mock.calls.at(-1)[1]).toContain('rebase conflict')
  })

  it('stays silent for other states and unknown agents', () => {
    for (const state of ['queued', 'testing', 'merged', 'merged-untested', 'blocked', 'idle']) {
      expect(handoffForStatus({ agentId: 'a1', state, target: 'master' },
        { resolveAgent, lastOutputAt, now: NOW })).toBe(false)
    }
    expect(handoffForStatus({ agentId: 'gone', state: 'tests-failed', target: 'master' },
      { resolveAgent, lastOutputAt, now: NOW })).toBe(false)
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
  })
})
