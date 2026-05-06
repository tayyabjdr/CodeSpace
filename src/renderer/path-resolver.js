// Resolves a parsed path-match against the focused terminal cwd, falling
// back to the workspace dir. Pure function with an injected fs probe so
// it's unit-testable.

const SUFFIX_RE = /:(\d+)(?::(\d+))?$/

export function isAbsolutePath(p) {
  if (typeof p !== 'string') return false
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (p.startsWith('/')) return true
  return false
}

function joinPath(base, rel) {
  const isWindows = /^[A-Za-z]:[\\/]/.test(base)
  const sep = isWindows ? '\\' : '/'
  let r = rel.replace(/[\\/]+/g, sep)
  if (r.startsWith(`.${sep}`)) r = r.slice(2)
  const baseParts = base.replace(/[\\/]+$/, '').split(/[\\/]/)
  const relParts  = r.split(sep)
  const stack = [...baseParts]
  for (const part of relParts) {
    if (part === '..') { if (stack.length > 1) stack.pop() }
    else if (part !== '.' && part !== '') stack.push(part)
  }
  return stack.join(sep)
}

export async function resolvePath(raw, focusedCwd, workspaceDir, electronApi) {
  if (typeof raw !== 'string' || raw.length === 0) return null

  let line = null, col = null
  let path = raw
  const sfx = raw.match(SUFFIX_RE)
  if (sfx) {
    path = raw.slice(0, raw.length - sfx[0].length)
    line = Number(sfx[1])
    col  = sfx[2] != null ? Number(sfx[2]) : null
  }

  if (isAbsolutePath(path)) return { path, line, col }

  for (const base of [focusedCwd, workspaceDir]) {
    if (!base) continue
    const candidate = joinPath(base, path)
    if (await electronApi.pathExists(candidate)) {
      return { path: candidate, line, col }
    }
  }
  return null
}
