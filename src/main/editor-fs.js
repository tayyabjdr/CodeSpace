import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, access as nodeAccess, open as nodeOpen } from 'node:fs/promises'

export const MAX_BYTES = 20 * 1024 * 1024 // 20 MB
export const BINARY_PROBE_BYTES = 8 * 1024 // 8 KB

export async function readFile(absPath) {
  let stat
  try {
    stat = await nodeStat(absPath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found', message: 'File not found' }
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not stat file' }
  }
  if (!stat.isFile()) return { ok: false, reason: 'denied', message: 'Not a file' }
  if (stat.size > MAX_BYTES) return { ok: false, reason: 'too-large', message: 'File exceeds 20 MB limit' }

  let buf
  try {
    buf = await nodeReadFile(absPath)
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not read file' }
  }
  // Binary probe — check first 8KB for null bytes.
  if (buf.subarray(0, BINARY_PROBE_BYTES).includes(0x00)) return { ok: false, reason: 'binary', message: 'Binary file' }
  return { ok: true, content: buf.toString('utf8'), encoding: 'utf8' }
}

export async function writeFile(absPath, content) {
  try {
    await nodeWriteFile(absPath, content, 'utf8')
    return { ok: true }
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOENT' || err.code === 'EISDIR')) {
      return { ok: false, reason: 'denied', message: err.message }
    }
    return { ok: false, reason: 'unknown', message: err?.message ?? 'Could not write file' }
  }
}

export async function pathExists(absPath) {
  try {
    await nodeAccess(absPath)
    return true
  } catch {
    return false
  }
}

// Answers "would readFile accept this?" without paying to read the whole file.
// Drag-and-drop and the Open dialog call this before the editor commits to a
// path, so a rejected file leaves the currently-open one untouched. Shares
// MAX_BYTES and the null-byte rule with readFile so the two can't drift.
export async function probeFile(absPath) {
  let stat
  try {
    stat = await nodeStat(absPath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found' }
    return { ok: false, reason: 'denied' }
  }
  if (stat.isDirectory()) return { ok: false, reason: 'directory' }
  if (!stat.isFile()) return { ok: false, reason: 'denied' }
  if (stat.size > MAX_BYTES) return { ok: false, reason: 'too-large' }

  let handle
  try {
    handle = await nodeOpen(absPath, 'r')
    const want = Math.min(stat.size, BINARY_PROBE_BYTES)
    if (want > 0) {
      const buf = Buffer.alloc(want)
      const { bytesRead } = await handle.read(buf, 0, want, 0)
      if (buf.subarray(0, bytesRead).includes(0x00)) return { ok: false, reason: 'binary' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'denied' }
  } finally {
    await handle?.close().catch(() => {})
  }
}
