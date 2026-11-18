// Every isolated agent runs Claude in a brand-new folder, and Claude asks
// "Do you trust this folder?" for each one. The folder is CodeSpace's own copy
// of a repo the user already opened, so CodeSpace marks it trusted in Claude's
// settings file when it creates it, and removes the entry when the folder is
// deleted so the file doesn't fill up with dead agent folders.
//
// That file (~/.claude.json) is shared with every running Claude, so:
//  - only folders under a CodeSpace worktree root are ever added or removed;
//  - a file that doesn't parse is never written;
//  - the read-modify-write is one short synchronous step, and the write goes
//    to a temp file that is renamed over the original, so the file is never
//    left half-written.
// Everything here is best effort: a failure returns false and nothing else.
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export function claudeConfigPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
}

// Claude keys projects by folder with forward slashes ("D:/PC Backup/x").
export function projectKey(folder) {
  let k = String(folder).replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:/.test(k)) k = k[0].toUpperCase() + k.slice(1)
  return k
}

// worktree-manager puts agents under <parent>/.codespace-worktrees/<repo>/<id>
// (or the older <repo>/.codespace/worktrees/<id>). Nothing else is touched.
function isAgentFolder(key) {
  return /\/\.codespace-worktrees\/[^/]+\/[^/]+$/.test(key)
    || /\/\.codespace\/worktrees\/[^/]+$/.test(key)
}

function update(configPath, change) {
  let raw = null
  if (existsSync(configPath)) {
    try { raw = readFileSync(configPath, 'utf8') } catch { return false }
  }
  let data
  if (raw === null || raw.trim() === '') data = {}
  else {
    try { data = JSON.parse(raw) } catch { return false }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  }
  if (!data.projects || typeof data.projects !== 'object') data.projects = {}
  if (!change(data.projects)) return true // nothing to change: leave the file alone

  const tmp = configPath + '.cs-tmp'
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, configPath)
    return true
  } catch {
    try { unlinkSync(tmp) } catch {}
    return false
  }
}

export function trustFolder(folder, configPath = claudeConfigPath()) {
  const key = projectKey(folder)
  if (!isAgentFolder(key)) return false
  return update(configPath, (projects) => {
    const entry = projects[key] && typeof projects[key] === 'object' ? projects[key] : {}
    if (entry.hasTrustDialogAccepted === true) return false
    projects[key] = { ...entry, hasTrustDialogAccepted: true }
    return true
  })
}

export function forgetFolder(folder, configPath = claudeConfigPath()) {
  const key = projectKey(folder)
  if (!isAgentFolder(key)) return false
  return update(configPath, (projects) => {
    if (!(key in projects)) return false
    delete projects[key]
    return true
  })
}
