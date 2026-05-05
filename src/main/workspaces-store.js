import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'workspaces.json'

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

const EMPTY = { workspaces: [], activeWorkspaceId: null }

export async function loadWorkspaces() {
  try {
    const raw = await fs.readFile(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.workspaces)) return EMPTY
    return {
      workspaces: parsed.workspaces.map(w => ({
        id: String(w.id),
        name: String(w.name ?? 'Workspace'),
        dir: String(w.dir ?? ''),
        agentCount: Number.isFinite(w.agentCount) ? Math.max(1, Math.min(8, w.agentCount)) : 2
      })),
      activeWorkspaceId: parsed.activeWorkspaceId ?? null
    }
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY
    return EMPTY
  }
}

export async function saveWorkspaces(state) {
  const safe = {
    workspaces: (state?.workspaces ?? []).map(w => ({
      id: w.id,
      name: w.name,
      dir: w.dir,
      agentCount: w.agentCount
    })),
    activeWorkspaceId: state?.activeWorkspaceId ?? null
  }
  await fs.writeFile(filePath(), JSON.stringify(safe, null, 2), 'utf8')
}
