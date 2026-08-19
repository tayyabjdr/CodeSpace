import { describe, it, expect, vi } from 'vitest'
import { resolvePath, isAbsolutePath, basename, shortenPath } from '../src/renderer/path-resolver.js'

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

describe('basename', () => {
  it('returns the last segment of a Windows path', () => {
    expect(basename('C:\\Users\\TJ\\project\\notes.md')).toBe('notes.md')
  })

  it('returns the last segment of a POSIX path', () => {
    expect(basename('/home/tj/project/notes.md')).toBe('notes.md')
  })

  it('returns the input unchanged when there is no separator', () => {
    expect(basename('notes.md')).toBe('notes.md')
  })

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(basename(null)).toBe('')
    expect(basename(undefined)).toBe('')
    expect(basename('')).toBe('')
  })
})

describe('shortenPath', () => {
  it('returns non-strings and empties as an empty string', () => {
    expect(shortenPath('')).toBe('')
    expect(shortenPath(undefined)).toBe('')
    expect(shortenPath(null)).toBe('')
  })

  it('leaves a path of fewer than four segments unchanged', () => {
    expect(shortenPath('D:\\dev\\app')).toBe('D:\\dev\\app')
    expect(shortenPath('D:\\dev')).toBe('D:\\dev')
  })

  it('elides the middle of a four-segment windows path', () => {
    expect(shortenPath('D:\\PC Backup\\ControlDeck\\CodeSpace'))
      .toBe('D:\\…\\ControlDeck\\CodeSpace')
  })

  it('elides everything between root and the last two segments', () => {
    expect(shortenPath('D:\\PC Backup\\ControlDeck\\portfolio\\src'))
      .toBe('D:\\…\\portfolio\\src')
  })

  it('uses forward slashes for posix paths', () => {
    expect(shortenPath('/home/tj/dev/app/src')).toBe('/…/app/src')
  })
})
