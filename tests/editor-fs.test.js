// tests/editor-fs.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, access as nodeAccess } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'

import { readFile, writeFile, pathExists, MAX_BYTES, BINARY_PROBE_BYTES } from '../src/main/editor-fs.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'editor-fs-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('editor-fs.readFile', () => {
  it('returns ok with utf8 content for a small text file', async () => {
    const p = join(dir, 'a.txt')
    writeFileSync(p, 'hello world')
    const r = await readFile(p)
    expect(r).toEqual({ ok: true, content: 'hello world', encoding: 'utf8' })
  })

  it('returns reason=not-found for a missing file', async () => {
    const r = await readFile(join(dir, 'missing.txt'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })

  it('returns reason=too-large for files over 20 MB', async () => {
    const p = join(dir, 'big.txt')
    writeFileSync(p, Buffer.alloc(MAX_BYTES + 1, 'a'))
    const r = await readFile(p)
    expect(r).toMatchObject({ ok: false, reason: 'too-large' })
  })

  it('returns reason=binary when the first 8KB contain a null byte', async () => {
    const p = join(dir, 'bin')
    const buf = Buffer.alloc(BINARY_PROBE_BYTES, 'a')
    buf[100] = 0x00
    writeFileSync(p, buf)
    const r = await readFile(p)
    expect(r).toMatchObject({ ok: false, reason: 'binary' })
  })
})

describe('editor-fs.writeFile', () => {
  it('writes utf8 content and returns ok', async () => {
    const p = join(dir, 'out.txt')
    const r = await writeFile(p, 'new content')
    expect(r).toEqual({ ok: true })
    expect(await nodeReadFile(p, 'utf8')).toBe('new content')
  })

  it('returns reason=denied when target dir does not exist', async () => {
    const p = join(dir, 'no', 'such', 'dir', 'out.txt')
    const r = await writeFile(p, 'x')
    expect(r.ok).toBe(false)
    expect(['denied', 'unknown']).toContain(r.reason)
  })
})

describe('editor-fs.pathExists', () => {
  it('returns true for an existing path', async () => {
    const p = join(dir, 'a')
    writeFileSync(p, '')
    expect(await pathExists(p)).toBe(true)
  })
  it('returns false for a missing path', async () => {
    expect(await pathExists(join(dir, 'missing'))).toBe(false)
  })
})
