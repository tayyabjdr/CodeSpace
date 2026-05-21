import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdtempSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let dir
vi.mock('electron', () => ({
  app: { getPath: () => dir }
}))

import {
  normalizePath, mergeRecent, loadRecents, addRecent, removeRecent, MAX_RECENTS
} from '../../src/main/recent-dirs-store.js'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-recents-'))
})

// Creates a real sub-directory under the temp dir and returns its absolute path.
// loadRecents() prunes paths that don't exist, so fs-backed tests need real dirs.
function realDir(name) {
  const p = join(dir, name)
  mkdirSync(p)
  return p
}

describe('mergeRecent', () => {
  it('adds a new directory to the front', () => {
    expect(mergeRecent(['a'], 'b', 6)).toEqual(['b', 'a'])
  })

  it('moves an existing directory to the front without duplicating', () => {
    expect(mergeRecent(['a', 'b', 'c'], 'c', 6)).toEqual(['c', 'a', 'b'])
  })

  it('collapses case-insensitive and trailing-separator variants', () => {
    expect(mergeRecent(['C:\\Foo'], 'c:\\foo\\', 6)).toEqual(['c:\\foo\\'])
  })

  it('caps the list at max, dropping the oldest', () => {
    expect(mergeRecent(['a', 'b', 'c', 'd', 'e', 'f'], 'g', 6))
      .toEqual(['g', 'a', 'b', 'c', 'd', 'e'])
  })

  it('handles an empty starting list', () => {
    expect(mergeRecent([], 'a', 6)).toEqual(['a'])
  })
})

describe('normalizePath', () => {
  it('lower-cases and strips trailing separators', () => {
    expect(normalizePath('C:\\Foo\\')).toBe('c:\\foo')
    expect(normalizePath('/home/x/')).toBe('/home/x')
  })
})

describe('recent-dirs-store (fs)', () => {
  it('returns [] when the file is missing', async () => {
    expect(await loadRecents()).toEqual([])
  })

  it('addRecent persists and round-trips', async () => {
    const a = realDir('a')
    await addRecent(a)
    expect(await loadRecents()).toEqual([a])
  })

  it('addRecent moves a repeated directory to the front', async () => {
    const a = realDir('a')
    const b = realDir('b')
    await addRecent(a)
    await addRecent(b)
    await addRecent(a)
    expect(await loadRecents()).toEqual([a, b])
  })

  it('loadRecents prunes directories that no longer exist', async () => {
    const a = realDir('a')
    const gone = join(dir, 'gone')   // never created
    await fs.writeFile(
      join(dir, 'recents.json'),
      JSON.stringify({ version: 1, dirs: [gone, a] }),
      'utf8'
    )
    expect(await loadRecents()).toEqual([a])
  })

  it('removeRecent drops the matching entry', async () => {
    const a = realDir('a')
    const b = realDir('b')
    await addRecent(a)
    await addRecent(b)
    const next = await removeRecent(a)
    expect(next).toEqual([b])
    expect(await loadRecents()).toEqual([b])
  })

  it('quarantines a corrupt file and returns []', async () => {
    await fs.writeFile(join(dir, 'recents.json'), '{ not json', 'utf8')
    expect(await loadRecents()).toEqual([])
    const files = await fs.readdir(dir)
    expect(files.some(f => f.startsWith('recents.json.corrupt-'))).toBe(true)
  })

  it('caps persisted history at MAX_RECENTS', async () => {
    const dirs = []
    for (let i = 0; i < MAX_RECENTS + 2; i++) dirs.push(realDir('d' + i))
    for (const d of dirs) await addRecent(d)
    const list = await loadRecents()
    expect(list.length).toBe(MAX_RECENTS)
    expect(list[0]).toBe(dirs[dirs.length - 1])
  })
})
