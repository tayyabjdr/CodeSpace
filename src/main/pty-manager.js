import pty from 'node-pty'
import { randomUUID } from 'crypto'

const SHELLS = {
  powershell: { file: 'powershell.exe', args: [] },
  cmd: { file: 'cmd.exe', args: [] },
  claude: { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', 'claude --dangerously-skip-permissions'] }
}

const sessions = new Map()

export function createSession(shell = 'powershell', cwd) {
  const { file, args } = SHELLS[shell] ?? SHELLS.powershell
  const id = randomUUID()
  const env = shell === 'claude'
    ? { ...process.env, CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: '1' }
    : process.env
  const resolvedCwd = cwd || process.env.USERPROFILE || process.cwd()
  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
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

  // Track exit so subsequent write/resize/kill calls are silent no-ops.
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
