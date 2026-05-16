import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'workspaces.json'
const SCHEMA_VERSION = 2
const AGENT_COUNT_MAX = 8

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

const EMPTY = { workspaces: [], activeWorkspaceId: null }

let lastLoadCorruptBackup = null

export function consumeCorruptBackupNotice() {
  const path = lastLoadCorruptBackup
  lastLoadCorruptBackup = null
  return path
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${path}.corrupt-${ts}`
  try {
    await fs.rename(path, backup)
    lastLoadCorruptBackup = backup
  } catch {
    // best-effort — if rename fails, leave the file in place
  }
}

// Coerce any persisted shape (v1 `agentCount`, v2 `agentCounts`, garbage) into
// a clamped {claude, codex} object. Total can't exceed AGENT_COUNT_MAX —
// when truncation is required, Codex is dropped first so existing Claude
// workspaces never lose panes during the v1→v2 migration.
function sanitizeAgentCounts(w) {
  let claude = 0
  let codex  = 0
  if (w && w.agentCounts && typeof w.agentCounts === 'object') {
    if (Number.isFinite(w.agentCounts.claude)) claude = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCounts.claude)))
    if (Number.isFinite(w.agentCounts.codex))  codex  = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCounts.codex)))
  } else if (Number.isFinite(w?.agentCount)) {
    claude = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCount)))
  } else {
    claude = 2  // matches previous default
  }
  if (claude + codex > AGENT_COUNT_MAX) {
    codex = Math.max(0, AGENT_COUNT_MAX - claude)
  }
  return { claude, codex }
}

export async function loadWorkspaces() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY
    return EMPTY
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    return EMPTY
  }

  if (!parsed || !Array.isArray(parsed.workspaces)) {
    await quarantineCorrupt(path)
    return EMPTY
  }

  return {
    workspaces: parsed.workspaces.map(w => ({
      id: String(w.id),
      name: String(w.name ?? 'Workspace'),
      dir: String(w.dir ?? ''),
      agentCounts: sanitizeAgentCounts(w),
      isolated: !!w.isolated,
      editor: sanitizeEditor(w.editor)
    })),
    activeWorkspaceId: parsed.activeWorkspaceId ?? null
  }
}

function sanitizeEditor(e) {
  if (!e || typeof e !== 'object') return undefined
  return {
    open:  !!e.open,
    file:  typeof e.file === 'string' ? e.file : null,
    line:  Number.isFinite(e.line) ? e.line : null,
    width: Number.isFinite(e.width) ? e.width : 0
  }
}

export async function saveWorkspaces(state) {
  const safe = {
    version: SCHEMA_VERSION,
    workspaces: (state?.workspaces ?? []).map(w => ({
      id: w.id,
      name: w.name,
      dir: w.dir,
      agentCounts: sanitizeAgentCounts(w),
      isolated: !!w.isolated,
      editor: sanitizeEditor(w.editor)
    })),
    activeWorkspaceId: state?.activeWorkspaceId ?? null
  }
  const path = filePath()
  const tmp = `${path}.tmp`
  const data = JSON.stringify(safe, null, 2)
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, path)
}
