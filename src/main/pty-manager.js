import pty from 'node-pty'
import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { getCached } from './settings-store.js'

let claudeAvailable = null
function checkClaudeAvailable() {
  if (claudeAvailable !== null) return claudeAvailable
  try {
    execFileSync('where', ['claude.exe'], { stdio: 'ignore', windowsHide: true })
    claudeAvailable = true
  } catch {
    claudeAvailable = false
  }
  return claudeAvailable
}

export function isClaudeAvailable() {
  return checkClaudeAvailable()
}

let codexAvailable = null
function checkCodexAvailable() {
  if (codexAvailable !== null) return codexAvailable
  try {
    execFileSync('where', ['codex.exe'], { stdio: 'ignore', windowsHide: true })
    codexAvailable = true
  } catch {
    codexAvailable = false
  }
  return codexAvailable
}

export function isCodexAvailable() {
  return checkCodexAvailable()
}

function shellSpec(shell) {
  if (shell === 'cmd') return { file: 'cmd.exe', args: [] }
  if (shell === 'claude') {
    const skip = getCached().agents.dangerouslySkipPermissions
    const cmd = skip ? 'claude --dangerously-skip-permissions' : 'claude'
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  if (shell === 'codex') {
    const bypass = getCached().agents.codexDangerouslyBypassApprovals
    const cmd = bypass ? 'codex --dangerously-bypass-approvals-and-sandbox' : 'codex'
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  return { file: 'powershell.exe', args: [] }
}

const sessions = new Map()

export function createSession(shell = 'powershell', cwd, cols, rows) {
  const { file, args } = shellSpec(shell)
  const id = randomUUID()
  const skip = shell === 'claude' && getCached().agents.dangerouslySkipPermissions
  const env = skip
    ? { ...process.env, CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: '1' }
    : process.env
  const resolvedCwd = cwd || process.env.USERPROFILE || process.cwd()
  const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80
  const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24
  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: safeCols,
    rows: safeRows,
    cwd: resolvedCwd,
    env
  })

  if (shell === 'claude') {
    let trusted = false
    const disposable = proc.onData(data => {
      if (!trusted && data.includes('Yes, I trust this folder')) {
        trusted = true
        setTimeout(() => proc.write('\r'), 80)
        disposable.dispose()
      }
    })
  }

  proc._exited = false
  proc.onExit(() => { proc._exited = true })

  sessions.set(id, proc)
  return { id, proc }
}

export function writeSession(id, data) {
  const proc = sessions.get(id)
  if (!proc || proc._exited) return
  try { proc.write(data) } catch {}
}

export function resizeSession(id, cols, rows) {
  const proc = sessions.get(id)
  if (!proc || proc._exited) return
  try { proc.resize(cols, rows) } catch {}
}

export function killSession(id) {
  const proc = sessions.get(id)
  if (!proc) return
  sessions.delete(id)
  if (proc._exited) return
  proc._exited = true
  try {
    proc.kill()
  } catch {
    // node-pty's conpty cleanup on Windows can throw on stale consoles — ignore
  }
}

export function killAllSessions() {
  for (const id of Array.from(sessions.keys())) {
    killSession(id)
  }
}
