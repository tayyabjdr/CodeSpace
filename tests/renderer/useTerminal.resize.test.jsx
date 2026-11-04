import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'

// xterm and the fit addon are replaced with the smallest surface useTerminal
// touches. `h.dims` is what the fake fit() measures the container to be, so a
// test can "drag" the pane by moving those numbers.
const h = vi.hoisted(() => ({
  instances: [],
  dims: { cols: 80, rows: 24 },
  fitCalls: { n: 0 }
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = { ...options }
      this.cols = h.dims.cols
      this.rows = h.dims.rows
      h.instances.push(this)
    }
    loadAddon(addon) { addon.activate?.(this) }
    open() {}
    attachCustomKeyEventHandler() {}
    onData() { return { dispose: () => {} } }
    registerLinkProvider() { return { dispose: () => {} } }
    write() {}
    scrollToBottom() {}
    getSelection() { return '' }
    clearSelection() {}
    dispose() {}
    get buffer() { return { active: { getLine: () => null } } }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate(term) { this._term = term }
    dispose() {}
    fit() {
      h.fitCalls.n++
      if (!this._term) return
      this._term.cols = h.dims.cols
      this._term.rows = h.dims.rows
    }
  }
}))

vi.mock('../../src/renderer/pty-pool.js', () => ({
  createPty: vi.fn(async () => 'pty-new'),
  attach: vi.fn(() => () => {}),
  writePty: vi.fn(),
  resizePty: vi.fn()
}))

import * as ptyPool from '../../src/renderer/pty-pool.js'
import useTerminal from '../../src/renderer/hooks/useTerminal.js'
import { PTY_RESIZE_DEBOUNCE_MS } from '../../src/renderer/constants.js'

let fireResize

function mountTerminal() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const ref = createRef()
  ref.current = container
  return renderHook(() =>
    useTerminal('t1', 'pty-1', 'claude', 'C:\\repo', ref, undefined, undefined, undefined, 13, undefined, undefined, 'sarvis-dark')
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  h.instances.length = 0
  h.dims = { cols: 80, rows: 24 }
  h.fitCalls.n = 0
  fireResize = null
  global.ResizeObserver = class {
    constructor(cb) { fireResize = cb }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.electronAPI = {
    platform: 'win32',
    osRelease: '10.0.26200',
    readClipboardText: vi.fn(),
    writeClipboardText: vi.fn()
  }
  ptyPool.resizePty.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useTerminal — ConPTY compatibility', () => {
  it('tells xterm it is driving a Windows ConPTY', async () => {
    // Left unset, xterm pulls rows back out of scrollback when the terminal
    // grows (ybase--). ConPTY does the opposite: it opens blank rows and lets
    // the agent repaint into them. The disagreement is what leaves duplicated
    // lines and blank gaps after a resize.
    await act(async () => { mountTerminal() })
    expect(h.instances[0].options.windowsPty).toEqual({
      backend: 'conpty',
      buildNumber: 26200
    })
  })
})

describe('useTerminal — resize coalescing', () => {
  it('sends no PTY resize while a drag stays inside one character cell', async () => {
    await act(async () => { mountTerminal() })
    ptyPool.resizePty.mockClear()

    // Sub-cell mouse movement: ResizeObserver fires, the measured grid doesn't
    // change. ConPTY's ResizePseudoConsole rewraps and signals the child even
    // for an identical size, so this must not reach the PTY at all.
    for (let i = 0; i < 8; i++) act(() => { fireResize([]) })
    act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 4) })

    expect(ptyPool.resizePty).not.toHaveBeenCalled()
  })

  it('coalesces a drag into a single PTY resize at the settled size', async () => {
    await act(async () => { mountTerminal() })
    ptyPool.resizePty.mockClear()

    // One frame per observer callback, the way a real drag arrives.
    for (const cols of [92, 104, 118, 131, 145]) {
      h.dims = { cols, rows: 30 }
      act(() => { fireResize([]) })
      act(() => { vi.advanceTimersByTime(16) })
    }
    act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS) })

    expect(ptyPool.resizePty).toHaveBeenCalledTimes(1)
    expect(ptyPool.resizePty).toHaveBeenCalledWith('pty-1', 145, 30)
  })

  it('resizes again after the next drag settles', async () => {
    await act(async () => { mountTerminal() })
    ptyPool.resizePty.mockClear()

    h.dims = { cols: 120, rows: 40 }
    act(() => { fireResize([]) })
    act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS) })

    // Stretch back in — the "inside and outside" gesture that surfaced this.
    h.dims = { cols: 70, rows: 22 }
    act(() => { fireResize([]) })
    act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS) })

    expect(ptyPool.resizePty).toHaveBeenCalledTimes(2)
    expect(ptyPool.resizePty).toHaveBeenLastCalledWith('pty-1', 70, 22)
  })

  it('drops a pending resize when the pane unmounts mid-drag', async () => {
    let view
    await act(async () => { view = mountTerminal() })
    ptyPool.resizePty.mockClear()

    h.dims = { cols: 200, rows: 60 }
    act(() => { fireResize([]) })
    act(() => { view.unmount() })
    act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 4) })

    expect(ptyPool.resizePty).not.toHaveBeenCalled()
  })
})
