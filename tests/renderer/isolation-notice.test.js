import { describe, it, expect } from 'vitest'
import { isolationNotice, ISOLATION_NOTES } from '../../src/renderer/isolation-notice.js'

describe('isolationNotice', () => {
  it('offers isolation when the folder qualifies, enabled only with no live agents', () => {
    expect(isolationNotice({ isolated: false, canIso: { ok: true }, liveAgents: 2, failures: [] }))
      .toEqual({ kind: 'can-isolate', actionEnabled: false })
    expect(isolationNotice({ isolated: false, canIso: { ok: true }, liveAgents: 0, failures: [] }))
      .toEqual({ kind: 'can-isolate', actionEnabled: true })
  })
  it('explains when the folder cannot be isolated', () => {
    expect(isolationNotice({ isolated: false, canIso: { ok: false, reason: 'not-a-repo' }, liveAgents: 1, failures: [] }).kind)
      .toBe('cannot-isolate')
  })
  it('is silent for isolated workspaces and while eligibility is unknown', () => {
    expect(isolationNotice({ isolated: true, canIso: { ok: true }, liveAgents: 1, failures: [] }).kind).toBe(null)
    expect(isolationNotice({ isolated: false, canIso: null, liveAgents: 0, failures: [] }).kind).toBe(null)
  })
  it('spawn failures win and can always be retried', () => {
    expect(isolationNotice({ isolated: true, canIso: { ok: true }, liveAgents: 0, failures: [{}] }))
      .toEqual({ kind: 'spawn-failed', actionEnabled: true })
  })
  it('exports the shared reason notes', () => {
    expect(Object.keys(ISOLATION_NOTES).sort()).toEqual(['git-missing', 'no-commits', 'not-a-repo'])
  })
})

import { nextAgentCounter, mergeRetryFailures } from '../../src/renderer/isolation-notice.js'

describe('nextAgentCounter', () => {
  it('advances by the batch size even when only some agents succeeded', () => {
    // 3 retried from startNum 5; only the middle one (number 6) succeeded
    expect(nextAgentCounter(4, 5, 3)).toBe(7)
  })
  it('never moves backwards', () => {
    expect(nextAgentCounter(9, 5, 2)).toBe(9)
  })
})

describe('mergeRetryFailures', () => {
  it('removes retried items by identity, keeps concurrent ones, appends new', () => {
    const a = { item: { shell: 'claude' } }, b = { item: { shell: 'claude' } }, c = { item: { shell: 'codex' } }
    const again = { item: a.item, error: 'x' }
    const out = mergeRetryFailures([a, b, c], [a, b], [again])
    expect(out).toEqual([c, again])
    expect(out[0]).toBe(c)
  })
  it('tolerates a missing current list', () => {
    expect(mergeRetryFailures(undefined, [], [])).toEqual([])
  })
})

describe('isolationNotice / setup warnings', () => {
  it('shows a setup-warning for an isolated workspace that has warnings', () => {
    expect(isolationNotice({ isolated: true, canIso: null, liveAgents: 1, failures: [], warnings: ['w'] }))
      .toEqual({ kind: 'setup-warning', actionEnabled: false })
  })
  it('spawn failures and can-isolate outrank warnings; no warnings means no notice', () => {
    expect(isolationNotice({ isolated: true, liveAgents: 0, failures: [{}], warnings: ['w'] }).kind).toBe('spawn-failed')
    expect(isolationNotice({ isolated: false, canIso: { ok: true }, liveAgents: 0, failures: [], warnings: ['w'] }).kind).toBe('can-isolate')
    expect(isolationNotice({ isolated: true, liveAgents: 1, failures: [], warnings: [] }).kind).toBe(null)
    expect(isolationNotice({ isolated: true, liveAgents: 1, failures: [] }).kind).toBe(null)
  })
})
