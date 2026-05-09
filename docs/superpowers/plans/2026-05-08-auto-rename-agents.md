# Auto-rename agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static `Agent NN` labels with 3–5 word AI-generated titles that update after every Claude turn.

**Architecture:** Renderer auto-namer module piggybacks on the existing `done-tracker` "turn finished" signal. When a turn ends, it pulls the tail of that PTY's ring, strips ANSI, and asks Haiku 4.5 (via a main-process IPC handler that owns the API key) for a short title. Title lands on a new per-terminal `autoName` field; manual `name` always wins.

**Tech Stack:** Electron (main + preload + renderer), `@anthropic-ai/sdk`, `strip-ansi`, React 18.

**Spec:** `docs/superpowers/specs/2026-05-08-auto-rename-agents-design.md`

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install @anthropic-ai/sdk strip-ansi
```

Expected: both packages added under `dependencies`. `strip-ansi` is ESM-only — the renderer + main both use ESM imports, so this is fine.

- [ ] **Step 2: Verify versions**

```bash
node -e "console.log(require('./package.json').dependencies['@anthropic-ai/sdk'], require('./package.json').dependencies['strip-ansi'])"
```

Expected: prints version strings (e.g. `^0.32.x ^7.x`), no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @anthropic-ai/sdk and strip-ansi for auto-rename"
```

---

### Task 2: Main-process auto-namer module

**Files:**
- Create: `src/main/auto-namer.js`

- [ ] **Step 1: Write the module**

```js
// src/main/auto-namer.js
//
// Owns the Anthropic SDK client. Exposed only via IPC so the API key
// never crosses to the renderer.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 20

const SYSTEM = [
  'You name terminal tabs.',
  'Reply with 3 to 5 words, Title Case, no quotes, no punctuation, no trailing period.',
  'Describe what the Claude agent in this terminal is currently doing.',
  'If the terminal is idle or has no clear task, reply "Idle".',
].join(' ')

let client = null

function getClient() {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  client = new Anthropic({ apiKey })
  return client
}

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// Renderer sanitization is also applied; this is belt-and-suspenders.
function sanitize(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/[.!?]+$/, '')
  if (s.length > 40) s = s.slice(0, 40).trim()
  return s
}

export async function summarize(tail) {
  const c = getClient()
  if (!c) return { ok: false, reason: 'no-key' }
  if (typeof tail !== 'string' || tail.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: tail }],
    })
    const block = res?.content?.find(b => b.type === 'text')
    const name = sanitize(block?.text ?? '')
    if (!name) return { ok: false, reason: 'empty-response' }
    return { ok: true, name }
  } catch (err) {
    console.warn('[auto-namer] summarize failed:', err?.message ?? err)
    return { ok: false, reason: 'api' }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/auto-namer.js
git commit -m "feat(auto-namer): main-process Haiku summarizer module"
```

---

### Task 3: Register IPC handlers

**Files:**
- Modify: `src/main/ipc-handlers.js`

- [ ] **Step 1: Add the import and handler registrations**

At the top, alongside the existing imports:

```js
import * as autoNamer from './auto-namer.js'
```

Inside `registerHandlers(mainWindow)`, after the `editor:revealInFolder` handler and before the `mainWindow.webContents.on('destroyed', ...)` block, add:

```js
  ipcMain.handle('agentName:hasKey',    async () => autoNamer.hasKey())
  ipcMain.handle('agentName:summarize', async (_event, tail) => autoNamer.summarize(tail))
```

- [ ] **Step 2: Manual smoke test**

```bash
$env:ANTHROPIC_API_KEY = "sk-ant-…"; npm run dev
```

Open DevTools (Ctrl+Shift+I) in the renderer once it loads, and run:

```js
await window.electronAPI.agentName.hasKey()
// → true
await window.electronAPI.agentName.summarize('user: refactor the login form\nclaude: I will start by reading the file…')
// → { ok: true, name: 'Refactoring The Login Form' } (or similar)
```

