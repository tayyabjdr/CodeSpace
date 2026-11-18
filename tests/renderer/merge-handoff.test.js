import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/renderer/pty-pool.js', () => ({ writePty: vi.fn(), attach: vi.fn(() => () => {}) }))

import * as ptyPool from '../../src/renderer/pty-pool.js'
import { handoffText, deliverHandoff, handoffForStatus, startHandoffs } from '../../src/renderer/merge-handoff.js'

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
  const armedAt = NOW - 9000

  it('writes for tests-failed and conflict', () => {
    expect(handoffForStatus({ agentId: 'a1', state: 'tests-failed', target: 'master', logPath: 'L' },
      { resolveAgent, lastOutputAt, armedAt, now: NOW })).toBe(true)
    expect(ptyPool.writePty.mock.calls[0][1]).toContain('tests failed')
    expect(handoffForStatus({ agentId: 'a1', state: 'conflict', target: 'master', logPath: 'L' },
      { resolveAgent, lastOutputAt, armedAt, now: NOW })).toBe(true)
    expect(ptyPool.writePty.mock.calls.at(-1)[1]).toContain('rebase conflict')
  })

  it('stays silent for other states and unknown agents', () => {
    for (const state of ['queued', 'testing', 'merged', 'merged-untested', 'blocked', 'idle']) {
      expect(handoffForStatus({ agentId: 'a1', state, target: 'master' },
        { resolveAgent, lastOutputAt, armedAt, now: NOW })).toBe(false)
    }
    expect(handoffForStatus({ agentId: 'gone', state: 'tests-failed', target: 'master' },
      { resolveAgent, lastOutputAt, armedAt, now: NOW })).toBe(false)
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
  })
})

describe('startHandoffs: never type into a pane the user touched', () => {
  // A tiny event bus standing in for merge-status's onMergeEvent.
  function setup({ shell = 'claude' } = {}) {
    const subs = new Set()
    const onMergeEvent = (cb) => { subs.add(cb); return () => subs.delete(cb) }
    const emit = (s) => { for (const cb of subs) cb({ agentId: 'a1', target: 'master', logPath: 'L', ...s }) }
    const clock = { t: NOW }
    const out = new Map()
    const inp = new Map()
    const stop = startHandoffs({
      onMergeEvent,
      resolveAgent: (id) => (id === 'a1' ? { ptyId: 'p1', shell } : null),
      lastOutputAt: (p) => out.get(p) ?? null,
      lastInputAt: (p) => inp.get(p) ?? null,
      now: () => clock.t
    })
    return { emit, clock, out, inp, stop }
  }
  const texts = () => ptyPool.writePty.mock.calls.filter(c => c[1] !== '\r')

  it('writes when the pane has been untouched since Finish was queued', () => {
    const { emit, clock, out, stop } = setup()
    out.set('p1', NOW - 60000)
    emit({ state: 'queued' })
    clock.t += 1000; emit({ state: 'testing' })
    clock.t += 60000; emit({ state: 'tests-failed' })
    vi.advanceTimersByTime(150)
    expect(texts()).toHaveLength(1)
    expect(ptyPool.writePty).toHaveBeenLastCalledWith('p1', '\r')
    stop()
  })

  it('skips the write when the user typed into the pane after Finish, even long ago', () => {
    // A half-written prompt is silent: the 4000ms quiet check alone would pass.
    const { emit, clock, out, inp, stop } = setup()
    out.set('p1', NOW - 60000)
    emit({ state: 'queued' })
    clock.t += 2000
    inp.set('p1', clock.t)
    clock.t += 60000
    emit({ state: 'tests-failed' })
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
    stop()
  })

  it('skips the write when the pane printed anything after Finish (new task, open menu)', () => {
    const { emit, clock, out, stop } = setup()
    out.set('p1', NOW - 60000)
    emit({ state: 'queued' })
    clock.t += 5000
    out.set('p1', clock.t)
    clock.t += 60000
    emit({ state: 'conflict' })
    vi.runAllTimers()
    expect(ptyPool.writePty).not.toHaveBeenCalled()
    stop()
  })

  it('skips a failure it never saw queued, and writes at most once per Finish', () => {
    const { emit, clock, out, stop } = setup()
    out.set('p1', NOW - 60000)
    emit({ state: 'tests-failed' })
    expect(ptyPool.writePty).not.toHaveBeenCalled()
    emit({ state: 'queued' })
    clock.t += 30000
    emit({ state: 'conflict' })
    emit({ state: 'conflict' })
    expect(texts()).toHaveLength(1)
    stop()
  })
})
