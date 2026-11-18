import { ipcMain, shell } from 'electron'
import { statSync } from 'fs'
import { isAbsolute, sep as PATH_SEP } from 'path'
import { createSession, writeSession, resizeSession, killSession, killAllAndWait, isClaudeAvailable, isCodexAvailable } from './pty-manager.js'
import * as editorFs from './editor-fs.js'
import * as autoNamer from './auto-namer.js'
import * as worktree from './worktree-manager.js'
import * as skillsFs from './skills-fs.js'
import { createMergeQueue } from './merge-queue.js'
import { runCheck, runInstall } from './check-runner.js'

import { PORT_MIN, PORT_MAX } from './worktree-setup.js'

const isPanePort = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX

function isValidCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  if (!isAbsolute(cwd)) return false
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

function assertAbsPath(p) {
  if (typeof p !== 'string' || !isAbsolute(p)) {
    throw new Error(`editor: path must be absolute, got: ${p}`)
  }
}

export function registerHandlers(mainWindow) {
  // ptyId -> [data-disposable, exit-disposable]
  const ptyDisposables = new Map()

  const windowAlive = () => !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()

  // One Finish queue for the app. Its status events go to the renderer as
  // they happen; there is no polling.
  const mergeQueue = createMergeQueue({
    runCheck,
    runInstall,
    onStatus: (status) => {
      if (windowAlive()) mainWindow.webContents.send('merge:status', status)
    }
  })

  // A reload (Ctrl+R, a dev full reload) starts a fresh page that knows
  // nothing about the PTYs the old page made. Left alone they keep running,
  // unseen, inside their agent folders, and Windows won't delete a folder a
  // process is sitting in, so the new page's cleanup reports "Couldn't be
  // removed". End them as the reload starts; folder cleanup waits for that.
  let reloadKill = Promise.resolve()
  mainWindow.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return
    for (const ptyId of Array.from(ptyDisposables.keys())) disposeFor(ptyId)
    reloadKill = killAllAndWait().catch(() => {})
  })

  function disposeFor(ptyId) {
    const disposables = ptyDisposables.get(ptyId)
    if (!disposables) return
    for (const d of disposables) {
      try { d?.dispose?.() } catch {}
    }
    ptyDisposables.delete(ptyId)
  }

  ipcMain.handle('pty:create', async (_event, { shell, cwd, cols, rows, port }) => {
    if (shell === 'claude' && !isClaudeAvailable()) {
      return { error: 'claude-missing' }
    }
    if (shell === 'codex' && !isCodexAvailable()) {
      return { error: 'codex-missing' }
    }
    const cwdValid = isValidCwd(cwd)
    if (cwd && !cwdValid) {
      return { error: 'cwd-missing', cwd }
    }
    const safeCwd = cwdValid ? cwd : undefined
    // Only a port from the isolated-pane range becomes PORT; the renderer
    // can't pass arbitrary environment through here.
    const extraEnv = isPanePort(port) ? { PORT: String(port) } : {}
    const { id, proc } = createSession(shell, safeCwd, cols, rows, extraEnv)

    const dataDisposable = proc.onData(data => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send(`pty:data:${id}`, data)
    })
    const exitDisposable = proc.onExit(({ exitCode }) => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`pty:exit:${id}`, exitCode)
      }
      disposeFor(id)
    })
    ptyDisposables.set(id, [dataDisposable, exitDisposable])

    return { ptyId: id }
  })

  ipcMain.on('pty:write', (_event, { ptyId, data }) => {
    writeSession(ptyId, data)
  })

  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => {
    resizeSession(ptyId, cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { ptyId }) => {
    disposeFor(ptyId)
    killSession(ptyId)
  })

  ipcMain.handle('agents:availability', () => ({
    claude: isClaudeAvailable(),
    codex:  isCodexAvailable()
  }))

  ipcMain.handle('editor:readFile',   async (_event, absPath) => { assertAbsPath(absPath); return editorFs.readFile(absPath) })
  ipcMain.handle('editor:writeFile',  async (_event, absPath, content) => { assertAbsPath(absPath); return editorFs.writeFile(absPath, content) })
  ipcMain.handle('editor:pathExists', async (_event, absPath) => { assertAbsPath(absPath); return editorFs.pathExists(absPath) })
  ipcMain.handle('editor:probe',      async (_event, absPath) => { assertAbsPath(absPath); return editorFs.probeFile(absPath) })
  ipcMain.on('editor:revealInFolder', (_event, absPath) => {
    try { shell.showItemInFolder(absPath) }
    catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[ipc] revealInFolder failed:', err)
      }
    }
  })

  // ── Skills (~/.claude/skills/<name>/SKILL.md, one subdir per skill) ─────
  let skillsWatcherDispose = null

  ipcMain.handle('skills:list',         async () => skillsFs.listSkills())
  ipcMain.handle('skills:listPlugins',  async () => skillsFs.listPluginSkills())
  ipcMain.handle('skills:read',  async (_e, absPath) => {
    if (typeof absPath !== 'string' || !isAbsolute(absPath)) return { ok: false, reason: 'invalid-path' }
    const userDir = skillsFs.getSkillsDir()
    const pluginDir = skillsFs.getPluginsCacheDir()
    if (!absPath.startsWith(userDir + PATH_SEP) && !absPath.startsWith(pluginDir + PATH_SEP)) {
      return { ok: false, reason: 'invalid-path' }
    }
    return skillsFs.readSkillBody(absPath)
  })
  ipcMain.handle('skills:create', async (_e, args) => {
    if (!args || typeof args.name !== 'string' || typeof args.body !== 'string') {
      return { ok: false, reason: 'invalid-args' }
    }
    return skillsFs.createSkill(args.name, args.body)
  })
  ipcMain.on('skills:revealDir', () => {
    shell.openPath(skillsFs.getSkillsDir()).then(err => {
      if (err && process.env.NODE_ENV !== 'production') {
        console.warn('[ipc] revealDir failed:', err)
      }
    }).catch(() => {})
  })

  ipcMain.on('skills:startWatch', () => {
    if (skillsWatcherDispose) return
    skillsWatcherDispose = skillsFs.watchSkills(() => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send('skills:changed')
    })
  })
  ipcMain.on('skills:stopWatch', () => {
    if (skillsWatcherDispose) {
      try { skillsWatcherDispose() } catch {}
      skillsWatcherDispose = null
    }
  })

  // Hand off http(s) URLs to the OS's default browser. We refuse anything that
  // isn't an http/https URL — file://, javascript:, etc. could expose local
  // resources or fire arbitrary code if a renderer ever sent a hostile string.
  ipcMain.on('shell:openExternal', (_event, url) => {
    if (typeof url !== 'string' || url.length > 2048) return
    if (!/^https?:\/\//i.test(url)) return
    shell.openExternal(url).catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[ipc] openExternal failed:', err)
      }
    })
  })

  // Open a local .html/.htm file with the OS's default handler (the browser).
  // Kept separate from shell:openExternal so the http(s)-only guard there
  // stays tight — this channel only accepts absolute paths to files that
  // both end in .html/.htm and actually exist.
  ipcMain.on('shell:openLocalHtml', async (_event, absPath) => {
    if (typeof absPath !== 'string' || absPath.length === 0 || absPath.length > 1024) return
    if (!/\.html?$/i.test(absPath)) return
    if (!isAbsolute(absPath)) return
    try {
      if (!statSync(absPath).isFile()) return
    } catch { return }
    const err = await shell.openPath(absPath)
    if (err && process.env.NODE_ENV !== 'production') {
      console.warn('[ipc] openLocalHtml failed:', err)
    }
  })

  ipcMain.handle('agentName:hasKey',    async () => autoNamer.hasKey())
  ipcMain.handle('agentName:summarize', async (_event, tail) => autoNamer.summarize(tail))

  ipcMain.handle('worktree:isGitAvailable', () => worktree.isGitAvailable())

  ipcMain.handle('worktree:isGitRepo', (_e, dir) => {
    if (typeof dir !== 'string' || !isAbsolute(dir)) return false
    return worktree.isGitRepo(dir)
  })

  ipcMain.handle('worktree:canIsolate', (_e, dir) => {
    if (typeof dir !== 'string' || !isAbsolute(dir)) return { ok: false, reason: 'not-a-repo' }
    return worktree.canIsolate(dir)
  })

  ipcMain.handle('worktree:create', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)
        || typeof args.workspaceName !== 'string' || typeof args.agentId !== 'string') {
      return { error: 'invalid-args' }
    }
    try { return await worktree.create(args) }
    catch (err) { return { error: err.code || 'unknown', detail: err.detail } }
  })

  ipcMain.handle('worktree:close', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || typeof args.agentId !== 'string') {
      return { error: 'invalid-args' }
    }
    // A Finish in flight for this agent stops first, so nothing lands from a
    // pane that is going away.
    try { mergeQueue.cancel(args.agentId) } catch {}
    try { return await worktree.close(args) }
    catch (err) { return { error: err.code || 'unknown' } }
  })

  ipcMain.handle('worktree:closeAll', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || !Array.isArray(args.agentIds)) {
      return { error: 'invalid-args' }
    }
    for (const id of args.agentIds) {
      if (typeof id === 'string') { try { mergeQueue.cancel(id) } catch {} }
    }
    try {
      const r = await worktree.closeAllForWorkspace(args)
      return { ok: true, failures: r?.failures ?? [] }
    }
    catch (err) { return { error: err.code || 'unknown' } }
  })

  // ── Finish (merge queue) ─────────────────────────────────────────────────
  const isAgentArgs = (a) => !!a && typeof a.repoDir === 'string' && isAbsolute(a.repoDir)
    && typeof a.agentId === 'string' && a.agentId.length > 0

  ipcMain.handle('merge:finish', (_e, args) => {
    if (!isAgentArgs(args)) return { error: 'invalid-args' }
    const agentName = typeof args.agentName === 'string' ? args.agentName : ''
    try { return mergeQueue.finish({ repoDir: args.repoDir, agentId: args.agentId, agentName }) }
    catch (err) { return { error: err?.code || 'unknown' } }
  })

  ipcMain.handle('merge:cancel', (_e, agentId) => {
    if (typeof agentId !== 'string' || !agentId) return { error: 'invalid-args' }
    try { mergeQueue.cancel(agentId); return { ok: true } }
    catch (err) { return { error: err?.code || 'unknown' } }
  })

  ipcMain.handle('merge:info', (_e, args) => {
    if (!isAgentArgs(args)) return { error: 'invalid-args' }
    try { return mergeQueue.info({ repoDir: args.repoDir, agentId: args.agentId }) }
    catch (err) { return { error: err?.code || 'unknown' } }
  })

  ipcMain.handle('worktree:checkDirty', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || typeof args.agentId !== 'string') {
      return { error: 'invalid-args' }
    }
    try { return await worktree.checkDirty(args) }
    catch (err) { return { error: err.code || 'unknown' } }
  })

  ipcMain.handle('worktree:wipeAll', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)) return { error: 'invalid-args' }
    try {
      await reloadKill
      const result = await worktree.wipeAll(args)
      return { ok: true, kept: result?.kept ?? [], stranded: result?.stranded ?? [] }
    }
    catch (err) { return { error: err.code || 'unknown' } }
  })

  ipcMain.handle('worktree:discard', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)) return { error: 'invalid-args' }
    const { repoDir, agentId, branch, liveAgentIds } = args
    if (agentId != null && typeof agentId !== 'string') return { error: 'invalid-args' }
    if (branch != null && typeof branch !== 'string') return { error: 'invalid-args' }
    if (!agentId && !branch) return { error: 'invalid-args' }
    try {
      await reloadKill
      return await worktree.discard({
        repoDir,
        agentId: agentId || undefined,
        branch: agentId ? undefined : branch,
        liveAgentIds: Array.isArray(liveAgentIds) ? liveAgentIds.filter(x => typeof x === 'string') : []
      })
    } catch (err) { return { ok: false, error: err.code || 'unknown' } }
  })

  // Opens a leftover agent's folder in Explorer. The path comes from the
  // repo's own agent list, never from the renderer.
  ipcMain.handle('worktree:openFolder', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || typeof args.agentId !== 'string') return { error: 'invalid-args' }
    try {
      const entry = worktree.readMeta(args.repoDir).agents[args.agentId]
      if (!entry) return { error: 'missing' }
      const p = worktree.entryWorktreePath(args.repoDir, args.agentId, entry)
      if (!statSync(p).isDirectory()) return { error: 'missing' }
      const err = await shell.openPath(p)
      return err ? { error: 'open-failed', detail: err } : { ok: true }
    } catch { return { error: 'missing' } }
  })

  ipcMain.handle('worktree:repairOrphans', async (_e, args) => {
    if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)) return { error: 'invalid-args' }
    try { await worktree.repairOrphans(args); return { ok: true } }
    catch (err) { return { error: err.code || 'unknown' } }
  })

  // If the renderer goes away (window close, devtools reload, crash) drop
  // every subscription so we don't post events into a destroyed webContents.
  mainWindow.webContents.on('destroyed', () => {
    if (skillsWatcherDispose) {
      try { skillsWatcherDispose() } catch {}
      skillsWatcherDispose = null
    }
    for (const ptyId of Array.from(ptyDisposables.keys())) {
      disposeFor(ptyId)
    }
  })
}
