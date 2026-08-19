import { describe, it, expect, vi, beforeEach } from 'vitest'

// pty-pool holds module-level Maps, so every test needs a fresh module
// instance. `ensureSubscription` reaches for window.electronAPI, so we stub
// it and capture the exit callback the pool registers per ptyId — that
// callback is how we simulate a PTY dying.
describe('pty-pool exit store', () => {
  let ptyPool
  let exitHandlers

  beforeEach(async () => {
    vi.resetModules()
    exitHandlers = new Map()
    window.electronAPI = {
      onPtyData: () => () => {},
      onPtyExit: (ptyId, cb) => { exitHandlers.set(ptyId, cb); return () => {} },
      killPty: vi.fn()
    }
    ptyPool = await import('../../src/renderer/pty-pool.js')
  })

  it('starts with no exited ptys', () => {
    expect(ptyPool.getExitedPtyIds().size).toBe(0)
  })

  it('returns the same Set reference when nothing has changed', () => {
    // useSyncExternalStore calls getSnapshot several times per render and
    // warns (then loops) if the reference keeps changing.
    expect(ptyPool.getExitedPtyIds()).toBe(ptyPool.getExitedPtyIds())
  })

  it('records a ptyId and notifies subscribers when its PTY exits', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const cb = vi.fn()
    ptyPool.subscribeExits(cb)

    exitHandlers.get('pty-1')(0)

    expect(cb).toHaveBeenCalledTimes(1)
    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(true)
  })

  it('publishes a new snapshot reference after an exit', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const before = ptyPool.getExitedPtyIds()

    exitHandlers.get('pty-1')(0)

    expect(ptyPool.getExitedPtyIds()).not.toBe(before)
  })

  it('keeps returning the same snapshot reference across repeated calls after an exit', () => {
    // This is the state React actually lives in most of the time (post-exit,
    // no further mutation) — an accidental `new Set(...)` per call here
    // would loop useSyncExternalStore forever, and the pristine-state test
    // above can't catch that because it never triggers an exit.
    ptyPool.attach('pty-1', { onData: () => {} })
    exitHandlers.get('pty-1')(0)

    const first = ptyPool.getExitedPtyIds()
    const second = ptyPool.getExitedPtyIds()

    expect(first).toBe(second)
  })

  it('stops notifying after unsubscribe', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const cb = vi.fn()
    const off = ptyPool.subscribeExits(cb)
    off()

    exitHandlers.get('pty-1')(0)

    expect(cb).not.toHaveBeenCalled()
  })

  it('drops the ptyId from the snapshot when the PTY is killed', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    exitHandlers.get('pty-1')(0)
    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(true)

    ptyPool.killPty('pty-1')

    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(false)
  })

  it('still fires per-pty attach onExit listeners', () => {
    // The existing TerminalPane path must keep working unchanged.
    const onExit = vi.fn()
    ptyPool.attach('pty-1', { onData: () => {}, onExit })

    exitHandlers.get('pty-1')(3)

    expect(onExit).toHaveBeenCalledWith(3)
  })
})
