import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { describe, it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(__dirname, '../../src/renderer/design-tokens.css'), 'utf8')

// Grab one selector's declaration body. Both blocks in this file close with
// a `}` at column 0, so the first `\n}` after the opening brace ends it.
function block(selector) {
  const i = css.indexOf(selector)
  if (i === -1) return ''
  const open = css.indexOf('{', i)
  const close = css.indexOf('\n}', open)
  return css.slice(open, close)
}

const STATE_TOKENS = [
  '--cs-state-running',
  '--cs-state-done',
  '--cs-state-exited',
  '--cs-state-isolated'
]

const SURFACES = ['--cs-bg-base', '--cs-bg-surface', '--cs-bg-elevated', '--cs-bg-sidebar']

describe('design tokens', () => {
  it('declares every state token in the default theme', () => {
    const root = block(':root {')
    for (const t of STATE_TOKENS) expect(root).toContain(t)
  })

  it('declares the state tokens as references, so they follow the active theme', () => {
    // Not hex literals: [data-theme='bridge'] applies to the same element as
    // :root, so a var() reference resolves against that theme's own accent.
    // Hardcoding here would silently keep Bridge's status dots cyan.
    const root = block(':root {')
    for (const t of STATE_TOKENS) {
      expect(root).toMatch(new RegExp(`${t}:\\s*var\\(--cs-[a-z-]+\\)`))
    }
  })

  it('keeps the default surface ramp pure neutral grey', () => {
    // The reference screenshot sampled at an RGB spread of zero on every
    // surface. This guards against the bluish tint creeping back in.
    const root = block(':root {')
    for (const name of SURFACES) {
      const m = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
      expect(m, `${name} should be declared as a 6-digit hex`).toBeTruthy()
      const [r, g, b] = [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${name} (${m[1]}) should be neutral`).toBe(0)
    }
  })

  it('leaves the bridge surface ramp warm', () => {
    // Bridge must NOT be neutralised — this is the guard on "bridge is unchanged".
    const bridge = block(":root[data-theme='bridge']")
    const m = bridge.match(/--cs-bg-base:\s*(#[0-9a-fA-F]{6})/)
    expect(m).toBeTruthy()
    const [r, g, b] = [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16))
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0)
  })
})
