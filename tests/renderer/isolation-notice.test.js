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
