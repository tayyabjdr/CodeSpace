import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { existsSync, watch as nodeWatch } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function getCommandsDir() {
  return join(homedir(), '.claude', 'commands')
}

export function parseFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE)
  if (!m) {
    const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) ?? null
    return { description: firstLine, body: text }
  }
  const block = m[1]
  let description = null
  for (const line of block.split(/\r?\n/)) {
    const dm = line.match(/^\s*description\s*:\s*(.*?)\s*$/i)
    if (dm) { description = dm[1]; break }
  }
  const body = text.slice(m[0].length)
  return { description, body }
}

export async function listSkills(dir = getCommandsDir()) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return { ok: false, reason: 'invalid-dir', skills: [] }
  }
  let entries
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, skills: [] }
    return { ok: false, reason: 'denied', message: err?.message, skills: [] }
  }
  const out = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.md')) continue
    const filePath = join(dir, entry)
    let st
    try { st = await stat(filePath) } catch { continue }
    if (!st.isFile()) continue
    let text = ''
    try { text = await readFile(filePath, 'utf8') } catch { continue }
    const { description } = parseFrontmatter(text)
    out.push({
      name: entry.slice(0, -3),
      description,
      filePath
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, skills: out }
}

export async function readSkillBody(absPath) {
  if (typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, reason: 'invalid-path' }
  }
  let text
  try { text = await readFile(absPath, 'utf8') }
  catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found' }
    return { ok: false, reason: 'denied', message: err?.message }
  }
  const { body } = parseFrontmatter(text)
  return { ok: true, body }
}
