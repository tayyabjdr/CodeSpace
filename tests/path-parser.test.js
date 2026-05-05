import { describe, it, expect } from 'vitest'
import { parsePathsInLine } from '../src/renderer/path-parser.js'

describe('parsePathsInLine', () => {
  it('matches an absolute Windows path with extension', () => {
    const r = parsePathsInLine('see C:\\Users\\TJ\\foo.ts for details')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ path: 'C:\\Users\\TJ\\foo.ts', line: null, col: null })
  })

  it('captures :line suffix on Windows path', () => {
    const r = parsePathsInLine('error at C:\\src\\foo.ts:42')
    expect(r[0]).toMatchObject({ path: 'C:\\src\\foo.ts', line: 42, col: null })
  })

  it('captures :line:col suffix', () => {
    const r = parsePathsInLine('at C:\\src\\foo.ts:42:7')
    expect(r[0]).toMatchObject({ path: 'C:\\src\\foo.ts', line: 42, col: 7 })
  })

  it('matches an absolute POSIX path', () => {
    const r = parsePathsInLine('see /home/u/foo.ts please')
    expect(r[0]).toMatchObject({ path: '/home/u/foo.ts' })
  })

  it('matches a workspace-relative path', () => {
    const r = parsePathsInLine('open src/components/Foo.jsx now')
    expect(r[0]).toMatchObject({ path: 'src/components/Foo.jsx' })
  })

  it('matches ./ and ../ prefixes', () => {
    expect(parsePathsInLine('./foo.ts ok')[0].path).toBe('./foo.ts')
    expect(parsePathsInLine('see ../bar.ts')[0].path).toBe('../bar.ts')
  })

  it('strips trailing punctuation', () => {
    const r = parsePathsInLine('see src/foo.ts.')
    expect(r[0].path).toBe('src/foo.ts')
    expect(r[0].end).toBe(14) // exclusive end of path; trailing '.' is at index 14
  })

  it('does not match version flags or non-paths', () => {
    expect(parsePathsInLine('npm install --save')).toHaveLength(0)
    expect(parsePathsInLine('v1.2.3')).toHaveLength(0)
  })

  it('requires a 1-8 char extension', () => {
    expect(parsePathsInLine('foo.thisextensionistoolong')).toHaveLength(0)
    expect(parsePathsInLine('foo.x')).toHaveLength(1)
  })

  it('returns multiple matches with correct indices', () => {
    const text = 'see src/a.ts and src/b.ts'
    const r = parsePathsInLine(text)
    expect(r.map(m => m.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(text.slice(r[0].start, r[0].end)).toBe('src/a.ts')
    expect(text.slice(r[1].start, r[1].end)).toBe('src/b.ts')
  })
})
