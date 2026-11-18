import { lazy, Suspense, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import Onboarding from './components/Onboarding.jsx'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import Sidebar from './components/Sidebar.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import LeftoverFoldersDialog from './components/LeftoverFoldersDialog.jsx'
import CloseConfirm from './components/CloseConfirm.jsx'
import EditorResizer from './components/EditorResizer.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import AgentTypePicker from './components/AgentTypePicker.jsx'
import EmptyWorkspaceSetup from './components/EmptyWorkspaceSetup.jsx'
import IsolationNotice from './components/IsolationNotice.jsx'
import LeftoverWorkNotice from './components/LeftoverWorkNotice.jsx'
import { isolationNotice, nextAgentCounter, mergeRetryFailures, closeFailureMessage, leftoverFromCloseAll } from './isolation-notice.js'
import SkillsPanel from './components/SkillsPanel.jsx'
import SkillsPanelResizer from './components/SkillsPanelResizer.jsx'
import { loadPanelWidth, savePanelWidth, clampPanelWidth, SKILLS_PANEL_DEFAULT_PX } from './skills-state.js'
import { initSettings, getSettings, subscribe as subscribeSettings } from './settings-store.js'
import { applyTheme, DEFAULT_THEME } from './theme.js'
import * as ptyPool from './pty-pool.js'
import * as doneTracker from './done-tracker.js'
import * as autoNamer from './auto-namer.js'
import * as ptyActivity from './pty-activity.js'
import { startMergeStatus, onMergeEvent, forgetStatus } from './merge-status.js'
import { startHandoffs } from './merge-handoff.js'
import { defaultEditorState, mergeEditor, EDITOR_DEFAULT_FRAC } from './editor-state.js'
import { checkOpenable } from './open-file.js'
import { basename } from './path-resolver.js'
import { focusSessionIn, withExpanded, liveAgentIdsFor } from './workspace-ops.js'
import { PERSIST_DEBOUNCE_MS, AGENT_TYPES } from './constants.js'
import useCloseGuard from './hooks/useCloseGuard.js'
import { gridShape, cellStyle } from './grid-layout.js'
import './design-tokens.css'
import './App.css'

const EditorPane = lazy(() => import('./components/EditorPane.jsx'))

const SIDEBAR_COLLAPSED_KEY = 'cs.sidebarCollapsed'

function isExternalToWorkspace(file, dir) {
  if (!file || !dir) return false
  return !file.toLowerCase().startsWith(dir.toLowerCase())
}

function makeId() {
  return crypto.randomUUID()
}

function countsToItems(counts) {
  const c = Math.max(0, Number(counts?.claude) || 0)
  const x = Math.max(0, Number(counts?.codex)  || 0)
  return [
    ...Array.from({ length: c }, () => ({ shell: 'claude' })),
    ...Array.from({ length: x }, () => ({ shell: 'codex'  }))
  ]
}

function BridgeMissing() {
  // Fail-closed diagnostic — preload bridge didn't load, so no IPC works.
  // Intentionally minimal; uses system fonts so it works without app CSS.
  const wrap = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
    background: '#0a0b0d', color: 'rgba(255,255,255,0.85)',
    fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '0 32px'
  }
  const dim = { color: 'rgba(255,255,255,0.55)', fontSize: 13, maxWidth: 460, lineHeight: 1.55 }
  return (
    <div style={wrap}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>CodeSpace can't reach its main process</div>
      <div style={dim}>
        The preload bridge failed to load. This usually means the app was launched
        outside Electron, or the build is corrupt. Try restarting; if the problem
        persists, reinstall.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8, padding: '8px 16px', borderRadius: 9,
          background: '#11151b', border: '1px solid #2b3038',
          color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13
        }}
      >
        Reload
      </button>
    </div>
  )
}

function closedEditorPatch(clearFile) {
  return clearFile
    ? { open: false, file: null, line: null, dirty: false, scroll: 0 }
    : { open: false }
}

export default function App() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return <BridgeMissing />
  }
  return (
    <>
      <AppInner />
      <UpdateToast />
    </>
  )
}

