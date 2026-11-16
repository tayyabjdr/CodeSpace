// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectPackageManager, detectCheck, runCheck, runInstall } from '../src/main/check-runner.js'

let root
let n = 0
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cs check ')) })
afterEach(() => { try { rmSync(root, { recursive: true, force: true }) } catch {} })

// A project folder whose name contains a space, with the given npm scripts.
function pkg(scripts, extraFiles = {}) {
  const dir = join(root, `with space ${n++}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }, null, 2))
  for (const [name, body] of Object.entries(extraFiles)) writeFileSync(join(dir, name), body)
  return dir
}
const logFor = (dir) => join(dir, 'logs', 'check log.txt')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)) }
  return false
}

describe('check-runner / detection', () => {
  it('detects the package manager from the lockfile, default npm', () => {
    expect(detectPackageManager(pkg({}))).toBe('npm')
    expect(detectPackageManager(pkg({}, { 'package-lock.json': '{}' }))).toBe('npm')
    expect(detectPackageManager(pkg({}, { 'pnpm-lock.yaml': '' }))).toBe('pnpm')
    expect(detectPackageManager(pkg({}, { 'yarn.lock': '' }))).toBe('yarn')
  })

  it('prefers test, skips the npm placeholder, falls back to build, else null', () => {
    expect(detectCheck(pkg({ test: 'vitest run', build: 'x' }))).toBe('test')
    expect(detectCheck(pkg({ test: 'echo "Error: no test specified" && exit 1', build: 'x' }))).toBe('build')
    expect(detectCheck(pkg({ dev: 'x' }))).toBe(null)
    const noPkg = join(root, 'no package here'); mkdirSync(noPkg)
    expect(detectCheck(noPkg)).toBe(null)
    const badPkg = join(root, 'bad package'); mkdirSync(badPkg)
    writeFileSync(join(badPkg, 'package.json'), '{ not json')
    expect(detectCheck(badPkg)).toBe(null)
  })
})

describe('check-runner / runCheck', () => {
  it('passes on exit 0', async () => {
    const cwd = pkg({ test: 'node -e "process.exit(0)"' })
    expect(await runCheck({ cwd, logPath: logFor(cwd) })).toEqual({ result: 'passed', script: 'test' })
  }, 60000)

  it('fails on a non-zero exit and logs the output, creating the log folder', async () => {
    const cwd = pkg({ test: 'node -e "console.log(123);console.error(456);process.exit(1)"' })
    const r = await runCheck({ cwd, logPath: logFor(cwd) })
    expect(r).toEqual({ result: 'failed', script: 'test' })
    const log = readFileSync(logFor(cwd), 'utf8')
    expect(log).toContain('123')
    expect(log).toContain('456')
  }, 60000)

  it('runs build when there is no real test script', async () => {
    const cwd = pkg({ build: 'node -e "process.exit(0)"' })
    expect(await runCheck({ cwd, logPath: logFor(cwd) })).toEqual({ result: 'passed', script: 'build' })
  }, 60000)

  it('reports none without running anything when there is no check', async () => {
    const cwd = pkg({ dev: 'x' })
    expect(await runCheck({ cwd, logPath: logFor(cwd) })).toEqual({ result: 'none', script: null })
  })

  it('sets CI=1', async () => {
    const cwd = pkg({ test: 'node -e "process.exit(process.env.CI === \'1\' ? 0 : 1)"' })
    expect((await runCheck({ cwd, logPath: logFor(cwd) })).result).toBe('passed')
  }, 60000)

  it('timeout kills the process tree', async () => {
    const cwd = pkg({ test: 'node -e "require(\'fs\').writeFileSync(\'pid.txt\', String(process.pid)); setTimeout(() => {}, 60000)"' })
    // Long enough for a cold npm start to write pid.txt on a slow machine.
    const r = await runCheck({ cwd, logPath: logFor(cwd), timeoutMs: 10000 })
    expect(r.result).toBe('timeout')
    const pid = Number(readFileSync(join(cwd, 'pid.txt'), 'utf8'))
    expect(await waitFor(() => !alive(pid))).toBe(true)
  }, 60000)

  it('abort signal gives cancelled and kills the tree', async () => {
    const cwd = pkg({ test: 'node -e "require(\'fs\').writeFileSync(\'pid.txt\', String(process.pid)); setTimeout(() => {}, 60000)"' })
    const ctl = new AbortController()
    const p = runCheck({ cwd, logPath: logFor(cwd), signal: ctl.signal })
    expect(await waitFor(() => existsSync(join(cwd, 'pid.txt')), 30000)).toBe(true)
    ctl.abort()
    const r = await p
    expect(r.result).toBe('cancelled')
    const pid = Number(readFileSync(join(cwd, 'pid.txt'), 'utf8'))
    expect(await waitFor(() => !alive(pid))).toBe(true)
  }, 60000)

  it('a planted npm.cmd in the project cannot fake a pass', async () => {
    // The Electron app does not set this, so emulate it: without it, cmd.exe
    // would run npm.cmd from the current folder ahead of the real npm.
    const saved = process.env.NoDefaultCurrentDirectoryInExePath
    delete process.env.NoDefaultCurrentDirectoryInExePath
    try {
      const cwd = pkg({ test: 'node -e "process.exit(1)"' }, { 'npm.cmd': '@exit /b 0\r\n' })
      expect((await runCheck({ cwd, logPath: logFor(cwd) })).result).toBe('failed')
    } finally {
      if (saved !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = saved
    }
  }, 60000)

  it('a process the check leaves running does not hold up or change the result', async () => {
    // The script starts a detached child that keeps the output pipes open for
    // 30s, then exits 0 itself.
    const cwd = pkg({ test: 'node orphan.js' }, {
      'orphan.js': [
        "const { spawn } = require('child_process')",
        "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'inherit' })",
        "require('fs').writeFileSync('orphan.pid', String(c.pid))",
        'c.unref()',
        'process.exit(0)'
      ].join('\n')
    })
    const started = Date.now()
    const r = await runCheck({ cwd, logPath: logFor(cwd), timeoutMs: 20000 })
    try {
      expect(r.result).toBe('passed')
      expect(Date.now() - started).toBeLessThan(15000)
    } finally {
      try { process.kill(Number(readFileSync(join(cwd, 'orphan.pid'), 'utf8'))) } catch {}
    }
  }, 60000)

  it('a log path it cannot write does not throw or change the result', async () => {
    const cwd = pkg({ test: 'node -e "process.exit(0)"' })
    const dirAsLog = join(cwd, 'a folder'); mkdirSync(dirAsLog)
    expect((await runCheck({ cwd, logPath: dirAsLog })).result).toBe('passed')
  }, 60000)

  it('an already-aborted signal runs nothing', async () => {
    const cwd = pkg({ test: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\', \'x\')"' })
    const ctl = new AbortController(); ctl.abort()
    expect((await runCheck({ cwd, logPath: logFor(cwd), signal: ctl.signal })).result).toBe('cancelled')
    expect(existsSync(join(cwd, 'ran.txt'))).toBe(false)
  })
})

describe('check-runner / runInstall', () => {
  it('runs npm ci in the folder and reports ok', async () => {
    const cwd = pkg({})
    writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: { '': { name: 'fixture', version: '1.0.0' } }
    }))
    expect(await runInstall({ cwd, logPath: logFor(cwd) })).toEqual({ ok: true })
  }, 120000)

  it('reports not ok when the install fails', async () => {
    const cwd = pkg({}) // npm ci with no lockfile fails
    expect(await runInstall({ cwd, logPath: logFor(cwd) })).toEqual({ ok: false })
  }, 120000)
})
