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
    execFileSync('where', ['codex'], { stdio: 'ignore', windowsHide: true })
    codexAvailable = true
  } catch {
    codexAvailable = false
  }
  return codexAvailable
}

export function isCodexAvailable() {
  return checkCodexAvailable()
}

// An isolated agent has its own PORT in its environment, but Vite and other
// tools ignore that variable and Claude doesn't know it's there. This tells
// the agent to start dev servers on it. No apostrophes: it goes inside a
// single-quoted PowerShell string.
export function portPrompt(port) {
  return `This is an isolated CodeSpace agent. Its dev server port is ${port}, ` +
    `also in the PORT environment variable. Always start dev servers, previews ` +
    `and local servers on port ${port}. Many tools such as Vite ignore PORT, so ` +
    `pass the port explicitly, for example: npm run dev -- --port ${port} --strictPort. ` +
    `Never fall back to another port or to the default; if ${port} is busy, ` +
    `stop and say so. Other agents are using the other ports.`
}

const isPort = (p) => /^\d{1,5}$/.test(String(p ?? ''))

function shellSpec(shell, port) {
  if (shell === 'cmd') return { file: 'cmd.exe', args: [] }
  if (shell === 'claude') {
    const skip = getCached().agents.dangerouslySkipPermissions
    let cmd = skip ? 'claude --dangerously-skip-permissions' : 'claude'
    if (isPort(port)) cmd += ` --append-system-prompt '${portPrompt(port)}'`
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

// extraEnv: variables added on top of the inherited environment, e.g. the
// PORT an isolated pane gets. Callers validate it; this only merges.
export function createSession(shell = 'powershell', cwd, cols, rows, extraEnv = {}) {
  const { file, args } = shellSpec(shell, extraEnv.PORT)
  const id = randomUUID()
  const skip = shell === 'claude' && getCached().agents.dangerouslySkipPermissions
  const env = {
    ...process.env,
    ...(skip ? { CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: '1' } : {}),
    // Claude's fullscreen renderer owns its own scrollback and redraws all of
    // it on resize. The classic renderer can't: ConPTY only forwards the
    // visible rows of a repaint, so text above the viewport stays wrapped at
    // the old width. The user setting `"tui": "fullscreen"` does the same, but
    // Claude can auto-disable that after failed starts; the env var overrides.
    ...(shell === 'claude' ? { CLAUDE_CODE_NO_FLICKER: '1' } : {}),
    ...extraEnv
  }
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

// Kill every session and resolve once they have all exited (or timeoutMs
// passed), plus a short settle for conpty to let go of each folder. Kills are
// staggered: many conpty kills at once can seg-fault main on Windows. Used
// when the window reloads, so the new page's cleanup can delete agent folders
// these processes would otherwise still be sitting in.
export function killAllAndWait({ staggerMs = 80, timeoutMs = 3000, settleMs = 300 } = {}) {
  const ids = Array.from(sessions.keys())
  if (ids.length === 0) return Promise.resolve(0)
  const exits = ids.map((id, i) => new Promise((resolve) => {
    const proc = sessions.get(id)
    if (!proc || proc._exited) { sessions.delete(id); resolve(); return }
    try { proc.onExit(() => resolve()) } catch { resolve() }
    setTimeout(() => {
      killSession(id)
      // A proc that throws on kill may never report an exit; the timeout covers it.
    }, i * staggerMs)
  }))
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs + ids.length * staggerMs) })
  return Promise.race([Promise.all(exits), timeout])
    .then(() => { clearTimeout(timer); return new Promise(r => setTimeout(r, settleMs)) })
    .then(() => ids.length)
}
