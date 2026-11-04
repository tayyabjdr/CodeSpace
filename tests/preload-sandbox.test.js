import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const preloadSrc = readFileSync(
  join(process.cwd(), 'src/preload/index.js'),
  'utf8'
)

// Comments here explain what the sandbox forbids, and naming it is the clearest
// way to do that — so scan code only, or the explanation trips its own check.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const preloadCode = stripComments(preloadSrc)

// The window is created with `sandbox: true`, so the preload gets a polyfilled
// require that only resolves `electron`, `events`, `timers` and `url`. Pulling
// in anything else — `os`, `fs`, `path` — throws while the preload loads, which
// means exposeInMainWorld never runs and the whole renderer comes up with no
// electronAPI at all. It builds and type-checks fine, so nothing but a check
// like this catches it before runtime.
const SANDBOX_SAFE_MODULES = new Set(['electron', 'events', 'timers', 'url'])

describe('preload sandbox constraints', () => {
  it('imports only modules a sandboxed preload can resolve', () => {
    const specifiers = [...preloadCode.matchAll(/^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)]
      .map(m => m[1])
      .filter(s => !s.startsWith('.'))

    expect(specifiers.length).toBeGreaterThan(0)
    for (const spec of specifiers) {
      expect(
        SANDBOX_SAFE_MODULES.has(spec.replace(/^node:/, '')),
        `preload imports "${spec}", which a sandboxed preload cannot resolve`
      ).toBe(true)
    }
  })

  it('does not reach for require() of a node builtin either', () => {
    const required = [...preloadCode.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
    for (const spec of required) {
      expect(SANDBOX_SAFE_MODULES.has(spec.replace(/^node:/, ''))).toBe(true)
    }
  })

  it('sources the pty host info from main rather than reading it locally', () => {
    // os.release() is the natural way to get the Windows build and is exactly
    // what the sandbox forbids, so the value comes over IPC instead.
    expect(preloadCode).toContain("ipcRenderer.sendSync('app:ptyHostInfo')")
  })
})

describe('main answers the pty host info channel', () => {
  it('registers app:ptyHostInfo outside createWindow', () => {
    // sendSync fires while the preload loads; a handler registered inside
    // createWindow after loadFile could miss it and return undefined.
    const mainSrc = readFileSync(join(process.cwd(), 'src/main/index.js'), 'utf8')
    const handlerAt = mainSrc.indexOf("ipcMain.on('app:ptyHostInfo'")
    const createWindowAt = mainSrc.indexOf('function createWindow()')
    expect(handlerAt).toBeGreaterThan(-1)
    expect(handlerAt).toBeLessThan(createWindowAt)
  })
})
