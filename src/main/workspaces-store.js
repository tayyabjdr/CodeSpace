import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'workspaces.json'

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
      agentCount: Number.isFinite(w.agentCount) ? Math.max(1, Math.min(8, w.agentCount)) : 2,
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
    workspaces: (state?.workspaces ?? []).map(w => ({
      id: w.id,
      name: w.name,
      dir: w.dir,
      agentCount: w.agentCount,
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