(`window.electronAPI.agentName` is wired in Task 4; if running this step before Task 4, invoke directly: `await electron.ipcRenderer.invoke('agentName:summarize', '...')`.)

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.js
git commit -m "feat(auto-namer): register agentName IPC handlers"
```

---

### Task 4: Preload bridge

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add to the exposed `api` object**

Inside `const api = { ... }`, after the `editor: { ... }` block:

```js
  agentName: {
    hasKey:    () => ipcRenderer.invoke('agentName:hasKey'),
    summarize: (tail) => ipcRenderer.invoke('agentName:summarize', tail),
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(auto-namer): expose agentName IPC on preload bridge"
```

---

### Task 5: Add `onDone` hook to done-tracker

**Files:**
- Modify: `src/renderer/done-tracker.js`

- [ ] **Step 1: Add the listener set, exporter, and fire-point**

At the top of the module, near the existing `const listeners = new Set()`:

```js
const doneListeners = new Set()  // (termId) => void — fires when a turn finishes
```

Add the exporter near the other exports:

```js
export function onDone(cb) {
  doneListeners.add(cb)
  return () => doneListeners.delete(cb)
}
```

Inside `trackTerm`, in the `setTimeout` callback, after the existing block that sets `doneSet` / calls `playDoneSound()` / calls `notify()`, **always** fire `doneListeners` regardless of attended state — auto-rename should run for the focused pane too:

Replace this block:

```js
silenceTimers.set(termId, setTimeout(() => {
  awaiting.delete(termId)
  silenceTimers.delete(termId)
  if (!isAttended(termId)) {
    doneSet.add(termId)
    playDoneSound()
    notify()
  }
}, DONE_SILENCE_MS))
```

With:

```js
silenceTimers.set(termId, setTimeout(() => {
  awaiting.delete(termId)
  silenceTimers.delete(termId)
  if (!isAttended(termId)) {
    doneSet.add(termId)
    playDoneSound()
    notify()
  }
  for (const cb of doneListeners) {
    try { cb(termId) } catch (err) { console.warn('[done-tracker] listener threw:', err) }
  }
}, DONE_SILENCE_MS))
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/done-tracker.js
git commit -m "feat(done-tracker): add onDone hook for auto-rename"
```

---

### Task 6: Add `getRing` exporter to pty-pool

**Files:**
- Modify: `src/renderer/pty-pool.js`

- [ ] **Step 1: Add a read-only accessor**

Below `export function resizePty(...)`, append:

```js
export function getRing(ptyId) {
  return buffers.get(ptyId) ?? ''
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/pty-pool.js
git commit -m "feat(pty-pool): export getRing for auto-namer"
```

---

### Task 7: Renderer auto-namer module

**Files:**
- Create: `src/renderer/auto-namer.js`

- [ ] **Step 1: Write the module**

```js
// src/renderer/auto-namer.js
//
// On every Claude "turn finished" event from done-tracker, ask the main
// process to summarize the tail of that pane's PTY ring. Manual names
// pin a pane and disable auto-rename.

import stripAnsi from 'strip-ansi'
import * as ptyPool from './pty-pool.js'
import * as doneTracker from './done-tracker.js'

const TAIL_BYTES = 4096

const subs = new Set()                  // (termId, name) => void
const inFlight = new Set()              // termId
const lastTail = new Map()              // termId -> string (suppress no-op renames)
const ptyIdByTerm = new Map()           // termId -> ptyId
const isPinned = new Map()              // termId -> boolean (manual name set)

let keyCheckPromise = null
function ensureKeyCheck() {
  if (!keyCheckPromise) {
    keyCheckPromise = window.electronAPI.agentName.hasKey()
      .catch(() => false)
  }
  return keyCheckPromise
}

export function subscribe(cb) {
  subs.add(cb)
  return () => subs.delete(cb)
}

function notify(termId, name) {
  for (const cb of subs) {
    try { cb(termId, name) } catch (err) { console.warn('[auto-namer] subscriber threw:', err) }
  }
}

// App calls this whenever the (termId -> ptyId) map changes — same shape as
// done-tracker.syncTracked. Also receives the manual-name flag per term.
export function syncTracked(termMap, pinnedSet) {
  ptyIdByTerm.clear()
  for (const [termId, ptyId] of termMap) ptyIdByTerm.set(termId, ptyId)
  isPinned.clear()
  for (const termId of pinnedSet) isPinned.set(termId, true)
  // Drop stale state for terms that no longer exist.
  for (const termId of [...lastTail.keys()]) {
    if (!ptyIdByTerm.has(termId)) {
      lastTail.delete(termId)
      inFlight.delete(termId)
    }
  }
}

function sanitize(name) {
  if (typeof name !== 'string') return ''
  let s = name.trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/[.!?]+$/, '')
  if (s.length > 40) s = s.slice(0, 40).trim()
  return s
}

async function handleDone(termId) {
  if (isPinned.get(termId)) return
  if (inFlight.has(termId)) return
  const ptyId = ptyIdByTerm.get(termId)
  if (!ptyId) return
  if (!(await ensureKeyCheck())) return

  const ring = ptyPool.getRing(ptyId)
  if (!ring) return
  const tail = stripAnsi(ring).slice(-TAIL_BYTES).trim()
  if (!tail) return
  if (lastTail.get(termId) === tail) return
  lastTail.set(termId, tail)

  inFlight.add(termId)
  try {
    const res = await window.electronAPI.agentName.summarize(tail)
    if (res?.ok && res.name) {
      const clean = sanitize(res.name)
      if (clean) notify(termId, clean)
    }
  } catch (err) {
    console.warn('[auto-namer] summarize threw:', err)
  } finally {
    inFlight.delete(termId)
  }
}

doneTracker.onDone(handleDone)
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/auto-namer.js
git commit -m "feat(auto-namer): renderer module subscribes to done events"
```

---

### Task 8: Wire auto-namer into App.jsx

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Import the module**

After the existing `import * as doneTracker from './done-tracker.js'`:

```js
import * as autoNamer from './auto-namer.js'
```

- [ ] **Step 2: Add `autoName: null` to every terminal-creation site**

In `makeAgents` (around line 60):

```js
function makeAgents(count, cwd, startNum = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: makeId(),
    shell: 'claude',
    agentNum: startNum + i,
    cwd,
    ptyId: null,
    autoName: null
  }))
}
```

In `addAgent` (the new-terminal object literal):

```js
terminals: [...w.terminals, {
  id: makeId(),
  shell: 'claude',
  agentNum: nextNum,
  cwd: w.dir,
  ptyId: null,
  autoName: null
}]
```

- [ ] **Step 3: Sync auto-namer alongside done-tracker, then wire its subscription**

Replace the existing done-tracker sync `useEffect` (the one that builds `map` and calls `doneTracker.syncTracked(map)`) with:

```js
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
```

Add a second `useEffect` (right after that one) that subscribes to `autoNamer` once:

```js
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
```

- [ ] **Step 4: Pass `autoName` to TerminalPane**

In the `<TerminalPane … />` render (around line 600), add the prop:

```jsx
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
  fontSize={activeWorkspace?.fontSize ?? 13}
  …
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(auto-namer): plumb subscription and autoName field through App"
```

---

### Task 9: TerminalPane displayName fallback chain

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx`

