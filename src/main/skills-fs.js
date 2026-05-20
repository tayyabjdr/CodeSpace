import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, watch as nodeWatch } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const SKILL_FILENAME = 'SKILL.md'

// Skills live as subdirectories of ~/.claude/skills/, each containing a SKILL.md
// file. The directory name is the skill's identity (e.g. `codespace-design`);
// the SKILL.md may carry frontmatter (`name:` / `description:`) used for display
// and the body below is the prompt injected on drag-drop.
export function getSkillsDir() {
  return join(homedir(), '.claude', 'skills')
}

// Plugin-bundled skills installed by Claude Code's plugin system. Each plugin
// version exposes a `skills/` directory under the cache root:
//   ~/.claude/plugins/cache/<repo>/<plugin>/<version>/skills/<name>/SKILL.md
export function getPluginsCacheDir() {
  return join(homedir(), '.claude', 'plugins', 'cache')
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

export async function listSkills(dir = getSkillsDir()) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return { ok: false, reason: 'invalid-dir', skills: [] }
  }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, skills: [] }
    return { ok: false, reason: 'denied', message: err?.message, skills: [] }
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const filePath = join(dir, entry.name, SKILL_FILENAME)
    let text
    try { text = await readFile(filePath, 'utf8') } catch { continue }
    const { description } = parseFrontmatter(text)
    out.push({
      name: entry.name,
      description,
      filePath
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, skills: out }
}

// Walk ~/.claude/plugins/cache/<repo>/<plugin>/<version>/skills/<name>/SKILL.md.
// For each plugin we pick the latest version (alphabetical sort, last entry)
// to avoid surfacing the same skill from multiple installed versions. The
// returned `name` is `<plugin>:<skill>` to match how Claude Code addresses them.
export async function listPluginSkills(rootDir = getPluginsCacheDir()) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    return { ok: false, reason: 'invalid-dir', skills: [] }
  }
  let repos
  try { repos = await readdir(rootDir, { withFileTypes: true }) }
  catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, skills: [] }
    return { ok: false, reason: 'denied', message: err?.message, skills: [] }
  }
  const out = []
  for (const repo of repos) {
    if (!repo.isDirectory()) continue
    // Transient git-clone scratch dirs from the plugin installer.
    if (repo.name.startsWith('temp_git_')) continue
    const repoDir = join(rootDir, repo.name)
    let plugins
    try { plugins = await readdir(repoDir, { withFileTypes: true }) } catch { continue }
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue
      const pluginDir = join(repoDir, plugin.name)
      let versionEntries
      try { versionEntries = await readdir(pluginDir, { withFileTypes: true }) } catch { continue }
      const versions = versionEntries.filter(d => d.isDirectory()).map(d => d.name).sort()
      if (versions.length === 0) continue
      const latest = versions[versions.length - 1]
      const skillsDir = join(pluginDir, latest, 'skills')
      let skills
      try { skills = await readdir(skillsDir, { withFileTypes: true }) } catch { continue }
      for (const skill of skills) {
        if (!skill.isDirectory()) continue
        const filePath = join(skillsDir, skill.name, SKILL_FILENAME)
        let text
        try { text = await readFile(filePath, 'utf8') } catch { continue }
        const { description } = parseFrontmatter(text)
        out.push({
          name: `${plugin.name}:${skill.name}`,
          description,
          filePath,
          plugin: plugin.name
        })
      }
    }
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

const NAME_INVALID_RE = /[^a-zA-Z0-9_-]/g

export function sanitizeSkillName(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, '-').replace(NAME_INVALID_RE, '').toLowerCase()
}

export async function createSkill(name, body, dir = getSkillsDir()) {
  const safe = sanitizeSkillName(name)
  if (safe.length === 0) return { ok: false, reason: 'invalid-name' }
  if (typeof body !== 'string') return { ok: false, reason: 'invalid-body' }
  const skillDir = join(dir, safe)
  const filePath = join(skillDir, SKILL_FILENAME)
  try {
    await mkdir(skillDir, { recursive: true })
  } catch (err) {
    return { ok: false, reason: 'denied', message: err?.message }
  }
  // Minimal frontmatter so subsequent listSkills() picks up the new entry with
  // a usable identity (description falls back to the first body line via
  // parseFrontmatter when no description is set).
  const content = `---\nname: ${safe}\n---\n${body}`
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
    return { ok: true, filePath, name: safe }
  } catch (err) {
    if (err?.code === 'EEXIST') return { ok: false, reason: 'exists', filePath }
    return { ok: false, reason: 'denied', message: err?.message }
  }
}

export function watchSkills(callback, dir = getSkillsDir()) {
  // Returns a disposer. The watcher tolerates a missing directory by polling
  // for its creation; once it exists we attach a real fs.watch.
  //
  // We watch recursively so that edits inside any <skill>/SKILL.md also fire —
  // not just adds/removes of the skill subdirectory itself. Windows + macOS
  // support recursive fs.watch natively; Linux requires Node 20+.
  let watcher = null
  let pollTimer = null
  let debounceTimer = null
  let disposed = false

  const fire = () => {
    if (disposed) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { if (!disposed) callback() }, 200)
  }

  const attach = () => {
    if (disposed || watcher) return
    try {
      watcher = nodeWatch(dir, { persistent: true, recursive: true }, () => fire())
      watcher.on('error', () => {
        try { watcher.close() } catch {}
        watcher = null
        if (!disposed) { clearTimeout(pollTimer); pollTimer = setTimeout(attach, 1000) }
      })
    } catch {
      watcher = null
      if (!disposed) { clearTimeout(pollTimer); pollTimer = setTimeout(attach, 1000) }
    }
  }

  if (existsSync(dir)) attach()
  else pollTimer = setInterval(() => { if (existsSync(dir)) { clearInterval(pollTimer); pollTimer = null; attach() } }, 1000)

  return () => {
    disposed = true
    clearTimeout(debounceTimer)
    clearInterval(pollTimer)
    clearTimeout(pollTimer)
    if (watcher) { try { watcher.close() } catch {} }
  }
}
