import { useState, useCallback, useEffect, useRef } from 'react'
import Onboarding from './components/Onboarding.jsx'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import Sidebar from './components/Sidebar.jsx'
import NewWorkspaceModal from './components/NewWorkspaceModal.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import * as ptyPool from './pty-pool.js'
import { PERSIST_DEBOUNCE_MS } from './constants.js'
import './design-tokens.css'
import './App.css'

function makeId() {
  return crypto.randomUUID()
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

function makeAgents(count, cwd, startNum = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: makeId(),
    shell: 'claude',
    agentNum: startNum + i,
    cwd,
    ptyId: null
  }))
}

export default function App() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return <BridgeMissing />
  }
  return <AppInner />
}

function AppInner() {
  const [loaded, setLoaded] = useState(false)
  const [defaultDir, setDefaultDir] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const persistTimerRef = useRef(null)
  const desktopPathRef = useRef('')

  // Load persisted workspaces + defaults on first mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.electronAPI.loadWorkspaces(),
      window.electronAPI.getDesktopPath()
    ]).then(([state, desktop]) => {
      if (cancelled) return
      desktopPathRef.current = desktop || ''
      setDefaultDir(desktop || '')
      const restored = (state?.workspaces ?? []).map(w => ({
        ...w,
        terminals: [],          // session-only — lazy spawn
        agentCounter: 0,
        focusedTerminalId: null,
        spawned: false,
        fontSize: 13
      }))
      setWorkspaces(restored)
      setActiveId(state?.activeWorkspaceId ?? restored[0]?.id ?? null)
      setLoaded(true)
      // Resuming a session → maximize. Fresh launch (no workspaces) → keep
      // the small dialog window for onboarding.
      if (restored.length > 0) {
        window.electronAPI.windowEnsureMaximized()
      }
    })
    return () => { cancelled = true }
  }, [])

  // Persist (debounced) whenever workspace identity changes.
  useEffect(() => {
    if (!loaded) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      window.electronAPI.saveWorkspaces({
        workspaces: workspaces.map(w => ({
          id: w.id, name: w.name, dir: w.dir, agentCount: w.agentCount
        })),
        activeWorkspaceId: activeId
      })
    }, PERSIST_DEBOUNCE_MS)
  }, [workspaces, activeId, loaded])

  const activeWorkspace = workspaces.find(w => w.id === activeId) ?? null

  // Lazy-spawn terminals when a workspace becomes active for the first time.
  // Depend only on activeId so identity churn on `workspaces` doesn't re-fire.
  useEffect(() => {
    if (!activeId) return
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || w.spawned) return w
      const terminals = makeAgents(w.agentCount, w.dir, 1)
      return {
        ...w,
        terminals,
        agentCounter: w.agentCount,
        spawned: true,
        focusedTerminalId: terminals[0]?.id ?? null
      }
    }))
  }, [activeId])

  const handleOnboardingLaunch = useCallback((count, dir, name) => {
    const resolvedName = (name && name.trim())
      || dir.split(/[\\/]/).filter(Boolean).pop()
      || 'Workspace'
    const ws = {
      id: makeId(),
      name: resolvedName,
      dir,
      agentCount: count,
      terminals: [],
      agentCounter: 0,
      focusedTerminalId: null,
      spawned: false,
      fontSize: 13
    }
    setWorkspaces([ws])
    setActiveId(ws.id)
    window.electronAPI.windowEnsureMaximized()
  }, [])

  const handleCreateWorkspace = useCallback(({ name, dir, agentCount }) => {
    const ws = {
      id: makeId(),
      name,
      dir,
      agentCount,
      terminals: [],
      agentCounter: 0,
      focusedTerminalId: null,
      spawned: false,
      fontSize: 13
    }
    setWorkspaces(prev => [...prev, ws])
    setActiveId(ws.id)
    setShowNewModal(false)
  }, [])

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
      workspaces: nextWorkspaces.map(w => ({
        id: w.id, name: w.name, dir: w.dir, agentCount: w.agentCount
      })),
      activeWorkspaceId: nextActiveId
    })

    setWorkspaces(nextWorkspaces)
    setActiveId(nextActiveId)
    setPendingDelete(null)

    // If we just dropped to zero workspaces, shrink window to dialog size for onboarding.
    if (nextWorkspaces.length === 0) {
      window.electronAPI.windowEnsureRestored()
    }

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
    }
  }, [pendingDelete, workspaces, activeId])

  const pendingDeleteWorkspace = pendingDelete
    ? workspaces.find(w => w.id === pendingDelete)
    : null

  const handleSelectWorkspace = useCallback((wsId) => {
    setActiveId(wsId)
  }, [])

  const updateActive = useCallback((updater) => {
    setWorkspaces(prev => prev.map(w => w.id === activeId ? updater(w) : w))
  }, [activeId])

  const addAgent = useCallback(() => {
    if (!activeId) return
    updateActive(w => {
      const nextNum = w.agentCounter + 1
      return {
        ...w,
        agentCounter: nextNum,
        terminals: [...w.terminals, {
          id: makeId(),
          shell: 'claude',
          agentNum: nextNum,
          cwd: w.dir,
          ptyId: null
        }]
      }
    })
  }, [activeId, updateActive])

  const removeTerminal = useCallback((termId) => {
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId) return w
      const target = w.terminals.find(t => t.id === termId)
      if (target?.ptyId) ptyPool.killPty(target.ptyId)
      else if (target) ptyPool.cancelCreate(target.id)
      return {
        ...w,
        terminals: w.terminals.filter(t => t.id !== termId),
        focusedTerminalId: w.focusedTerminalId === termId ? null : w.focusedTerminalId
      }
    }))
  }, [activeId])

  const setFocusedId = useCallback((termId) => {
    updateActive(w => ({ ...w, focusedTerminalId: termId }))
  }, [updateActive])

  const renameTerminal = useCallback((termId, name) => {
    updateActive(w => ({
      ...w,
      terminals: w.terminals.map(t => t.id === termId ? { ...t, name } : t)
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
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        addAgent()
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (activeWorkspace.focusedTerminalId) {
          removeTerminal(activeWorkspace.focusedTerminalId)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addAgent, removeTerminal, activeWorkspace])

  if (!loaded) {
    return <div className="app" />
  }

  if (workspaces.length === 0) {
    return <Onboarding onLaunch={handleOnboardingLaunch} />
  }

  const terminals = activeWorkspace?.terminals ?? []
  const focusedId = activeWorkspace?.focusedTerminalId ?? null
  const n = terminals.length
  const cols =
    n <= 1 ? 1 :
    n === 2 ? 2 :
    n === 3 ? 3 :
    n === 4 ? 2 :
    n <= 6 ? 3 : 4
  const rows = Math.max(1, Math.ceil(n / cols))

  return (
    <div className="app">
      <Toolbar onAdd={addAgent} agentCount={terminals.length} />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          activeId={activeId}
          onSelect={handleSelectWorkspace}
          onCreate={() => setShowNewModal(true)}
          onDelete={handleDeleteWorkspace}
        />
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`
          }}
        >
          {terminals.length === 0 ? (
            <div className="empty-workspace">
              <span className="empty-mark">✦</span>
              <p className="empty-title">No agents in this workspace</p>
              <button className="empty-btn" onClick={addAgent}>+ New Agent</button>
            </div>
          ) : terminals.map(t => (
            <TerminalPane
              key={t.id}
              id={t.id}
              ptyId={t.ptyId}
              shell={t.shell}
              cwd={t.cwd}
              agentNum={t.agentNum}
              name={t.name}
              fontSize={activeWorkspace?.fontSize ?? 13}
              onClose={removeTerminal}
              onFocus={setFocusedId}
              onRename={renameTerminal}
              onPtyReady={handlePtyReady}
              onFontSizeChange={adjustFontSize}
              onAddAgent={addAgent}
              onSwap={swapTerminals}
              isFocused={focusedId === t.id}
            />
          ))}
        </div>
      </div>

      {showNewModal && (
        <NewWorkspaceModal
          defaultDir={defaultDir}
          onCancel={() => setShowNewModal(false)}
          onCreate={handleCreateWorkspace}
        />
      )}

      {pendingDeleteWorkspace && (
        <ConfirmDialog
          title="Delete this workspace?"
          message={
            <>
              Removing <strong className="cd-emphasis">{pendingDeleteWorkspace.name}</strong> will close every agent inside it. You can't bring it back.
            </>
          }
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  )
}
