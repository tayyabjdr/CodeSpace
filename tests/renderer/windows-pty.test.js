import { describe, it, expect } from 'vitest'
import { parseWindowsBuild, windowsPtyOption, CONPTY_MIN_BUILD } from '../../src/renderer/windows-pty.js'

describe('parseWindowsBuild', () => {
  it('reads the build out of an os.release() string', () => {
    expect(parseWindowsBuild('10.0.26200')).toBe(26200)
  })

  it('reads a four-part release string', () => {
    expect(parseWindowsBuild('10.0.19045.5011')).toBe(19045)
  })

  it('returns 0 for anything it cannot parse', () => {
    expect(parseWindowsBuild('')).toBe(0)
    expect(parseWindowsBuild(undefined)).toBe(0)
    expect(parseWindowsBuild('6.1')).toBe(0)
  })
})

describe('windowsPtyOption', () => {
  it('reports conpty on a modern Windows build', () => {
    // node-pty picks conpty over winpty at 18309 and CodeSpace never overrides
    // useConpty, so this has to agree with windowsPtyAgent.js.
    expect(windowsPtyOption('win32', '10.0.26200')).toEqual({
      backend: 'conpty',
      buildNumber: 26200
    })
  })

  it('reports winpty below node-pty’s conpty threshold', () => {
    expect(windowsPtyOption('win32', `10.0.${CONPTY_MIN_BUILD - 1}`)).toEqual({
      backend: 'winpty',
      buildNumber: CONPTY_MIN_BUILD - 1
    })
  })

  it('passes a build that keeps xterm reflow enabled', () => {
    // xterm only keeps reflow on for conpty >= 21376 (_isReflowEnabled). Below
    // that it falls back to the "last cell is not blank means wrapped"
    // heuristic. Passing the real build lets xterm make that call itself.
    const opt = windowsPtyOption('win32', '10.0.26200')
    expect(opt.buildNumber).toBeGreaterThanOrEqual(21376)
  })

  it('returns undefined off Windows so xterm keeps its default behaviour', () => {
    expect(windowsPtyOption('darwin', '23.6.0')).toBeUndefined()
    expect(windowsPtyOption('linux', '6.8.0')).toBeUndefined()
  })

  it('returns undefined when the release string is unusable', () => {
    // Better to leave xterm on its defaults than to claim a build of 0, which
    // would switch reflow off for everyone.
    expect(windowsPtyOption('win32', undefined)).toBeUndefined()
    expect(windowsPtyOption('win32', 'unknown')).toBeUndefined()
  })
})
