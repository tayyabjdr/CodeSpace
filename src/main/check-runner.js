// Detects and runs a project's own check (its test script, else its build)
// inside an agent's worktree, and installs dependencies when asked.
//
// Windows only. The .cmd tools (npm, pnpm, yarn) go through
// cmd.exe /d /s /c with FIXED strings: the package manager comes from a
// fixed set and the script name is 'test' or 'build', so no path or user
// text is ever part of a command line. The folder goes in as `cwd`.

import { spawn } from 'child_process'
import { existsSync, readFileSync, mkdirSync, createWriteStream } from 'fs'
import { dirname, join } from 'path'

export const CHECK_TIMEOUT_MS = 600000
// After the shell exits, how long to wait for its output pipes to close. A
// process the check left running (a dev server, a watcher) can hold them open
// forever, and it must not hold up or change the result.
const PIPE_GRACE_MS = 2000
// After a kill, the longest we wait for the process to report back.
const KILL_DEADLINE_MS = 15000

// Absolute paths, never a bare name: Windows looks in the current folder
// first, so a cmd.exe or npm.cmd inside the project could stand in for the
// real one and fake a pass. NoDefaultCurrentDirectoryInExePath stops cmd.exe
// itself from finding npm.cmd in the project folder.
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'
const CMD_EXE = join(SYSTEM_ROOT, 'System32', 'cmd.exe')
const TASKKILL_EXE = join(SYSTEM_ROOT, 'System32', 'taskkill.exe')

const INSTALL_COMMANDS = {
  npm: 'npm ci',
  pnpm: 'pnpm install --frozen-lockfile',
  yarn: 'yarn install --frozen-lockfile'
}

export function detectPackageManager(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function readScripts(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {}
  } catch {
    return {}
  }
}

// npm init's placeholder test script fails on purpose; it isn't a check.
const isPlaceholderTest = (s) => /no test specified/i.test(s)

export function detectCheck(cwd) {
  const scripts = readScripts(cwd)
  const usable = (s) => typeof s === 'string' && s.trim().length > 0
  if (usable(scripts.test) && !isPlaceholderTest(scripts.test)) return 'test'
  if (usable(scripts.build)) return 'build'
  return null
}

// Kills the whole tree: cmd.exe -> npm -> cmd.exe -> the script's process.
function killTree(pid) {
  return new Promise(resolve => {
    if (!pid) return resolve()
    const k = spawn(TASKKILL_EXE, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    k.once('error', () => resolve())
    k.once('exit', () => resolve())
  })
}

// Runs one fixed command line in cwd, logging stdout and stderr to logPath.
// Always resolves (never rejects) to { outcome: 'exit' | 'timeout' |
// 'cancelled', code }.
function runLogged({ cwd, logPath, commandLine, timeoutMs, signal, env }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ outcome: 'cancelled', code: null })

    // Logging is best effort: a log we can't open or write must never crash
    // the main process or change the result.
    let log = null
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      log = createWriteStream(logPath, { flags: 'a' })
      log.on('error', () => { log = null })
    } catch { log = null }
    const write = (d) => { try { log?.write(d) } catch {} }
    write(`\n$ ${commandLine}  (${new Date().toISOString()})\n`)

    let child
    try {
      child = spawn(CMD_EXE, ['/d', '/s', '/c', commandLine], {
        cwd,
        env: { ...process.env, ...env, NoDefaultCurrentDirectoryInExePath: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      write(`\n[failed to start: ${e?.message ?? e}]\n`)
      const done = () => resolve({ outcome: 'exit', code: -1 })
      if (log) { try { log.end(done) } catch { done() } } else done()
      return
    }
    child.stdout.on('data', write)
    child.stderr.on('data', write)

    let settled = false
    let stopping = null // 'timeout' | 'cancelled'
    let exitCode = null
    const timers = []
    const finish = (result) => {
      if (settled) return
      settled = true
      for (const t of timers) clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
      try { child.stdout.destroy(); child.stderr.destroy() } catch {}
      const done = () => resolve(result)
      if (log) { try { log.end(done) } catch { done() } } else done()
    }
    const stop = (why) => {
      if (stopping || settled) return
      stopping = why
      write(`\n[${why}]\n`)
      killTree(child.pid)
      // If the process never reports back, give up waiting; the outcome is
      // already decided and is never 'passed'.
      timers.push(setTimeout(() => finish({ outcome: why, code: null }), KILL_DEADLINE_MS))
    }
    const onAbort = () => stop('cancelled')
    if (timeoutMs) timers.push(setTimeout(() => stop('timeout'), timeoutMs))
    signal?.addEventListener('abort', onAbort, { once: true })

    child.once('error', (e) => {
      write(`\n[failed to start: ${e?.message ?? e}]\n`)
      finish({ outcome: stopping ?? 'exit', code: -1 })
    })
    // The result is the shell's exit code. Don't wait on the pipes beyond a
    // short grace: something the check started may still be holding them.
    child.once('exit', (code) => {
      exitCode = code
      timers.push(setTimeout(() => finish({ outcome: stopping ?? 'exit', code: exitCode }), PIPE_GRACE_MS))
    })
    child.once('close', (code) => finish({ outcome: stopping ?? 'exit', code: exitCode ?? code }))
  })
}

export async function runCheck({ cwd, logPath, timeoutMs = CHECK_TIMEOUT_MS, signal }) {
  if (signal?.aborted) return { result: 'cancelled', script: detectCheck(cwd) }
  const script = detectCheck(cwd)
  if (!script) return { result: 'none', script: null }
  const pm = detectPackageManager(cwd)
  const r = await runLogged({
    cwd, logPath, timeoutMs, signal,
    commandLine: `${pm} run ${script}`,
    env: { CI: '1' }
  })
  if (r.outcome === 'timeout') return { result: 'timeout', script }
  if (r.outcome === 'cancelled') return { result: 'cancelled', script }
  return { result: r.code === 0 ? 'passed' : 'failed', script }
}

export async function runInstall({ cwd, logPath, signal }) {
  const pm = detectPackageManager(cwd)
  const r = await runLogged({
    cwd, logPath, signal,
    commandLine: INSTALL_COMMANDS[pm],
    timeoutMs: CHECK_TIMEOUT_MS,
    env: { CI: '1' }
  })
  return { ok: r.outcome === 'exit' && r.code === 0 }
}
