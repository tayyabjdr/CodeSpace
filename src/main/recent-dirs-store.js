import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'recents.json'
const SCHEMA_VERSION = 1   // reserved for future migration; not inspected on load at v1
export const MAX_RECENTS = 6

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

// Comparison key for a path: lower-cased, trailing separators stripped.
// Windows paths are case-insensitive, so two casings of the same folder must
// collapse to one entry. The original-cased string is what gets stored.
export function normalizePath(p) {
  return String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
}

// Pure dedup + MRU + cap. Drops any existing entry equal to `dir` (by
// normalizePath), puts `dir` at the front, truncates to `max`.
export function mergeRecent(list, dir, max) {
  const key = normalizePath(dir)
  const rest = (Array.isArray(list) ? list : []).filter(d => normalizePath(d) !== key)
  return [dir, ...rest].slice(0, max)
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  try { await fs.rename(path, `${path}.corrupt-${ts}`) } catch {
    // best-effort — if rename fails, leave the file in place
  }
}

async function saveRecents(dirs) {
  const safe = { version: SCHEMA_VERSION, dirs: dirs.slice(0, MAX_RECENTS) }
  const path = filePath()
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

export async function loadRecents() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return []   // ENOENT or any read failure
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    return []
  }

  if (!parsed || !Array.isArray(parsed.dirs)) {
    await quarantineCorrupt(path)
    return []
  }

  const dirs = parsed.dirs.filter(d => typeof d === 'string' && d.length > 0)

  // Prune entries whose directory no longer exists on disk.
  const checks = await Promise.all(dirs.map(async d => {
    try {
      const st = await fs.stat(d)
      return st.isDirectory()
    } catch {
      return false
    }
  }))
  const alive = dirs.filter((_, i) => checks[i])

  if (alive.length !== dirs.length) {
    try { await saveRecents(alive) } catch {}
  }
  return alive
}

export async function addRecent(dir) {
  // Defensive guard. Callers never pass an empty/non-string dir in practice, but
  // if one slips through, return the true current list (via loadRecents) rather
  // than [] — so a consumer using the return value is never wrongly told the
  // recents list is empty.
  if (typeof dir !== 'string' || dir.length === 0) return loadRecents()
  const current = await loadRecents()
  const next = mergeRecent(current, dir, MAX_RECENTS)
  await saveRecents(next)
  return next
}

export async function removeRecent(dir) {
  const key = normalizePath(dir)
  const current = await loadRecents()
  const next = current.filter(d => normalizePath(d) !== key)
  await saveRecents(next)
  return next
}
