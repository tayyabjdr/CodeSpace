import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useCloseGuard from '../../src/renderer/hooks/useCloseGuard.js'

let fireCloseRequested
let api

beforeEach(() => {
  fireCloseRequested = null
  api = {
    onCloseRequested: vi.fn((cb) => {
      fireCloseRequested = cb
      return vi.fn()
    }),
    closePrompted: vi.fn(),
    confirmClose: vi.fn()
  }
  window.electronAPI = api
})

afterEach(() => {
  delete window.electronAPI
})

describe('useCloseGuard', () => {
  it('starts with no close requested', () => {
    const { result } = renderHook(() => useCloseGuard())
    expect(result.current.closeRequested).toBe(false)
    expect(api.closePrompted).not.toHaveBeenCalled()
  })

  it('flags a close request and acks main immediately', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    expect(result.current.closeRequested).toBe(true)
    expect(api.closePrompted).toHaveBeenCalledTimes(1)
  })

  it('clears the flag on cancel without telling main to close', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.cancelClose())
    expect(result.current.closeRequested).toBe(false)
    expect(api.confirmClose).not.toHaveBeenCalled()
  })

  it('tells main to close on confirm', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.confirmClose())
    expect(api.confirmClose).toHaveBeenCalledTimes(1)
    expect(result.current.closeRequested).toBe(false)
  })

  it('re-arms after a cancel', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.cancelClose())
    act(() => fireCloseRequested())
    expect(result.current.closeRequested).toBe(true)
    expect(api.closePrompted).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    api.onCloseRequested.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useCloseGuard())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does not throw when electronAPI is unavailable', () => {
    delete window.electronAPI
    expect(() => renderHook(() => useCloseGuard())).not.toThrow()
  })
})