- [ ] **Step 1: Accept `autoName` prop and update `displayName`**

Update the function signature (line 7) to add `autoName` between `name` and `fontSize`:

```jsx
export default function TerminalPane({ id, ptyId, shell, cwd, workspaceDir, agentNum, name, autoName, fontSize, onClose, onFocus, onRename, onPtyReady, onFontSizeChange, onAddAgent, onSwap, onOpenFile, isFocused }) {
```

Replace the existing `displayName` line (~line 26):

```jsx
const displayName = name?.trim() || autoName?.trim() || `Agent ${String(agentNum).padStart(2, '0')}`
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/TerminalPane.jsx
git commit -m "feat(auto-namer): include autoName in TerminalPane label fallback"
```

---

### Task 10: Manual end-to-end verification

**Files:** none

- [ ] **Step 1: Launch with API key**

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-…"; npm run dev
```

- [ ] **Step 2: Verify happy path**

1. Create a workspace with 2 agents.
2. In Agent 01, type `please refactor a small function for me` and press Enter.
3. Wait ~5–6 seconds after Claude finishes responding.
4. **Expected:** the pane label changes from `Agent 01` to a 3–5 word title (e.g. `Refactoring Small Function`).

- [ ] **Step 3: Verify manual-name pin**

1. Double-click Agent 02's label → rename to `Pinned`.
2. Type a prompt and let Claude finish.
3. **Expected:** label stays `Pinned`. No console error.

- [ ] **Step 4: Verify no-key fallback**

1. Close the app.
2. Relaunch **without** the env var: `Remove-Item Env:ANTHROPIC_API_KEY; npm run dev`
3. Type a prompt and let Claude finish.
4. **Expected:** label stays `Agent 01`. No errors in DevTools.

- [ ] **Step 5: Verify hidden-workspace renaming**

1. With key set, create two workspaces. In WS-A, send a prompt and immediately switch to WS-B.
2. Wait ~10s, switch back.
3. **Expected:** WS-A's pane label has updated. (Auto-namer runs across all workspaces, like done-tracker.)

- [ ] **Step 6: Verify rename-on-remove still works**

1. Create 4 agents, let them all auto-rename.
2. Close Agent 03.
3. **Expected:** the remaining three are numbered 01/02/03 internally (the next add reuses 04). Their `autoName`s remain attached to the same pane.

---

## Self-Review

**Spec coverage:**
- 4–5 word title generation → Tasks 2, 7
- Triggered after each Claude turn → Task 5 (done-tracker hook), Task 7 (handler)
- Manual name pin → Task 7 (`isPinned`), Task 8 (sync), Task 9 (display order)
- ANTHROPIC_API_KEY env var, silent fallback → Task 2, Task 7 (`ensureKeyCheck`)
- Main owns the API key → Task 2, Task 3
- `autoName` field, manual `name` wins → Tasks 8, 9
- No persistence → unchanged: `App.jsx`'s save serializer (line ~125) only emits `{id,name,dir,agentCount,editor}` — `autoName` is excluded automatically.
- Network/error swallow → Task 2 try/catch, Task 7 try/catch
- Hidden-workspace updates → auto-namer subscribes globally via done-tracker (which runs across all workspaces); Task 10 step 5 verifies.

**Placeholder scan:** none — every step has the exact code or command.

**Type consistency:**
- `agentName:hasKey` / `agentName:summarize` channel names are identical across Tasks 3, 4, 7.
- `autoName` field name consistent across Tasks 8 and 9.
- `subscribe` / `syncTracked` names match the `done-tracker` precedent.
