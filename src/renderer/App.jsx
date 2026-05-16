import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import Onboarding from './components/Onboarding.jsx'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import Sidebar from './components/Sidebar.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import EditorResizer from './components/EditorResizer.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import AgentTypePicker from './components/AgentTypePicker.jsx'
import EmptyWorkspaceSetup from './components/EmptyWorkspaceSetup.jsx'
import { initSettings, getSettings } from './settings-store.js'
import * as ptyPool from './pty-pool.js'
import * as doneTracker from './done-tracker.js'
import * as autoNamer from './auto-namer.js'
import { defaultEditorState, mergeEditor, EDITOR_DEFAULT_FRAC } from './editor-state.js'
import { PERSIST_DEBOUNCE_MS, AGENT_TYPES } from './constants.js'
import './design-tokens.css'
import './App.css'

const EditorPane = lazy(() => import('./components/EditorPane.jsx'))

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
          marginTop: 8, padding: '8px 16px', borderRadius: 6,
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
  const [pendingDelete, setPendingDelete] = useState(null)
  // Dirty-close prompt for an isolated agent's worktree.
  // shape: { wsId, termId, branch, agentName }
  const [pendingWorktreeClose, setPendingWorktreeClose] = useState(null)
  // Dirty-prompt: triggered when the user opens another file / closes the
  // editor / switches workspace while the active editor has unsaved changes.
  // shape: { kind: 'open-file' | 'close-pane' | 'switch-workspace', payload }
  const [pendingDirtyAction, setPendingDirtyAction] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availability, setAvailability] = useState({ claude: true, codex: true })
  const [pickerState, setPickerState] = useState(null) // null | { anchorRect: DOMRect|null }

  const persistTimerRef = useRef(null)
  const desktopPathRef = useRef('')

  const materializeAgents = useCallback(async (workspace, items, startNum) => {
    const agents = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const id = makeId()
      let cwd = workspace.dir
      let branch = null
      if (workspace.isolated) {
        const r = await window.electronAPI.worktree.create({
          repoDir: workspace.dir,
          workspaceName: workspace.name,
          agentId: id
        })
        if (r?.error) {
          console.error('worktree.create failed', r)
          continue
        }
        cwd = r.path
        branch = r.branch
      }
      agents.push({
        id,
        shell: item.shell,
        agentNum: startNum + i,
        cwd, ptyId: null, autoName: null, branch
      })
    }
    return agents
  }, [])

  // Load persisted workspaces + defaults on first mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.electronAPI.loadWorkspaces(),
      window.electronAPI.getDesktopPath(),
      initSettings()
    ]).then(([state, desktop]) => {
      if (cancelled) return
      desktopPathRef.current = desktop || ''
      const restored = (state?.workspaces ?? []).map(w => ({
        ...w,
        agentCounts: w.agentCounts ?? { claude: w.agentCount ?? 0, codex: 0 },
        terminals: [],          // session-only — lazy spawn
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
          const live = w.spawned ? { claude, codex } : (w.agentCounts ?? { claude: 0, codex: 0 })
          return {
            id: w.id, name: w.name, dir: w.dir,
            agentCounts: live,
            isolated: !!w.isolated,
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
  }, [workspaces, loaded])

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

  // Workspaces that have at least one done terminal AND aren't the active one
  // → sidebar shows the notify dot beside their name until you switch in.
  const doneTermIds = useSyncExternalStore(doneTracker.subscribe, doneTracker.getDoneTermIds)
  const notifyingWorkspaceIds = useMemo(() => {
    const set = new Set()
    for (const w of workspaces) {
      if (w.id === activeId) continue
      for (const t of (w.terminals ?? [])) {
        if (doneTermIds.has(t.id)) { set.add(w.id); break }
      }
    }
    return set
  }, [workspaces, activeId, doneTermIds])

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
        try {
          const r = await window.electronAPI.worktree.wipeAll({ repoDir: w0.dir })
          if (r?.kept?.length) {
            console.warn(
              `[worktree] ${r.kept.length} worktree(s) from previous session had uncommitted changes and were preserved at:\n` +
              r.kept.map(k => `  ${k.path}  (${k.branch})`).join('\n') +
              `\nReview the changes there and either commit them on the branch or discard the directory.`
            )
          }
        } catch {}
        if (cancelled) return
      }
      const items = countsToItems(w0.agentCounts)
      const terminals = await materializeAgents(w0, items, 1)
      if (cancelled) return
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== activeId || w.spawned) return w
        return {
          ...w,
          terminals,
          agentCounter: items.length,
          spawned: true,
          focusedTerminalId: terminals[0]?.id ?? null
        }
      }))
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
    const terminals = await materializeAgents(provisional, items, 1)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || !w.unconfigured) return w
      return {
        ...w,
        name: resolvedName,
        dir,
        agentCounts: counts,
        isolated: !!isolated,
        terminals,
        agentCounter: items.length,
        spawned: true,
        focusedTerminalId: terminals[0]?.id ?? null,
        unconfigured: false
      }
    }))
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

  const updateActive = useCallback((updater) => {
    setWorkspaces(prev => prev.map(w => w.id === activeId ? updater(w) : w))
  }, [activeId])

  const addAgent = useCallback(async (shell = 'claude') => {
    if (!activeId) return
    const w = workspaces.find(x => x.id === activeId)
    if (!w || w.unconfigured) return
    if (!AGENT_TYPES.includes(shell)) return
    if (!availability[shell]) return
    const nextNum = w.agentCounter + 1
    const [agent] = await materializeAgents(w, [{ shell }], nextNum)
    if (!agent) return
    setWorkspaces(prev => prev.map(x => x.id === activeId ? {
      ...x,
      agentCounter: Math.max(x.agentCounter, nextNum),
      terminals: [...x.terminals, agent]
    } : x))
  }, [activeId, workspaces, materializeAgents, availability])

  const addAgents = useCallback(async (counts) => {
    if (!activeId) return
    const w = workspaces.find(x => x.id === activeId)
    if (!w || w.unconfigured) return
    const items = []
    for (const shell of AGENT_TYPES) {
      const n = Math.max(0, Number(counts?.[shell]) || 0)
      if (availability[shell]) {
        for (let i = 0; i < n; i++) items.push({ shell })
      }
    }
    if (items.length === 0) return
    const startNum = w.agentCounter + 1
    const newAgents = await materializeAgents(w, items, startNum)
    if (newAgents.length === 0) return
    setWorkspaces(prev => prev.map(x => x.id === activeId ? {
      ...x,
      agentCounter: Math.max(x.agentCounter, startNum + newAgents.length - 1),
      terminals: [...x.terminals, ...newAgents]
    } : x))
  }, [activeId, workspaces, materializeAgents, availability])

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

  const finalizeTerminalRemoval = useCallback((w, target) => {
    if (target.ptyId) ptyPool.killPty(target.ptyId)
    else ptyPool.cancelCreate(target.id)

    if (w.isolated) {
      // Fire-and-forget; main is single-writer and tolerates errors.
      window.electronAPI.worktree.close({ repoDir: w.dir, agentId: target.id })
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

  const closeEditor = useCallback(() => {
    if (activeWorkspace?.editor?.dirty) {
      setPendingDirtyAction({ kind: 'close-pane' })
      return
    }
    setEditorPatch({ open: false })
    if (activeWorkspace?.fullscreenPaneId === 'editor') {
      updateActive(w => ({ ...w, fullscreenPaneId: null }))
    }
  }, [activeWorkspace, setEditorPatch, updateActive])

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
    else if (action.kind === 'close-pane') setEditorPatch({ open: false })
    else if (action.kind === 'switch-workspace') setActiveId(action.payload.wsId)
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
        if (activeWorkspace.editor?.open) closeEditor()
        else setEditorPatch({ open: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openPicker, removeTerminal, activeWorkspace, closeEditor, setEditorPatch])

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

  // Hold render until persisted state is loaded — main keeps the window
  // hidden until ready-to-show, so this brief null render doesn't flash
  // an empty placeholder before Onboarding/main mount.
  if (!loaded) {
    return null
  }

  if (workspaces.length === 0) {
    return <Onboarding onLaunch={handleOnboardingLaunch} />
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
  const cols = anyFullscreen ? 1 : (
    n <= 1 ? 1 :
    n === 2 ? 2 :
    n === 3 ? 3 :
    n === 4 ? 2 :
    n <= 6 ? 3 : 4
  )
  const rows = anyFullscreen ? 1 : Math.max(1, Math.ceil(n / cols))

  return (
    <div className="app">
      <Toolbar
        onAdd={() => openPicker(null)}
        agentCount={terminals.length}
        editorOpen={!!activeWorkspace?.editor?.open}
        onToggleEditor={() => {
          if (activeWorkspace?.editor?.open) closeEditor()
          else setEditorPatch({ open: true })
        }}
      />
      <div className={`app-body${anyFullscreen ? ' is-fullscreen' : ''}`} ref={appBodyRef}>
        <Sidebar
          workspaces={workspaces}
          activeId={activeId}
          notifyingIds={notifyingWorkspaceIds}
          onSelect={handleSelectWorkspace}
          onCreate={handleStartDraft}
          onDelete={handleDeleteWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
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
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`
              }}
            >
              {terminals.length === 0 ? (
                <EmptyWorkspaceSetup availability={availability} onAdd={addAgents} />
              ) : terminals.map(t => (
                <TerminalPane
                  key={t.id}
                  id={t.id}
                  ptyId={t.ptyId}
                  shell={t.shell}
                  cwd={t.cwd}
                  workspaceDir={activeWorkspace?.dir}
                  agentNum={t.agentNum}
                  name={t.name}
                  autoName={t.autoName}
                  branch={t.branch}
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
                />
              ))}
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
                  isFullscreen={fsEditor}
                  onToggleFullscreen={() => toggleFullscreen('editor')}
                  onSave={handleEditorSave}
                  onClose={closeEditor}
                  onRevealInFolder={(p) => window.electronAPI.editor.revealInFolder(p)}
                  onDirtyChange={setEditorDirty}
                  onChange={handleEditorChange}
                  onScroll={setEditorScroll}
                  onRetry={triggerEditorReload}
                />
              </Suspense>
            </>
          )}
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

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
            </>
          }
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
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
    </div>
  )
}

function basename(p) {
  if (!p) return ''
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}
