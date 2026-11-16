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
    const k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    k.once('error', () => resolve())
    k.once('exit', () => resolve())
  })
}

// Runs one fixed command line in cwd, logging stdout and stderr to logPath.
// Resolves to 'exit' (with code), 'timeout' or 'cancelled'.
function runLogged({ cwd, logPath, commandLine, timeoutMs, signal, env }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ outcome: 'cancelled' })

    mkdirSync(dirname(logPath), { recursive: true })
    const log = createWriteStream(logPath, { flags: 'a' })
    log.write(`\n$ ${commandLine}  (${new Date().toISOString()})\n`)

    const child = spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', d => log.write(d))
    child.stderr.on('data', d => log.write(d))

    let settled = false
    let stopping = null // 'timeout' | 'cancelled'
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      log.end(() => resolve(result))
    }
    const stop = (why) => {
      if (stopping || settled) return
      stopping = why
      log.write(`\n[${why}]\n`)
      killTree(child.pid)
    }
    const onAbort = () => stop('cancelled')
    const timer = timeoutMs ? setTimeout(() => stop('timeout'), timeoutMs) : null
    signal?.addEventListener('abort', onAbort, { once: true })

    child.once('error', (e) => {
      log.write(`\n[failed to start: ${e?.message ?? e}]\n`)
      finish({ outcome: stopping ?? 'exit', code: -1 })
    })
    child.once('close', (code) => finish({ outcome: stopping ?? 'exit', code }))
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
