import { describe, it, expect } from 'vitest'
import { focusSessionIn, withExpanded } from '../../src/renderer/workspace-ops.js'

const WORKSPACES = [
  { id: 'w1', name: 'alpha', focusedTerminalId: 't1' },
  { id: 'w2', name: 'beta',  focusedTerminalId: null }
]

describe('focusSessionIn', () => {
  it('sets focus on the named workspace', () => {
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next.find(w => w.id === 'w2').focusedTerminalId).toBe('t9')
  })

  it('leaves every other workspace untouched', () => {
    // The bug this guards: routing through App's updateActive would write
    // focus onto the OUTGOING active workspace, because that helper closes
    // over the current activeId.
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next.find(w => w.id === 'w1').focusedTerminalId).toBe('t1')
  })

  it('returns a new array and new object only for the target', () => {
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next).not.toBe(WORKSPACES)
    expect(next[0]).toBe(WORKSPACES[0])
    expect(next[1]).not.toBe(WORKSPACES[1])
  })

  it('is a no-op for an unknown workspace id', () => {
    const next = focusSessionIn(WORKSPACES, 'nope', 't9')
    expect(next.map(w => w.focusedTerminalId)).toEqual(['t1', null])
  })
})

describe('withExpanded', () => {
  it('adds an id that is absent', () => {
    expect(withExpanded(new Set(), 'w1').has('w1')).toBe(true)
  })

  it('returns the same Set reference when the id is already present', () => {
    // Keeps React from re-rendering the tree on a redundant activation.
    const set = new Set(['w1'])
    expect(withExpanded(set, 'w1')).toBe(set)
  })

  it('does not mutate the input when adding', () => {
    const set = new Set()
    withExpanded(set, 'w1')
    expect(set.size).toBe(0)
  })
})
