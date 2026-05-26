import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTerminalTheme } from '../../src/renderer/terminal-theme.js'

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: (name) => {
      switch (name) {
        case '--cs-term-bg':         return ' #111213 '
        case '--cs-term-fg':         return ' #abcdef '
        case '--cs-term-cursor':     return ' #fedcba '
        case '--cs-term-selection':  return ' rgba(1,2,3,0.4) '
        case '--cs-term-black':      return ' #000001 '
        case '--cs-term-bright-black': return ' #000002 '
        case '--cs-term-red':        return ' #111111 '
        case '--cs-term-bright-red': return ' #222222 '
        case '--cs-term-green':      return ' #333333 '
        case '--cs-term-bright-green': return ' #444444 '
        case '--cs-term-yellow':     return ' #555555 '
        case '--cs-term-bright-yellow': return ' #666666 '
        case '--cs-term-blue':       return ' #777777 '
        case '--cs-term-bright-blue': return ' #888888 '
        case '--cs-term-magenta':    return ' #999999 '
        case '--cs-term-bright-magenta': return ' #aaaaaa '
        case '--cs-term-cyan':       return ' #bbbbbb '
        case '--cs-term-bright-cyan': return ' #cccccc '
        case '--cs-term-white':      return ' #dddddd '
        case '--cs-term-bright-white': return ' #eeeeee '
        default:                     return ''
      }
    }
  }))
})

describe('buildTerminalTheme', () => {
  it('reads xterm tokens from the document root and trims them', () => {
    const t = buildTerminalTheme()
    expect(t.background).toBe('#111213')
    expect(t.foreground).toBe('#abcdef')
    expect(t.cursor).toBe('#fedcba')
    expect(t.cursorAccent).toBe('#111213') // matches background
    expect(t.selectionBackground).toBe('rgba(1,2,3,0.4)')
    expect(t.green).toBe('#333333')
    expect(t.brightCyan).toBe('#cccccc')
  })

  it('falls back to the Sarvis-Dark default when a token is empty', () => {
    // mockImplementation (not Once) — buildTerminalTheme calls getComputedStyle
    // once per token, so every call needs the empty getter.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: () => ''
    }))
    const t = buildTerminalTheme()
    expect(t.background).toBe('#0d0f12')
    expect(t.cyan).toBe('#67e8f9')
  })
})
