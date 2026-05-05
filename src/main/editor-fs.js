import { readFile as nodeReadFile, writeFile as nodeWriteFile, stat as nodeStat, access as nodeAccess } from 'node:fs/promises'

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
