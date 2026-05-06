import { describe, it, expect, vi } from 'vitest'
import { resolvePath, isAbsolutePath } from '../src/renderer/path-resolver.js'

function makeApi(existing) {
  return {
    pathExists: vi.fn(async (p) => existing.has(p))
  }
}

describe('isAbsolutePath', () => {
  it('detects Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\foo')).toBe(true)
    expect(isAbsolutePath('D:/bar')).toBe(true)
  })
  it('detects POSIX absolute paths', () => {
    expect(isAbsolutePath('/usr/bin')).toBe(true)
  })
  it('rejects relative paths', () => {
    expect(isAbsolutePath('src/foo.ts')).toBe(false)
    expect(isAbsolutePath('./foo.ts')).toBe(false)
    expect(isAbsolutePath('../foo.ts')).toBe(false)
  })
})

describe('resolvePath', () => {
  it('passes absolute paths through', async () => {
    const api = makeApi(new Set(['C:\\foo.ts']))
    const r = await resolvePath('C:\\foo.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toEqual({ path: 'C:\\foo.ts', line: null, col: null })
    expect(api.pathExists).not.toHaveBeenCalled()
  })

  it('resolves relative against focusedCwd first', async () => {
    const api = makeApi(new Set(['C:\\cwd\\src\\a.ts']))
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r.path).toBe('C:\\cwd\\src\\a.ts')
  })

  it('falls back to workspaceDir when not in cwd', async () => {
    const api = makeApi(new Set(['C:\\ws\\src\\a.ts']))
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r.path).toBe('C:\\ws\\src\\a.ts')
  })

  it('returns null when neither location exists', async () => {
    const api = makeApi(new Set())
    const r = await resolvePath('src/a.ts', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toBeNull()
  })

  it('preserves line and col through resolution', async () => {
    const api = makeApi(new Set(['C:\\cwd\\foo.ts']))
    const r = await resolvePath('foo.ts:42:7', 'C:\\cwd', 'C:\\ws', api)
    expect(r).toEqual({ path: 'C:\\cwd\\foo.ts', line: 42, col: 7 })
  })
})
