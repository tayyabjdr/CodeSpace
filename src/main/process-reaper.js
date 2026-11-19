// Stops processes still running out of an agent's folder before it is deleted.
//
// Killing a pane's PTY ends Claude, but not what Claude started in the
// background: a `next dev` launched from its Bash tool outlives it, its parent
// shells exit, and it is no longer anywhere under the PTY's process tree. It
// keeps files in the folder open (so the delete fails) and recreates its build
// folder right after. The only thing that still ties it to the agent is its
// command line, which names a file inside the agent's folder.
//
// Windows only. Absolute paths to powershell.exe / taskkill.exe for the same
// reason as check-runner.js. The folder is never put on a command line: the
// process list comes back as JSON and is matched here.

import { execFile } from 'child_process'
import { join } from 'path'

const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'
const POWERSHELL_EXE = join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const TASKKILL_EXE = join(SYSTEM_ROOT, 'System32', 'taskkill.exe')
const LIST_TIMEOUT_MS = 10000
const KILL_TIMEOUT_MS = 5000

const LIST_SCRIPT =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

async function defaultLister() {
  if (process.platform !== 'win32') return []
  const out = await run(POWERSHELL_EXE, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LIST_SCRIPT], LIST_TIMEOUT_MS)
  if (!out || !out.trim()) return []
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

async function defaultKiller(pid) {
  await run(TASKKILL_EXE, ['/PID', String(pid), '/T', '/F'], KILL_TIMEOUT_MS)
}

let lister = null
let killer = null

// Unit tests swap these in. Every other test runs with
// CODESPACE_DISABLE_PROCESS_REAPER set (tests/setup.js), which survives
// vi.resetModules(), so no test ever lists or kills a real process.
export function setProcessReaperImpl({ list, kill } = {}) {
  lister = list ?? null
  killer = kill ?? null
}

const norm = (s) => String(s).replace(/\//g, '\\').toLowerCase()

// Whether `text` names `dir` itself or something inside it. The character
// after the folder must end the name, so ...\abc never matches ...\abcd.
export function mentionsFolder(text, dir) {
  if (!text || !dir) return false
  const hay = norm(text)
  const needle = norm(dir).replace(/\\+$/, '')
  if (needle.length < 4) return false
  let i = hay.indexOf(needle)
  while (i !== -1) {
    const next = hay[i + needle.length]
    if (next === undefined || next === '\\' || next === '"' || next === "'" || /\s/.test(next)) return true
    i = hay.indexOf(needle, i + 1)
  }
  return false
}

// The processes to kill for `dir`: those whose executable or command line is
// inside it, minus this process and its parent. A match whose parent also
// matches is left out, since the tree kill of the parent takes it too.
export function processesUsing(list, dir, selfPids = [process.pid, process.ppid]) {
  const hits = list.filter(p =>
    p && Number.isInteger(p.ProcessId) && p.ProcessId > 0 && !selfPids.includes(p.ProcessId)
    && (mentionsFolder(p.ExecutablePath, dir) || mentionsFolder(p.CommandLine, dir)))
  const ids = new Set(hits.map(p => p.ProcessId))
  return hits.filter(p => !ids.has(p.ParentProcessId)).map(p => p.ProcessId)
}

// Kill everything still running out of `dir`. Never throws. Returns the PIDs
// it tried to kill.
export async function killProcessesIn(dir) {
  if (!lister && process.env.CODESPACE_DISABLE_PROCESS_REAPER) return []
  try {
    const pids = processesUsing(await (lister ?? defaultLister)(), dir)
    for (const pid of pids) {
      try { await (killer ?? defaultKiller)(pid) } catch {}
    }
    return pids
  } catch {
    return []
  }
}