function AppInner() {
  const [loaded, setLoaded] = useState(false)
  const [workspaces, setWorkspaces] = useState([])
  const [activeId, setActiveId] = useState(null)
  // Session-only. Deliberately not persisted: terminals[] is lazily spawned,
  // so a restored "expanded" flag would open a chevron above an empty list.
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // A per-machine view preference, so browser storage is enough; it can be
  // unavailable, in which case the sidebar just starts open.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
  })
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  const toggleExpand = useCallback((wsId) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }, [])
  const [pendingDelete, setPendingDelete] = useState(null)
  // Dirty-close prompt for an isolated agent's worktree.
  // shape: { wsId, termId, branch, agentName }
  const [pendingWorktreeClose, setPendingWorktreeClose] = useState(null)
  const [leftoverFolders, setLeftoverFolders] = useState(null) // [{ agentId, path, detail }] from a failed workspace cleanup
  // Dirty-prompt: triggered when the user opens another file / closes the
  // editor / switches workspace while the active editor has unsaved changes.
  // shape: { kind: 'open-file' | 'close-pane' | 'switch-workspace', payload }
  const [pendingDirtyAction, setPendingDirtyAction] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availability, setAvailability] = useState({ claude: true, codex: true })
  const [pickerState, setPickerState] = useState(null) // null | { anchorRect: DOMRect|null }
  const [activePanel, setActivePanel] = useState(null) // null | 'skills'
  const [skillsLoadState, setSkillsLoadState] = useState('loading') // 'loading' | 'content' | 'error'
  const [skills, setSkills] = useState([])
  const [pluginSkills, setPluginSkills] = useState([])
  const [skillsPanelWidth, setSkillsPanelWidth] = useState(() => loadPanelWidth())

  const persistTimerRef = useRef(null)
  // No save may fire after the app has unmounted.
  useEffect(() => () => clearTimeout(persistTimerRef.current), [])
  const desktopPathRef = useRef('')

  const materializeAgents = useCallback(async (workspace, items, startNum) => {
    const agents = []
    const failures = []
    const warnings = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const id = makeId()
      let cwd = workspace.dir
      let branch = null
      let port = null
      if (workspace.isolated) {
        let r
        try {
          r = await window.electronAPI.worktree.create({
            repoDir: workspace.dir,
            workspaceName: workspace.name,
            agentId: id
          })
        } catch (err) {
          r = { error: 'unknown', detail: err?.message }
        }
        if (!r || r.error) {
          console.error('worktree.create failed', r)
          // Never fall back to the shared folder: surface it and let the user retry.
          failures.push({ item, error: r?.error ?? 'unknown', detail: r?.detail ?? r?.error ?? 'unknown error' })
          continue
        }
        cwd = r.path
        branch = r.branch
        port = Number.isInteger(r.port) ? r.port : null
        if (Array.isArray(r.warnings)) warnings.push(...r.warnings)
      }
      agents.push({
        id,
        shell: item.shell,
        agentNum: startNum + i,
        cwd, ptyId: null, autoName: null, branch, port
      })
    }
    return { agents, failures, warnings }
  }, [])

  // Load persisted workspaces + defaults on first mount.
  useEffect(() => {
    let cancelled = false
    applyTheme(DEFAULT_THEME)
    Promise.all([
      window.electronAPI.loadWorkspaces(),
      window.electronAPI.getDesktopPath(),
      initSettings()
    ]).then(([state, desktop]) => {
      if (cancelled) return
      applyTheme(getSettings().appearance?.theme)
      desktopPathRef.current = desktop || ''
      const restored = (state?.workspaces ?? []).map(w => ({
        ...w,
        agentCounts: w.agentCounts ?? { claude: w.agentCount ?? 0, codex: 0 },
        nickname: w.nickname ?? null,
        terminals: [],          // session-only — lazy spawn
        failures: [],           // session-only — failed worktree creates
        warnings: [],           // session-only — worktree setup warnings
        agentCounter: 0,
        focusedTerminalId: null,
        fullscreenPaneId: null,
        spawned: false,
        fontSize: getSettings().appearance.defaultPaneFontSize,
        editor: w.editor ? { ...defaultEditorState(), ...w.editor, dirty: false, scroll: 0 } : defaultEditorState()
      }))
      setWorkspaces(restored)
      setActiveId(state?.activeWorkspaceId ?? restored[0]?.id ?? null)
      setLoaded(true)
    }).catch((err) => {
      // A rejection here (loadWorkspaces/getDesktopPath/initSettings) must
      // still flip loaded, or the app is stuck on the `!loaded` null render
      // forever — and useCloseGuard ignores close requests until then, so
      // main's failsafe would be the only way out. Degrade to the empty
      // workspaces state instead of trapping the window.
      if (cancelled) return
      console.error('Failed to load persisted state', err)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.agents?.getAvailability?.().then(av => {
      if (cancelled || !av) return
      setAvailability(av)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // One-shot reconciliation: drop meta entries whose worktree dir was hand-deleted
  // since last run. Idempotent and silent on error.
  useEffect(() => {
    if (!loaded) return
    for (const w of workspaces) {
      if (!w.isolated) continue
      window.electronAPI.worktree.repairOrphans({ repoDir: w.dir }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // Persist (debounced) whenever workspace identity changes. Drafts
  // (`unconfigured: true`) are session-only — they don't survive a reload.
  useEffect(() => {
    if (!loaded) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      const persistable = workspaces.filter(w => !w.unconfigured)
      const activeIsDraft = workspaces.find(w => w.id === activeId)?.unconfigured
      window.electronAPI.saveWorkspaces({
        workspaces: persistable.map(w => {
          const claude = w.terminals.filter(t => t.shell === 'claude').length
          const codex  = w.terminals.filter(t => t.shell === 'codex').length
          const failed = w.failures ?? []
          const live = w.spawned
            ? {
                claude: claude + failed.filter(f => f.item?.shell === 'claude').length,
                codex: codex + failed.filter(f => f.item?.shell === 'codex').length
              }
            : (w.agentCounts ?? { claude: 0, codex: 0 })
          return {
            id: w.id, name: w.name, dir: w.dir,
            agentCounts: live,
            isolated: !!w.isolated,
            nickname: w.nickname ?? null,
            editor: w.editor ? { open: w.editor.open, file: w.editor.file, line: w.editor.line, width: w.editor.width } : undefined
          }
        }),
        activeWorkspaceId: activeIsDraft ? (persistable[0]?.id ?? null) : activeId
      })
    }, PERSIST_DEBOUNCE_MS)
  }, [workspaces, activeId, loaded])

  const activeWorkspace = workspaces.find(w => w.id === activeId) ?? null

  // Keep done-tracker and auto-namer subscriptions in sync with every live PTY
  // across every workspace. Tracking persists through workspace switches so a
  // hidden workspace's "done" notification still fires.
  useEffect(() => {
    if (!loaded) return
    const map = new Map()
    const pinned = new Set()
    for (const w of workspaces) {
      for (const t of (w.terminals ?? [])) {
        if (t.ptyId) map.set(t.id, t.ptyId)
        if (t.name && t.name.trim()) pinned.add(t.id)
      }
    }
    doneTracker.syncTracked(map)
    autoNamer.syncTracked(map, pinned)
    ptyActivity.syncTracked([...map.values()])
  }, [workspaces, loaded])

  // agentId -> { ptyId, shell } for the failure handoff, across every
  // workspace, so a hidden pane still hears about its failed Finish.
  const agentsByIdRef = useRef(new Map())
  useEffect(() => {
    const next = new Map()
    for (const w of workspaces) {
      for (const t of (w.terminals ?? [])) next.set(t.id, { ptyId: t.ptyId, shell: t.shell })
    }
    for (const id of agentsByIdRef.current.keys()) if (!next.has(id)) forgetStatus(id)
    agentsByIdRef.current = next
  }, [workspaces])

  // One merge-status subscription for the whole app; panes read from the store.
  useEffect(() => {
    const offStatus = startMergeStatus(window.electronAPI?.merge)
    const offHandoffs = startHandoffs({
      onMergeEvent,
      resolveAgent: (agentId) => agentsByIdRef.current.get(agentId) ?? null,
      lastOutputAt: ptyActivity.lastOutputAt,
      lastInputAt: ptyActivity.lastInputAt
    })
    const offWrites = ptyPool.onWrite((ptyId, data) => ptyActivity.noteWrite(ptyId, data))
    return () => { offWrites(); offHandoffs(); offStatus() }
  }, [])

  useEffect(() => {
    return autoNamer.subscribe((termId, name) => {
      setWorkspaces(prev => prev.map(w => {
        const idx = w.terminals.findIndex(t => t.id === termId)
        if (idx === -1) return w
        const t = w.terminals[idx]
        if (t.autoName === name) return w
        const next = [...w.terminals]
        next[idx] = { ...t, autoName: name }
        return { ...w, terminals: next }
      }))
    })
  }, [])

  // Live-repaint when the user switches themes in Settings.
  useEffect(() => {
    return subscribeSettings((s) => applyTheme(s.appearance?.theme))
  }, [])

  // A terminal counts as "attended" only if it's the focused pane in the
  // currently-active workspace AND the OS window has focus. Without the
  // hasFocus() gate, alt-tabbing to another app would suppress the chirp
  // for the last-clicked pane (the user can't see it, so they need to hear it).
  useEffect(() => {
    doneTracker.setAttendedCheck(termId => {
      if (!activeWorkspace) return false
      if (!document.hasFocus()) return false
      return activeWorkspace.focusedTerminalId === termId
    })
  }, [activeWorkspace])

  // When the user comes back to the app, clear the cyan dot on the pane they
  // were last looking at — same effect as clicking back into the pane.
  useEffect(() => {
    const onFocus = () => {
      const id = activeWorkspace?.focusedTerminalId
      if (id) doneTracker.noteFocus(id)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [activeWorkspace])

  const doneTermIds = useSyncExternalStore(doneTracker.subscribe, doneTracker.getDoneTermIds)
  const exitedPtyIds = useSyncExternalStore(ptyPool.subscribeExits, ptyPool.getExitedPtyIds)

  const themeId = useSyncExternalStore(
    subscribeSettings,
    () => getSettings().appearance?.theme || DEFAULT_THEME
  )

  // Lazy-spawn terminals when a workspace becomes active for the first time.
  // Depend only on activeId so identity churn on `workspaces` doesn't re-fire.
  // Drafts (`unconfigured`) skip spawn — handleInitializeDraft does it inline.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    ;(async () => {
      const w0 = workspaces.find(x => x.id === activeId)
      if (!w0 || w0.spawned || w0.unconfigured) return
      if (w0.isolated) {
        // Last session's worktrees are orphans now — agent UUIDs are session-only.
        // Wipe them; branches with commits survive. Dirty worktrees (uncommitted
        // work, e.g. the user lost power last session) are preserved on disk
        // and surfaced here so the work isn't silently destroyed.
        // Every workspace on this repo may already have live agents; never wipe those.
        // Paths are compared normalised: D:/x and d:/x/ are one folder.
        const liveAgentIds = liveAgentIdsFor(workspaces, w0.dir)
        try {
          const r = await window.electronAPI.worktree.wipeAll({ repoDir: w0.dir, liveAgentIds })
          const kept = Array.isArray(r?.kept) ? r.kept : []
          const stranded = Array.isArray(r?.stranded) ? r.stranded : []
          if (kept.length || stranded.length) {
            setLeftovers(prev => ({ ...prev, [w0.dir]: { kept, stranded } }))
          }
        } catch {}
        if (cancelled) return
      }
      const items = countsToItems(w0.agentCounts)
      const { agents: terminals, failures, warnings } = await materializeAgents(w0, items, 1)
      if (cancelled) return
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== activeId || w.spawned) return w
        return {
          ...w,
          terminals,
          failures,
          warnings,
          agentCounter: items.length,
          spawned: true,
          focusedTerminalId: terminals[0]?.id ?? null
        }
      }))
      setExpandedIds(prev => withExpanded(prev, activeId))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, materializeAgents])

  const handleOnboardingLaunch = useCallback((counts, dir, name, isolated) => {
    const resolvedName = (name && name.trim())
      || dir.split(/[\\/]/).filter(Boolean).pop()
      || 'Workspace'
    const ws = {
      id: makeId(),
      name: resolvedName,
      dir,
      agentCounts: counts,
      isolated: !!isolated,
      nickname: null,
      terminals: [],
      agentCounter: 0,
      focusedTerminalId: null,
      fullscreenPaneId: null,
      spawned: false,
      fontSize: getSettings().appearance.defaultPaneFontSize,
      editor: defaultEditorState()
    }
    setWorkspaces([ws])
    setActiveId(ws.id)
  }, [])

  // Click "+" in the sidebar → create a *draft* workspace (unconfigured).
  // The draft renders the embedded onboarding form in place of terminals
  // until the user hits Initialize. Drafts don't persist across reload.
  const handleStartDraft = useCallback(() => {
    const ws = {
      id: makeId(),
      name: 'New Workspace',
      dir: '',
      agentCounts: { claude: 0, codex: 0 },
      nickname: null,
      terminals: [],
      agentCounter: 0,
      focusedTerminalId: null,
      fullscreenPaneId: null,
      spawned: false,
      fontSize: getSettings().appearance.defaultPaneFontSize,
      editor: defaultEditorState(),
      unconfigured: true
    }
    setWorkspaces(prev => [...prev, ws])
    setActiveId(ws.id)
  }, [])

  // Initialize a draft → real workspace. Sets identity, spawns terminals,
  // and clears the unconfigured flag in a single state update so persistence
  // and lazy-spawn see a consistent post-init state.
  const handleInitializeDraft = useCallback(async (counts, dir, name, isolated) => {
    const resolvedName = (name && name.trim()) || 'New Workspace'
    const draft = workspaces.find(w => w.id === activeId && w.unconfigured)
    if (!draft) return
    const provisional = { ...draft, name: resolvedName, dir, agentCounts: counts, isolated: !!isolated }
    const items = countsToItems(counts)
    const { agents: terminals, failures, warnings } = await materializeAgents(provisional, items, 1)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || !w.unconfigured) return w
      return {
        ...w,
        name: resolvedName,
        dir,
        agentCounts: counts,
        isolated: !!isolated,
        terminals,
        failures,
        warnings,
        agentCounter: items.length,
        spawned: true,
        focusedTerminalId: terminals[0]?.id ?? null,
        unconfigured: false
      }
    }))
    setExpandedIds(prev => withExpanded(prev, activeId))
  }, [activeId, workspaces, materializeAgents])

  // Discard a draft → remove it from the list. If it was active, fall back
  // to the next available real workspace (or null → standalone Onboarding).
  const handleDiscardDraft = useCallback(() => {
    setWorkspaces(prev => {
      const next = prev.filter(w => !(w.id === activeId && w.unconfigured))
      if (next.length === prev.length) return prev
      setActiveId(next[0]?.id ?? null)
      return next
    })
  }, [activeId])

  // Live-sync the typed workspace name from the embedded onboarding form
  // up to the workspace record so the sidebar label updates as the user types.
  const handleDraftNameChange = useCallback((name) => {
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || !w.unconfigured) return w
      const display = name.trim() ? name : 'New Workspace'
      if (w.name === display) return w
      return { ...w, name: display }
    }))
  }, [activeId])

  const handleDeleteWorkspace = useCallback((wsId) => {
    setPendingDelete(wsId)
  }, [])

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    const wsId = pendingDelete
    if (!wsId) return
    const target = workspaces.find(w => w.id === wsId)
    const nextWorkspaces = workspaces.filter(w => w.id !== wsId)
    const nextActiveId = activeId === wsId ? (nextWorkspaces[0]?.id ?? null) : activeId

    // Persist deletion FIRST, before any PTY teardown that could crash native code.
    window.electronAPI.saveWorkspaces({
      workspaces: nextWorkspaces.map(w => {
        const claude = w.terminals.filter(t => t.shell === 'claude').length
        const codex  = w.terminals.filter(t => t.shell === 'codex').length
        const live = w.spawned ? { claude, codex } : (w.agentCounts ?? { claude: 0, codex: 0 })
        return {
          id: w.id, name: w.name, dir: w.dir,
          agentCounts: live,
          isolated: !!w.isolated,
          nickname: w.nickname ?? null,
          editor: w.editor ? { open: w.editor.open, file: w.editor.file, line: w.editor.line, width: w.editor.width } : undefined
        }
      }),
      activeWorkspaceId: nextActiveId
    })

    setWorkspaces(nextWorkspaces)
    setActiveId(nextActiveId)
    setPendingDelete(null)

    // Now kill PTYs. Even if conpty seg-faults, persistence is already on disk.
    // Stagger the kills — node-pty's conpty subsystem on Windows can throw a
    // CRT assertion (remove_pty_baton) when multiple PTYs are torn down in
    // the same tick. The dialog is unrecoverable and bypasses try/catch.
    // Cancellation of in-flight creates is fire-and-forget (no native call).
    if (target) {
      const live = []
      for (const t of (target.terminals ?? [])) {
        if (t.ptyId) live.push(t.ptyId)
        else {
          try { ptyPool.cancelCreate(t.id) } catch {}
        }
      }
      live.forEach((ptyId, i) => {
        setTimeout(() => {
          try { ptyPool.killPty(ptyId) } catch {}
        }, i * 80)
      })

      // Released-then-cleanup ordering: PTY kills first (so files are released),
      // then ask main to clean up all worktrees + branches in one call.
      if (target.isolated) {
        const agentIds = (target.terminals ?? []).map(t => t.id)
        setTimeout(() => {
          window.electronAPI.worktree.closeAll({ repoDir: target.dir, agentIds })
            .then(r => { const left = leftoverFromCloseAll(r); if (left.length) setLeftoverFolders(left) })
            .catch(err => console.error('worktree.closeAll failed', err))
        }, agentIds.length * 80 + 100)
      }
    }
  }, [pendingDelete, workspaces, activeId])

  const pendingDeleteWorkspace = pendingDelete
    ? workspaces.find(w => w.id === pendingDelete)
    : null

  const handleSelectWorkspace = useCallback((wsId) => {
    if (activeWorkspace?.editor?.dirty) {
      setPendingDirtyAction({ kind: 'switch-workspace', payload: { wsId } })
      return
    }
    setActiveId(wsId)
  }, [activeWorkspace])

  // focusSessionIn targets wsId explicitly. Do NOT reach for setFocusedId /
  // updateActive here — they close over the outgoing activeId and would
  // write the focus onto the workspace being navigated away from.
  const handleSelectSession = useCallback((wsId, termId) => {
    if (activeWorkspace?.editor?.dirty) {
      setPendingDirtyAction({ kind: 'switch-workspace', payload: { wsId, termId } })
      return
    }
    setWorkspaces(prev => focusSessionIn(prev, wsId, termId))
    setActiveId(wsId)
    setExpandedIds(prev => withExpanded(prev, wsId))
  }, [activeWorkspace])

  const handleRenameNickname = useCallback((wsId, value) => {
    // Trim → empty becomes null (clears the nickname); clamp at 40 chars on save.
    // Sanitization in workspaces-store is the source of truth; this is a defensive trim.
    const trimmed = typeof value === 'string' ? value.trim() : ''
    const next = trimmed.length === 0 ? null : trimmed.slice(0, 40)
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, nickname: next } : w))
  }, [])

  const updateActive = useCallback((updater) => {
    setWorkspaces(prev => prev.map(w => w.id === activeId ? updater(w) : w))
  }, [activeId])

  const addAgent = useCallback(async (shell = 'claude') => {
    if (!activeId) return
    const w = workspaces.find(x => x.id === activeId)
    // Not before the restored agents spawn: the spawn would then replace the
    // terminal list, and until it does the sidebar and saved counts ignore it.
    if (!w || w.unconfigured || !w.spawned) return
    if (!AGENT_TYPES.includes(shell)) return
    if (!availability[shell]) return
    const nextNum = w.agentCounter + 1
    const { agents: [agent], failures, warnings } = await materializeAgents(w, [{ shell }], nextNum)
    if (!agent && failures.length === 0) return
    setWorkspaces(prev => prev.map(x => x.id === activeId ? {
      ...x,
      agentCounter: Math.max(x.agentCounter, nextNum),
      terminals: agent ? [...x.terminals, agent] : x.terminals,
      failures: [...(x.failures ?? []), ...failures],
      warnings: [...(x.warnings ?? []), ...warnings]
    } : x))
  }, [activeId, workspaces, materializeAgents, availability])

  const addAgents = useCallback(async (counts) => {
    if (!activeId) return
    const w = workspaces.find(x => x.id === activeId)
    if (!w || w.unconfigured || !w.spawned) return
    const items = []
    for (const shell of AGENT_TYPES) {
      const n = Math.max(0, Number(counts?.[shell]) || 0)
      if (availability[shell]) {
        for (let i = 0; i < n; i++) items.push({ shell })
      }
    }
    if (items.length === 0) return
    const startNum = w.agentCounter + 1
    const { agents: newAgents, failures, warnings } = await materializeAgents(w, items, startNum)
    if (newAgents.length === 0 && failures.length === 0) return
    setWorkspaces(prev => prev.map(x => x.id === activeId ? {
      ...x,
      agentCounter: nextAgentCounter(x.agentCounter, startNum, items.length),
      terminals: [...x.terminals, ...newAgents],
      failures: [...(x.failures ?? []), ...failures],
      warnings: [...(x.warnings ?? []), ...warnings]
    } : x))
  }, [activeId, workspaces, materializeAgents, availability])

  // Switch a workspace between shared and separate folders. Only allowed with
  // no live agents; it never spawns, agents added afterwards use the new mode.
  const setWorkspaceIsolated = useCallback((wsId, isolated) => {
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId || w.unconfigured) return w
      if ((w.terminals?.length ?? 0) > 0) return w
      if (!!w.isolated === !!isolated) return w
      return { ...w, isolated: !!isolated, failures: [], warnings: [] }
    }))
  }, [])

  const retryingRef = useRef(new Set())
  const [retryingId, setRetryingId] = useState(null)
  // Retry only the failed items; successes join the same workspace.
  const retryFailures = useCallback(async () => {
    if (!activeId) return
    const w = workspaces.find(x => x.id === activeId)
    const failed = w?.failures ?? []
    if (!w || failed.length === 0) return
    if (retryingRef.current.has(activeId)) return
    retryingRef.current.add(activeId)
    setRetryingId(activeId)
    const wsId = activeId
    try {
      const startNum = w.agentCounter + 1
      const { agents, failures, warnings } = await materializeAgents(w, failed.map(f => f.item), startNum)
      setWorkspaces(prev => prev.map(x => x.id === wsId ? {
        ...x,
        agentCounter: nextAgentCounter(x.agentCounter, startNum, failed.length),
        terminals: [...x.terminals, ...agents],
        failures: mergeRetryFailures(x.failures, failed, failures),
        warnings: [...(x.warnings ?? []), ...warnings],
        focusedTerminalId: x.focusedTerminalId ?? agents[0]?.id ?? null
      } : x))
    } finally {
      retryingRef.current.delete(wsId)
      setRetryingId(prev => (prev === wsId ? null : prev))
    }
  }, [activeId, workspaces, materializeAgents])

  // Eligibility of the active workspace's folder, checked when its id/dir
  // changes and only while it is not isolated. Never polled.
  const [canIsoState, setCanIsoState] = useState(null) // { key, result }
  const [dismissedNotices, setDismissedNotices] = useState(() => new Set())
  // repoDir -> { kept, stranded } from the start-of-session wipe; session-only.
  const [leftovers, setLeftovers] = useState({})
  const [pendingDiscard, setPendingDiscard] = useState(null) // { dir, row }
  const isoProbe = (() => {
    const w = workspaces.find(x => x.id === activeId)
    return w && !w.unconfigured && !w.isolated && w.dir ? { id: w.id, dir: w.dir } : null
  })()
  const isoProbeKey = isoProbe ? `${isoProbe.id}|${isoProbe.dir}` : null
  useEffect(() => {
    if (!isoProbe || !window.electronAPI?.worktree?.canIsolate) return
    let cancelled = false
    Promise.resolve(window.electronAPI.worktree.canIsolate(isoProbe.dir))
      .then(result => { if (!cancelled && result) setCanIsoState({ key: isoProbeKey, result }) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoProbeKey])

  const openPicker = useCallback((anchor) => {
    if (!anchor) { setPickerState({ pos: null }); return }
    // TerminalPane passes { btnRect, paneRect }; other callers pass a DOM element.
    if (anchor.btnRect && anchor.paneRect) {
      setPickerState({ pos: {
        top:   anchor.btnRect.bottom + 6,
        right: window.innerWidth - anchor.paneRect.right + 8
      }})
    } else {
      const r = anchor.getBoundingClientRect?.()
      setPickerState({ pos: r ? { top: r.bottom + 6, right: window.innerWidth - r.right } : null })
    }
  }, [])
  const closePicker = useCallback(() => setPickerState(null), [])
  const handlePickAgent = useCallback((counts) => {
    addAgents(counts)
  }, [addAgents])
  const handleSelectPanel = useCallback((panelId) => {
    setActivePanel(prev => prev === panelId ? null : panelId)
  }, [])

  const handleCloseSettings = useCallback(() => setSettingsOpen(false), [])

  const handleSkillsResize = useCallback((px) => {
    setSkillsPanelWidth(clampPanelWidth(px, bodyWidthRef.current || 1400))
  }, [])
  const handleSkillsResizeEnd = useCallback(() => {
    savePanelWidth(skillsPanelWidth)
  }, [skillsPanelWidth])
  const handleSkillsResetWidth = useCallback(() => {
    const px = clampPanelWidth(SKILLS_PANEL_DEFAULT_PX, bodyWidthRef.current || 1400)
    setSkillsPanelWidth(px)
    savePanelWidth(px)
  }, [])

  // Load both user + plugin skills while the Skills panel is open. The user
  // dir is watched for hot reload; plugin skills are re-read on the same tick
  // because they change only when a plugin is installed/removed, which is rare
  // and acceptable to refresh by closing + reopening the panel.
  useEffect(() => {
    if (activePanel !== 'skills') return
    let cancelled = false
    const attachBodies = async (list) => Promise.all(list.map(async s => {
      const b = await window.electronAPI.skills.read(s.filePath).catch(() => ({ ok: false }))
      return { ...s, body: b?.ok ? b.body : '' }
    }))
    const load = () => {
      setSkillsLoadState(prev => (prev === 'content' ? prev : 'loading'))
      Promise.all([
        window.electronAPI.skills.list(),
        window.electronAPI.skills.listPlugins(),
      ]).then(async ([userR, pluginR]) => {
        if (cancelled) return
        if (!userR?.ok && !pluginR?.ok) {
          setSkills([]); setPluginSkills([]); setSkillsLoadState('error'); return
        }
        const [userBodies, pluginBodies] = await Promise.all([
          attachBodies(userR?.ok ? userR.skills : []),
          attachBodies(pluginR?.ok ? pluginR.skills : []),
        ])
        if (cancelled) return
        setSkills(userBodies)
        setPluginSkills(pluginBodies)
        setSkillsLoadState('content')
      }).catch(() => {
        if (!cancelled) { setSkills([]); setPluginSkills([]); setSkillsLoadState('error') }
      })
    }
    load()
    window.electronAPI.skills.startWatch()
    const off = window.electronAPI.skills.onChanged(load)
    return () => {
      cancelled = true
      off()
      window.electronAPI.skills.stopWatch()
    }
  }, [activePanel])

  const finalizeTerminalRemoval = useCallback((w, target) => {
    if (target.ptyId) ptyPool.killPty(target.ptyId)
    else ptyPool.cancelCreate(target.id)

    if (w.isolated) {
      // Fire-and-forget; main is single-writer and tolerates errors.
      window.electronAPI.worktree.close({ repoDir: w.dir, agentId: target.id })
        .then(r => {
          const msg = closeFailureMessage(r)
          if (msg) {
            // A new warning must be seen even if an earlier one was dismissed.
            setDismissedNotices(prev => { const n = new Set(prev); n.delete(w.id); return n })
            setWorkspaces(prev => prev.map(x => x.id === w.id ? { ...x, warnings: [...(x.warnings ?? []), msg] } : x))
          }
        })
        .catch(err => console.error('worktree.close failed', err))
    }

    setWorkspaces(prev => prev.map(x => {
      if (x.id !== w.id) return x
      const remaining = x.terminals
        .filter(t => t.id !== target.id)
        .map((t, i) => ({ ...t, agentNum: i + 1 }))
      return {
        ...x,
        terminals: remaining,
        agentCounter: remaining.length,
        focusedTerminalId: x.focusedTerminalId === target.id ? null : x.focusedTerminalId,
        fullscreenPaneId: x.fullscreenPaneId === target.id ? null : x.fullscreenPaneId
      }
    }))
  }, [])

  const removeTerminal = useCallback(async (termId) => {
    const w = workspaces.find(x => x.id === activeId)
    if (!w) return
    const target = w.terminals.find(t => t.id === termId)
    if (!target) return

    if (w.isolated) {
      // Peek dirty status before tearing anything down.
      const peek = await window.electronAPI.worktree.checkDirty({ repoDir: w.dir, agentId: termId })
      if (peek?.dirty) {
        setPendingWorktreeClose({
          wsId: w.id, termId, branch: target.branch,
          agentName: target.name || target.autoName || `Agent ${target.agentNum}`
        })
        return
      }
    }

    finalizeTerminalRemoval(w, target)
  }, [activeId, workspaces, finalizeTerminalRemoval])

  const setFocusedId = useCallback((termId) => {
    updateActive(w => ({ ...w, focusedTerminalId: termId }))
  }, [updateActive])

  const renameTerminal = useCallback((termId, name) => {
    updateActive(w => ({
      ...w,
      terminals: w.terminals.map(t => t.id === termId ? { ...t, name } : t)
    }))
  }, [updateActive])

  // Fullscreen toggle — fullscreenPaneId is either a terminal id, 'editor', or null.
  // Clicking the same id again clears it; clicking a different one swaps to it.
  const toggleFullscreen = useCallback((paneId) => {
    updateActive(w => ({
      ...w,
      fullscreenPaneId: w.fullscreenPaneId === paneId ? null : paneId
    }))
  }, [updateActive])

  const swapTerminals = useCallback((idA, idB) => {
    if (!idA || !idB || idA === idB) return
    updateActive(w => {
      const arr = [...w.terminals]
      const ai = arr.findIndex(t => t.id === idA)
      const bi = arr.findIndex(t => t.id === idB)
      if (ai === -1 || bi === -1) return w
      ;[arr[ai], arr[bi]] = [arr[bi], arr[ai]]
      return { ...w, terminals: arr }
    })
  }, [updateActive])

  const adjustFontSize = useCallback((step) => {
    updateActive(w => {
      const cur = w.fontSize ?? 13
      const next = Math.max(8, Math.min(28, cur + step))
      return next === cur ? w : { ...w, fontSize: next }
    })
  }, [updateActive])

  // When a TerminalPane creates a new PTY, store the id on the terminal so
  // it survives unmount (workspace switches) and can be re-attached later.
  // Only the active workspace owns mounted panes, so scope the search there.
  const handlePtyReady = useCallback((termId, ptyId) => {
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId) return w
      let changed = false
      const terminals = w.terminals.map(t => {
        if (t.id !== termId) return t
        changed = true
        return { ...t, ptyId }
      })
      return changed ? { ...w, terminals } : w
    }))
  }, [activeId])

  // ── Editor pane state ───────────────────────────────────────────────────
  const setEditorPatch = useCallback((patch) => {
    updateActive(w => ({ ...w, editor: mergeEditor(w.editor ?? defaultEditorState(), patch) }))
  }, [updateActive])

  const setEditorWidth  = useCallback((width)  => setEditorPatch({ width }),  [setEditorPatch])
  const setEditorDirty  = useCallback((dirty)  => setEditorPatch({ dirty }),  [setEditorPatch])
  const setEditorScroll = useCallback((scroll) => setEditorPatch({ scroll }), [setEditorPatch])

  const openFileImmediate = useCallback(({ path, line }) => {
    setEditorPatch({ open: true, file: path, line: line ?? null, dirty: false })
  }, [setEditorPatch])

  const openFileInEditor = useCallback(({ path, line }) => {
    const ed = activeWorkspace?.editor
    if (ed?.dirty && ed?.file && ed.file !== path) {
      setPendingDirtyAction({ kind: 'open-file', payload: { path, line } })
      return
    }
    openFileImmediate({ path, line })
  }, [activeWorkspace, openFileImmediate])

  // Two ways to put the editor away. The toolbar icon and Ctrl+E only hide
  // it, so toggling it back shows the same file. The pane's own × closes the
  // file too (`clearFile`), so reopening starts on the empty state.
  const closeEditor = useCallback(({ clearFile = false } = {}) => {
    if (activeWorkspace?.editor?.dirty) {
      setPendingDirtyAction({ kind: 'close-pane', payload: { clearFile } })
      return
    }
    setEditorPatch(closedEditorPatch(clearFile))
    if (activeWorkspace?.fullscreenPaneId === 'editor') {
      updateActive(w => ({ ...w, fullscreenPaneId: null }))
    }
  }, [activeWorkspace, setEditorPatch, updateActive])

  // Files arriving from outside the terminal: dropped on the editor pane, or
  // picked from the Open dialog. Both check the file before the editor commits
  // to it, so a refusal leaves the current file on screen and the pane just
  // reports why. Opening goes through openFileInEditor, so the unsaved-changes
  // prompt still fires exactly as it does for a Ctrl+click.
  const handleEditorDropFile = useCallback(async (path) => {
    const reason = await checkOpenable(path, window.electronAPI.editor)
    if (reason) return reason
    openFileInEditor({ path, line: null })
    return null
  }, [openFileInEditor])

  const handleEditorBrowse = useCallback(async () => {
    const path = await window.electronAPI.selectFile(activeWorkspace?.dir)
    if (!path) return null // cancelled
    const reason = await checkOpenable(path, window.electronAPI.editor)
    if (reason) return { path, reason }
    openFileInEditor({ path, line: null })
    return null
  }, [openFileInEditor, activeWorkspace])

  // Editor I/O state — scoped to the active workspace.
  const [editorLoadState, setEditorLoadState] = useState('empty')
  const [editorContent, setEditorContent] = useState('')
  const [editorErrorReason, setEditorErrorReason] = useState(null)
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const triggerEditorReload = useCallback(() => setEditorReloadKey(k => k + 1), [])

  const editorFile = activeWorkspace?.editor?.file ?? null

  useEffect(() => {
    if (!editorFile) {
      setEditorLoadState('empty')
      setEditorContent('')
      setEditorErrorReason(null)
      return
    }
    let cancelled = false
    setEditorLoadState('loading')
    setEditorErrorReason(null)
    window.electronAPI.editor.readFile(editorFile).then(r => {
      if (cancelled) return
      if (r.ok) {
        setEditorContent(r.content)
        setEditorLoadState('content')
      } else {
        setEditorErrorReason(r.reason)
        setEditorLoadState('error')
      }
    }).catch(err => {
      if (cancelled) return
      setEditorErrorReason('unknown')
      setEditorLoadState('error')
      console.error('editor.readFile failed', err)
    })
    return () => { cancelled = true }
  }, [editorFile, editorReloadKey])

  // Latest in-editor doc, mirrored from the EditorView via onChange. Lets the
  // dirty-prompt's "Save" branch persist the current text without exposing the
  // EditorView ref up the tree.
  const latestDocRef = useRef('')
  const handleEditorChange = useCallback((doc) => { latestDocRef.current = doc }, [])

  const handleEditorSave = useCallback(async (content) => {
    if (!editorFile) return false
    const text = content ?? latestDocRef.current
    try {
      const r = await window.electronAPI.editor.writeFile(editorFile, text)
      if (r.ok) {
        setEditorContent(text)
        setEditorPatch({ dirty: false })
        return true
      }
      console.error('editor.writeFile failed', r)
      return false
    } catch (err) {
      console.error('editor.writeFile threw', err)
      return false
    }
  }, [editorFile, setEditorPatch])

  const proceedDirtyAction = useCallback((action) => {
    if (action.kind === 'open-file') openFileImmediate(action.payload)
    else if (action.kind === 'close-pane') setEditorPatch(closedEditorPatch(action.payload?.clearFile))
    else if (action.kind === 'switch-workspace') {
      const { wsId, termId } = action.payload
      if (termId) {
        setWorkspaces(prev => focusSessionIn(prev, wsId, termId))
        setExpandedIds(prev => withExpanded(prev, wsId))
      }
      setActiveId(wsId)
    }
  }, [openFileImmediate, setEditorPatch])

  // Track .app-body width so the resizer can clamp against the visible area.
  const bodyWidthRef = useRef(1400)
  const appBodyRef = useRef(null)
  useEffect(() => {
    const el = appBodyRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) bodyWidthRef.current = e.contentRect.width
    })
    ro.observe(el)
    bodyWidthRef.current = el.getBoundingClientRect().width
    return () => ro.disconnect()
  }, [loaded])

  // Keyboard shortcuts. Skip when an editable element has focus so renaming
  // a workspace/agent or typing in the new-workspace modal isn't swallowed.
  useEffect(() => {
    if (!activeWorkspace) return
    const isEditable = (el) => {
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return el.isContentEditable === true
    }
    const handleKeyDown = (e) => {
      if (isEditable(e.target)) return
      // Drafts have no terminals/editor — Ctrl+T/W/E shouldn't fire.
      if (activeWorkspace.unconfigured) return
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        openPicker(null)
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (activeWorkspace.focusedTerminalId) {
          removeTerminal(activeWorkspace.focusedTerminalId)
        }
      }
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault()
        if (activeWorkspace.editor?.open) closeEditor({ clearFile: false })
        else setEditorPatch({ open: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openPicker, removeTerminal, activeWorkspace, closeEditor, setEditorPatch])

  // Ctrl+B toggles the sidebar. Like the shortcuts above it stays out of
  // terminals and text fields, so Claude's own Ctrl+B still reaches the agent.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  // Block window-level file drops. Panes consume their own drops; anything
  // that misses (sidebar, gaps) would otherwise navigate the BrowserWindow
  // to a file:// URL and replace the app. Skip if a pane already handled it
  // so we don't override the pane's 'copy' cursor with 'none'.
  useEffect(() => {
    const swallow = (e) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const { closeRequested, cancelClose, confirmClose } = useCloseGuard(loaded)

  // Hold render until persisted state is loaded — main keeps the window
  // hidden until ready-to-show, so this brief null render doesn't flash
  // an empty placeholder before Onboarding/main mount.
  if (!loaded) {
    return null
  }

  if (workspaces.length === 0) {
    return (
      <>
        <Onboarding onLaunch={handleOnboardingLaunch} />
        {closeRequested && (
          <CloseConfirm
            workspaces={workspaces}
            onCancel={cancelClose}
            onConfirm={confirmClose}
          />
        )}
        <LeftoverFoldersDialog folders={leftoverFolders} onClose={() => setLeftoverFolders(null)} />
      </>
    )
  }

  const terminals = activeWorkspace?.terminals ?? []
  const focusedId = activeWorkspace?.focusedTerminalId ?? null
  const fullscreenId = activeWorkspace?.fullscreenPaneId ?? null
  // Validate fullscreenId: drop stale ids that no longer exist (workspace switch
  // can't carry an id that was never on this workspace, but defensively check).
  const fsTerminalId = fullscreenId && fullscreenId !== 'editor'
    && terminals.some(t => t.id === fullscreenId) ? fullscreenId : null
  const fsEditor = fullscreenId === 'editor' && !!activeWorkspace?.editor?.open
  const anyFullscreen = !!fsTerminalId || fsEditor
  const n = terminals.length
  const canIso = canIsoState && canIsoState.key === isoProbeKey ? canIsoState.result : null
  const notice = activeWorkspace && !activeWorkspace.unconfigured
    ? isolationNotice({
        isolated: !!activeWorkspace.isolated,
        canIso,
        liveAgents: terminals.length,
        failures: activeWorkspace.failures ?? [],
        warnings: activeWorkspace.warnings ?? []
      })
    : { kind: null, actionEnabled: false }
  const noticeShown = notice.kind && !anyFullscreen
    && (notice.kind === 'spawn-failed' || !dismissedNotices.has(activeId))
  const dismissNotice = () => setDismissedNotices(prev => new Set(prev).add(activeId))
  const leftover = activeWorkspace && !anyFullscreen ? leftovers[activeWorkspace.dir] : null
  const dismissLeftover = () => {
    const dir = activeWorkspace?.dir
    if (!dir) return
    setLeftovers(prev => { const next = { ...prev }; delete next[dir]; return next })
  }
  const openLeftoverFolder = (row) => {
    const dir = activeWorkspace?.dir
    if (!dir || !row?.agentId) return
    window.electronAPI.worktree.openFolder({ repoDir: dir, agentId: row.agentId })
      .catch(() => ({ error: 'unknown' }))
      .then(res => {
        if (res?.error !== 'missing') return
        // The folder is gone already: say so instead of doing nothing.
        setLeftovers(prev => {
          const cur = prev[dir]
          if (!cur) return prev
          const mark = (list) => (list ?? []).map(r => (r.agentId === row.agentId ? { ...r, folderGone: true } : r))
          return { ...prev, [dir]: { kept: mark(cur.kept), stranded: mark(cur.stranded) } }
        })
      })
  }
  const askDiscardLeftover = (row) => {
    const dir = activeWorkspace?.dir
    if (dir && row) setPendingDiscard({ dir, row })
  }
  const confirmDiscardLeftover = async () => {
    const pending = pendingDiscard
    setPendingDiscard(null)
    if (!pending) return
    const { dir, row } = pending
    let res
    try {
      res = await window.electronAPI.worktree.discard({
        repoDir: dir,
        agentId: row.agentId,
        branch: row.branch,
        liveAgentIds: liveAgentIdsFor(workspaces, dir)
      })
    } catch { res = { ok: false } }
    setLeftovers(prev => {
      const cur = prev[dir]
      if (!cur) return prev
      const same = (r) => (row.agentId ? r.agentId === row.agentId : (!r.agentId && r.branch === row.branch))
      const update = (list) => res?.ok
        ? list.filter(r => !same(r))
        : list.map(r => (same(r) ? { ...r, discardFailed: true } : r))
      const kept = update(cur.kept ?? [])
      const stranded = update(cur.stranded ?? [])
      const next = { ...prev }
      if (kept.length || stranded.length) next[dir] = { kept, stranded }
      else delete next[dir]
      return next
    })
  }
  // Fullscreen shows one pane in a 1×1 grid, so no pane may be placed by hand
  // there: a span into column 3 would conjure extra implicit columns.
  const shape = anyFullscreen ? { cols: 1, rows: 1, lastSpansColumn: false } : gridShape(n)
  const { cols, rows } = shape

  return (
    <div className="app">
      <Toolbar
        onAdd={() => openPicker(null)}
        agentCount={terminals.length}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        editorOpen={!!activeWorkspace?.editor?.open}
        onToggleEditor={() => {
          if (activeWorkspace?.editor?.open) closeEditor({ clearFile: false })
          else setEditorPatch({ open: true })
        }}
      />
      <div className={`app-body${anyFullscreen ? ' is-fullscreen' : ''}`} ref={appBodyRef}>
        <Sidebar
          collapsed={sidebarCollapsed}
          workspaces={workspaces}
          activeId={activeId}
          expandedIds={expandedIds}
          doneTermIds={doneTermIds}
          exitedPtyIds={exitedPtyIds}
          focusedTerminalId={activeWorkspace?.focusedTerminalId ?? null}
          onSelect={handleSelectWorkspace}
          onToggleExpand={toggleExpand}
          onSelectSession={handleSelectSession}
          onCreate={handleStartDraft}
          onDelete={handleDeleteWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
          onRenameNickname={handleRenameNickname}
          onToggleIsolated={setWorkspaceIsolated}
          skillsOpen={activePanel === 'skills'}
          onToggleSkills={() => handleSelectPanel('skills')}
        />
        <div className={`body-main${fsTerminalId ? ' fs-terminal' : ''}${fsEditor ? ' fs-editor' : ''}`}>
          <div className="grid-wrap">
            {activeWorkspace?.unconfigured ? (
              <Onboarding
                mode="embedded"
                onLaunch={handleInitializeDraft}
                onDiscard={handleDiscardDraft}
                onNameChange={handleDraftNameChange}
              />
            ) : (
            <div className="grid-col">
            {leftover && (
              <LeftoverWorkNotice
                kept={leftover.kept}
                stranded={leftover.stranded}
                onDismiss={dismissLeftover}
                onOpenFolder={openLeftoverFolder}
                onDiscard={askDiscardLeftover}
              />
            )}
            {noticeShown && (
              <IsolationNotice
                kind={notice.kind}
                actionEnabled={notice.actionEnabled}
                reason={canIso?.reason}
                failures={activeWorkspace?.failures ?? []}
                warnings={activeWorkspace?.warnings ?? []}
                onSwitch={() => setWorkspaceIsolated(activeId, true)}
                retrying={retryingId === activeId}
                onRetry={retryFailures}
                onDismiss={dismissNotice}
              />
            )}
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`
              }}
            >
              {terminals.length === 0 ? (
                // Only once the restored agents have spawned: before that the
                // workspace is empty because it hasn't started, not because
                // it has no agents, and adding here would race the spawn.
                activeWorkspace?.spawned
                  ? <EmptyWorkspaceSetup availability={availability} onAdd={addAgents} />
                  : null
              ) : terminals.map((t, i) => (
                <TerminalPane
                  key={t.id}
                  cellStyle={cellStyle(shape, i, n)}
                  id={t.id}
                  ptyId={t.ptyId}
                  shell={t.shell}
                  cwd={t.cwd}
                  workspaceDir={activeWorkspace?.dir}
                  agentNum={t.agentNum}
                  name={t.name}
                  autoName={t.autoName}
                  branch={t.branch}
                  port={t.port}
                  fontSize={activeWorkspace?.fontSize ?? 13}
                  onClose={removeTerminal}
                  onFocus={setFocusedId}
                  onRename={renameTerminal}
                  onPtyReady={handlePtyReady}
                  onFontSizeChange={adjustFontSize}
                  onAddAgent={(anchorEl) => openPicker(anchorEl)}
                  onSwap={swapTerminals}
                  onOpenFile={openFileInEditor}
                  isFocused={focusedId === t.id}
                  isFullscreen={fsTerminalId === t.id}
                  isHiddenForFullscreen={anyFullscreen && fsTerminalId !== t.id}
                  onToggleFullscreen={() => toggleFullscreen(t.id)}
                  themeId={themeId}
                />
              ))}
            </div>
            </div>
            )}
          </div>
          {activeWorkspace?.editor?.open && !activeWorkspace?.unconfigured && (
            <>
              <EditorResizer
                width={activeWorkspace.editor.width || Math.round((bodyWidthRef.current || 1400) * EDITOR_DEFAULT_FRAC)}
                bodyWidth={bodyWidthRef.current || 1400}
                onResize={setEditorWidth}
                onResizeEnd={() => { /* width already in state */ }}
                onReset={() => setEditorWidth(Math.round((bodyWidthRef.current || 1400) * EDITOR_DEFAULT_FRAC))}
              />
              <Suspense fallback={null}>
                <EditorPane
                  file={activeWorkspace.editor.file}
                  initialLine={activeWorkspace.editor.line}
                  dirty={activeWorkspace.editor.dirty}
                  isExternal={isExternalToWorkspace(activeWorkspace.editor.file, activeWorkspace.dir)}
                  loadState={editorLoadState}
                  content={editorContent}
                  errorReason={editorErrorReason}
                  width={activeWorkspace.editor.width || Math.round((bodyWidthRef.current || 1400) * EDITOR_DEFAULT_FRAC)}
                  fontSize={activeWorkspace?.fontSize ?? 13}
                  themeId={themeId}
                  isFullscreen={fsEditor}
                  onToggleFullscreen={() => toggleFullscreen('editor')}
                  onSave={handleEditorSave}
                  onClose={() => closeEditor({ clearFile: true })}
                  onRevealInFolder={(p) => window.electronAPI.editor.revealInFolder(p)}
                  onDirtyChange={setEditorDirty}
                  onChange={handleEditorChange}
                  onScroll={setEditorScroll}
                  onRetry={triggerEditorReload}
                  onDropFile={handleEditorDropFile}
                  onBrowse={handleEditorBrowse}
                />
              </Suspense>
            </>
          )}
          {activePanel === 'skills' && (
            <>
              <SkillsPanelResizer
                width={skillsPanelWidth}
                bodyWidth={bodyWidthRef.current || 1400}
                onResize={handleSkillsResize}
                onResizeEnd={handleSkillsResizeEnd}
                onReset={handleSkillsResetWidth}
                style={{ right: `${skillsPanelWidth}px` }}
              />
              <SkillsPanel
                width={skillsPanelWidth}
                loadState={skillsLoadState}
                skills={skills}
                pluginSkills={pluginSkills}
                sourcePath="~/.claude/skills/"
                onClose={() => setActivePanel(null)}
                onCreate={async ({ name, body }) => {
                  return window.electronAPI.skills.create({ name, body })
                }}
                onRevealDir={() => window.electronAPI.skills.revealDir()}
              />
            </>
          )}
        </div>
      </div>

      {settingsOpen && <SettingsPage onClose={handleCloseSettings} />}

      {pickerState && (
        <AgentTypePicker
          availability={availability}
          pos={pickerState.pos}
          onPick={handlePickAgent}
          onClose={closePicker}
        />
      )}

      {pendingDeleteWorkspace && (
        <ConfirmDialog
          title="Delete this workspace?"
          message={
            <>
              Removing <strong className="cd-emphasis">{pendingDeleteWorkspace.name}</strong> will close every agent inside it
              {pendingDeleteWorkspace.editor?.dirty && pendingDeleteWorkspace.editor?.file && (
                <> and discard your unsaved edits to <strong className="cd-emphasis">{basename(pendingDeleteWorkspace.editor.file)}</strong></>
              )}
              . You can't bring it back.
              {pendingDeleteWorkspace.isolated && (
                <span className="cd-note" style={{ display: 'block', marginTop: 8 }}>
                  Agent folders with uncommitted changes are kept.
                </span>
              )}
            </>
          }
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      <LeftoverFoldersDialog folders={leftoverFolders} onClose={() => setLeftoverFolders(null)} />

      {pendingDiscard && (
        <ConfirmDialog
          title="Discard this work?"
          message={pendingDiscard.row.agentId ? (
            <>
              This deletes the agent folder <code>{pendingDiscard.row.path}</code>, any uncommitted changes in it, and the branch <code>{pendingDiscard.row.branch}</code> with its commits. It can't be undone.
            </>
          ) : (
            <>
              This deletes the branch <code>{pendingDiscard.row.branch}</code> and its {pendingDiscard.row.ahead === 1 ? 'commit' : `${pendingDiscard.row.ahead} commits`}, which never reached the main branch. It can't be undone.
            </>
          )}
          confirmLabel="Discard"
          cancelLabel="Cancel"
          destructive
          initialFocus="cancel"
          onConfirm={confirmDiscardLeftover}
          onCancel={() => setPendingDiscard(null)}
        />
      )}

      {pendingWorktreeClose && (
        <ConfirmDialog
          title="Discard agent's uncommitted changes?"
          message={
            <>
              <strong className="cd-emphasis">{pendingWorktreeClose.agentName}</strong> has uncommitted changes in <code>{pendingWorktreeClose.branch}</code>. The worktree will be removed and the changes lost. Committed work on the branch is preserved.
            </>
          }
          confirmLabel="Discard and close"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            const { wsId, termId } = pendingWorktreeClose
            setPendingWorktreeClose(null)
            const w = workspaces.find(x => x.id === wsId)
            const target = w?.terminals.find(t => t.id === termId)
            if (w && target) finalizeTerminalRemoval(w, target)
          }}
          onCancel={() => setPendingWorktreeClose(null)}
        />
      )}

      {pendingDirtyAction && activeWorkspace?.editor?.file && (
        <ConfirmDialog
          title="Save unsaved changes?"
          message={
            <>
              You have unsaved changes in <strong className="cd-emphasis">{basename(activeWorkspace.editor.file)}</strong>.
            </>
          }
          confirmLabel="Save"
          cancelLabel="Cancel"
          extraLabel="Discard"
          onConfirm={async () => {
            const ok = await handleEditorSave(latestDocRef.current)
            if (!ok) return
            const action = pendingDirtyAction
            setPendingDirtyAction(null)
            proceedDirtyAction(action)
          }}
          onExtra={() => {
            const action = pendingDirtyAction
            setEditorPatch({ dirty: false })
            setPendingDirtyAction(null)
            proceedDirtyAction(action)
          }}
          onCancel={() => setPendingDirtyAction(null)}
        />
      )}

      {closeRequested && (
        <CloseConfirm
          workspaces={workspaces}
          onCancel={cancelClose}
          onConfirm={confirmClose}
        />
      )}
    </div>
  )
}
