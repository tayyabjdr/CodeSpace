// src/main/editor-fs.js
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

  // Binary probe — read first 8KB and look for null bytes.
  let probe
  let fh
  try {
    fh = await nodeOpen(absPath, 'r')
    const probeLen = Math.min(stat.size, BINARY_PROBE_BYTES)
    const buf = Buffer.alloc(probeLen)
    await fh.read(buf, 0, probeLen, 0)
    probe = buf
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not read file' }
  } finally {
    try { await fh?.close() } catch {}
  }
  if (probe.includes(0x00)) return { ok: false, reason: 'binary', message: 'Binary file' }

  let content
  try {
    content = await nodeReadFile(absPath, 'utf8')
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message ?? 'Could not read file' }
  }
  return { ok: true, content, encoding: 'utf8' }
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
