# CodeSpace Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the CodeSpace sidebar into a two-level tree that surfaces live agent sessions across every spawned workspace, and turn terminal panes into elevated cards with a persistent breadcrumb.

**Architecture:** The sidebar splits into three components (`Sidebar` / `WorkspaceRow` / `SessionRow`). Expansion state is session-only React state in `App.jsx`. The one new piece of plumbing is a store-shaped exit API on `pty-pool.js` that mirrors the existing `done-tracker.js` pattern, so the tree can show that an agent crashed in a workspace the grid is not displaying. Pane changes are CSS plus making the existing `.pane-subheader` unconditional.

**Tech Stack:** Electron 31, React 18, Vitest 2 + jsdom, @testing-library/react, xterm.js 5.5.

**Spec:** `docs/superpowers/specs/2026-08-19-shell-redesign-design.md`

## Global Constraints

- **Do not edit `src/renderer/design-tokens.css`.** Every color used already exists as a token. No token may be added, removed, or altered.
- **Do not edit `src/main/workspaces-store.js` or the `workspaces.json` shape.** Nothing in this plan persists.
- **Do not change PTY lifecycle, spawning, or worktree behavior.**
- **The terminal seam is intentional.** `.pane`, `.pane-header`, and `.pane-subheader` move to `--cs-bg-elevated`; `.xterm-container` and `--cs-term-bg` are left alone. Do not "fix" the resulting step between the breadcrumb and the terminal body.
- **Sidebar CSS stays in the single `src/renderer/components/Sidebar.css`.** Do not create `WorkspaceRow.css` or `SessionRow.css`.
- Run `npm test` before every commit. The suite is currently **246 passing across 25 files**; it must never go down.
- No BridgeMind assets, branding, imagery, or naming anywhere in code, comments, or copy.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/renderer/pty-pool.js` | modify | Add `subscribeExits` / `getExitedPtyIds` with a cached snapshot |
| `src/renderer/path-resolver.js` | modify | Add `shortenPath` |
| `src/renderer/workspace-ops.js` | create | Pure `focusSessionIn` / `withExpanded` used by App's tree wiring |
| `src/renderer/components/SessionRow.jsx` | create | Single-line session row: dot, glyph, name |
| `src/renderer/components/WorkspaceRow.jsx` | create | Two-line workspace row, nickname edit, chevron, count↔delete swap |
| `src/renderer/components/Sidebar.jsx` | modify | Rail shell, list, two-level keyboard nav, ARIA tree |
| `src/renderer/components/Sidebar.css` | modify | Width 270px, chevron gutter, indentation, session rows |
| `src/renderer/App.jsx` | modify | `expandedIds` state, cross-workspace session focus |
| `src/renderer/App.css` | modify | `.grid` gap/padding `4px → 6px` |
| `src/renderer/components/TerminalPane.jsx` | modify | Unconditional breadcrumb, branch folded in |
| `src/renderer/components/TerminalPane.css` | modify | Card surface, radius, shadow, elevated chrome bands |

**Task order and dependencies:** Tasks 1 and 2 are leaf utilities with no dependencies. Tasks 3 and 4 are presentational components. Task 5 assembles them. Task 6 wires App. Tasks 7 and 8 are the pane half and depend only on Task 2.

---

## Task 1: pty-pool exit store

The sidebar cannot currently know a background agent exited — `exitCode` is only known inside a mounted `TerminalPane`. The data already exists in the module-level `exitCodes` Map (`pty-pool.js:15`), which survives unmount. This task adds the missing subscription.

**Files:**
- Modify: `src/renderer/pty-pool.js`
- Create: `tests/renderer/pty-pool.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `subscribeExits(cb: () => void): () => void` — returns an unsubscribe function
  - `getExitedPtyIds(): Set<string>` — returns a **referentially stable** Set

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/pty-pool.test.js`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

// pty-pool holds module-level Maps, so every test needs a fresh module
// instance. `ensureSubscription` reaches for window.electronAPI, so we stub
// it and capture the exit callback the pool registers per ptyId — that
// callback is how we simulate a PTY dying.
describe('pty-pool exit store', () => {
  let ptyPool
  let exitHandlers

  beforeEach(async () => {
    vi.resetModules()
    exitHandlers = new Map()
    window.electronAPI = {
      onPtyData: () => () => {},
      onPtyExit: (ptyId, cb) => { exitHandlers.set(ptyId, cb); return () => {} },
      killPty: vi.fn()
    }
    ptyPool = await import('../../src/renderer/pty-pool.js')
  })

  it('starts with no exited ptys', () => {
    expect(ptyPool.getExitedPtyIds().size).toBe(0)
  })

  it('returns the same Set reference when nothing has changed', () => {
    // useSyncExternalStore calls getSnapshot several times per render and
    // warns (then loops) if the reference keeps changing.
    expect(ptyPool.getExitedPtyIds()).toBe(ptyPool.getExitedPtyIds())
  })

  it('records a ptyId and notifies subscribers when its PTY exits', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const cb = vi.fn()
    ptyPool.subscribeExits(cb)

    exitHandlers.get('pty-1')(0)

    expect(cb).toHaveBeenCalledTimes(1)
    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(true)
  })

  it('publishes a new snapshot reference after an exit', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const before = ptyPool.getExitedPtyIds()

    exitHandlers.get('pty-1')(0)

    expect(ptyPool.getExitedPtyIds()).not.toBe(before)
  })

  it('stops notifying after unsubscribe', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    const cb = vi.fn()
    const off = ptyPool.subscribeExits(cb)
    off()

    exitHandlers.get('pty-1')(0)

    expect(cb).not.toHaveBeenCalled()
  })

  it('drops the ptyId from the snapshot when the PTY is killed', () => {
    ptyPool.attach('pty-1', { onData: () => {} })
    exitHandlers.get('pty-1')(0)
    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(true)

    ptyPool.killPty('pty-1')

    expect(ptyPool.getExitedPtyIds().has('pty-1')).toBe(false)
  })

  it('still fires per-pty attach onExit listeners', () => {
    // The existing TerminalPane path must keep working unchanged.
    const onExit = vi.fn()
    ptyPool.attach('pty-1', { onData: () => {}, onExit })

    exitHandlers.get('pty-1')(3)

    expect(onExit).toHaveBeenCalledWith(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/pty-pool.test.js`
Expected: FAIL — `ptyPool.subscribeExits is not a function`

- [ ] **Step 3: Add the store to pty-pool.js**

In `src/renderer/pty-pool.js`, immediately after the `exitCodes` declaration (line 15), add:

```js
// Store-shaped view of exitCodes for useSyncExternalStore consumers (the
// sidebar tree). Mirrors done-tracker.js. The snapshot is cached and only
// rebuilt on mutation — returning a fresh Set per call would give React a
// new reference every render and loop forever.
const exitStoreListeners = new Set()
let exitedSnapshot = new Set()

function notifyExitStore() {
  exitedSnapshot = new Set(exitCodes.keys())
  for (const cb of exitStoreListeners) cb()
}

export function subscribeExits(cb) {
  exitStoreListeners.add(cb)
  return () => exitStoreListeners.delete(cb)
}

export function getExitedPtyIds() {
  return exitedSnapshot
}
```

- [ ] **Step 4: Fire the notify on exit**

In `ensureSubscription`, the `onPtyExit` handler currently reads:

```js
  const offExit = window.electronAPI.onPtyExit(ptyId, code => {
    exitCodes.set(ptyId, code)
    const set = exitListeners.get(ptyId)
    if (set) for (const fn of set) fn(code)
  })
```

Add the notify after the `exitCodes.set` line:

```js
  const offExit = window.electronAPI.onPtyExit(ptyId, code => {
    exitCodes.set(ptyId, code)
    notifyExitStore()
    const set = exitListeners.get(ptyId)
    if (set) for (const fn of set) fn(code)
  })
```

- [ ] **Step 5: Fire the notify on kill**

In `killPty`, after `exitCodes.delete(ptyId)`, add `notifyExitStore()`:

```js
export function killPty(ptyId) {
  window.electronAPI.killPty(ptyId)
  cleanups.get(ptyId)?.()
  cleanups.delete(ptyId)
  buffers.delete(ptyId)
  liveListeners.delete(ptyId)
  exitListeners.delete(ptyId)
  exitCodes.delete(ptyId)
  notifyExitStore()
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/renderer/pty-pool.test.js`
Expected: PASS, 7 tests

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 253 tests (246 existing + 7 new)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pty-pool.js tests/renderer/pty-pool.test.js
git commit -m "feat(pty-pool): add store-shaped exit API for cross-workspace status"
```

---

## Task 2: shortenPath helper

**Files:**
- Modify: `src/renderer/path-resolver.js`
- Modify: `tests/path-resolver.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `shortenPath(p: string): string`

- [ ] **Step 1: Write the failing test**

Append to `tests/path-resolver.test.js` (add `shortenPath` to the existing import from `../src/renderer/path-resolver.js`):

```jsx
describe('shortenPath', () => {
  it('returns non-strings and empties as an empty string', () => {
    expect(shortenPath('')).toBe('')
    expect(shortenPath(undefined)).toBe('')
    expect(shortenPath(null)).toBe('')
  })

  it('leaves a path of fewer than four segments unchanged', () => {
    expect(shortenPath('D:\\dev\\app')).toBe('D:\\dev\\app')
    expect(shortenPath('D:\\dev')).toBe('D:\\dev')
  })

  it('elides the middle of a four-segment windows path', () => {
    expect(shortenPath('D:\\PC Backup\\ControlDeck\\CodeSpace'))
      .toBe('D:\\…\\ControlDeck\\CodeSpace')
  })

  it('elides everything between root and the last two segments', () => {
    expect(shortenPath('D:\\PC Backup\\ControlDeck\\portfolio\\src'))
      .toBe('D:\\…\\portfolio\\src')
  })

  it('uses forward slashes for posix paths', () => {
    expect(shortenPath('/home/tj/dev/app/src')).toBe('/…/app/src')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/path-resolver.test.js`
Expected: FAIL — `shortenPath is not a function`

- [ ] **Step 3: Implement shortenPath**

Append to `src/renderer/path-resolver.js`:

```js
// Collapses a long path for display: keeps the root segment and the final
// two, eliding the middle. Fewer than four segments is already short enough
// to show whole. The full path is still shown via `title` at the call site.
export function shortenPath(p) {
  if (typeof p !== 'string' || p === '') return ''
  const isWindows = /^[A-Za-z]:[\\/]/.test(p)
  const sep = isWindows ? '\\' : '/'
  const parts = p.split(/[\\/]/)
  if (parts.length < 4) return p
  return [parts[0], '…', parts[parts.length - 2], parts[parts.length - 1]].join(sep)
}
```

Note the posix case: `/home/tj/dev/app/src` splits to `['', 'home', 'tj', 'dev', 'app', 'src']`, so `parts[0]` is the empty string and the join produces the leading `/` for free.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/path-resolver.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/path-resolver.js tests/path-resolver.test.js
git commit -m "feat(path-resolver): add shortenPath for pane breadcrumbs"
```

---

## Task 3: SessionRow component

**Files:**
- Create: `src/renderer/components/SessionRow.jsx`
- Modify: `src/renderer/components/Sidebar.css`
- Create: `tests/renderer/SessionRow.test.jsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<SessionRow term status isFocused onSelect />` where
  - `term`: `{ id, shell, name, autoName, agentNum }`
  - `status`: `'running' | 'done' | 'exited'`
  - `isFocused`: boolean
  - `onSelect(termId)`: called on click

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/SessionRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionRow from '../../src/renderer/components/SessionRow.jsx'

const TERM = { id: 't1', shell: 'claude', name: '', autoName: 'fix the pty bug', agentNum: 1 }

describe('SessionRow', () => {
  it('renders the auto-generated name', () => {
    render(<SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />)
    expect(screen.getByText('fix the pty bug')).toBeTruthy()
  })

  it('prefers an explicit name over the auto name', () => {
    render(
      <SessionRow term={{ ...TERM, name: 'renamed' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(screen.getByText('renamed')).toBeTruthy()
  })

  it('falls back to a padded agent number when unnamed', () => {
    render(
      <SessionRow term={{ ...TERM, name: '', autoName: '' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(screen.getByText('Agent 01')).toBeTruthy()
  })

  it('marks the dot running, done, or exited from status', () => {
    const { rerender, container } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-dot.running')).toBeTruthy()

    rerender(<SessionRow term={TERM} status="done" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-dot.done')).toBeTruthy()

    rerender(<SessionRow term={TERM} status="exited" isFocused={false} onSelect={() => {}} />)
    expect(container.querySelector('.sb-session-dot.exited')).toBeTruthy()
  })

  it('shows the agent glyph for the shell', () => {
    const { container } = render(
      <SessionRow term={TERM} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(container.querySelector('.sb-session-glyph').textContent).toBe('✳')

    const { container: c2 } = render(
      <SessionRow term={{ ...TERM, shell: 'codex' }} status="running" isFocused={false} onSelect={() => {}} />
    )
    expect(c2.querySelector('.sb-session-glyph').textContent).toBe('◆')
  })

  it('fires onSelect with the term id when clicked', async () => {
    const onSelect = vi.fn()
    render(<SessionRow term={TERM} status="running" isFocused={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('fix the pty bug'))
    expect(onSelect).toHaveBeenCalledWith('t1')
  })

  it('marks itself selected for assistive tech when focused', () => {
    const { container } = render(
      <SessionRow term={TERM} status="running" isFocused onSelect={() => {}} />
    )
    const row = container.querySelector('[role="treeitem"]')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.className).toContain('focused')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/SessionRow.test.jsx`
Expected: FAIL — cannot resolve `SessionRow.jsx`

- [ ] **Step 3: Create the component**

Create `src/renderer/components/SessionRow.jsx`:

```jsx
// One live agent session, nested under its workspace in the sidebar tree.
// Purely presentational — status is resolved by the parent, which is the
// only place that can see the done and exit stores together.

const GLYPHS = { claude: '✳', codex: '◆' }

export default function SessionRow({ term, status, isFocused, onSelect }) {
  const label =
    term.name?.trim() ||
    term.autoName?.trim() ||
    `Agent ${String(term.agentNum).padStart(2, '0')}`

  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused}
      tabIndex={-1}
      data-sb-node
      data-sb-kind="session"
      data-sb-id={term.id}
      className={`sb-session${isFocused ? ' focused' : ''}`}
      onClick={() => onSelect(term.id)}
      title={label}
    >
      <span className={`sb-session-dot ${status}`} aria-hidden />
      <span className="sb-session-glyph" aria-hidden>{GLYPHS[term.shell] ?? '·'}</span>
      <span className="sb-session-name">{label}</span>
    </div>
  )
}
```

- [ ] **Step 4: Add the styles**

Append to `src/renderer/components/Sidebar.css`:

```css
/* ── Session rows (tree level 2) ─────────────────────────────── */

.sb-session {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px 6px 32px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--cs-text-tertiary);
  transition: background var(--cs-transition), color var(--cs-transition);
}

.sb-session:hover {
  background: var(--cs-bg-hover);
  color: var(--cs-text-secondary);
}

.sb-session.focused {
  background: var(--cs-bg-active);
  color: var(--cs-text-primary);
}

.sb-session-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: 0 0 5px;
}

.sb-session-dot.running { background: var(--cs-green); }
.sb-session-dot.done    { background: var(--cs-cyan); box-shadow: 0 0 5px var(--cs-cyan-glow); }
.sb-session-dot.exited  { background: var(--cs-text-dim); }

.sb-session-glyph {
  font-size: 9px;
  flex: 0 0 auto;
  color: var(--cs-text-muted);
}

.sb-session-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--cs-font-mono);
  font-size: 11px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/renderer/SessionRow.test.jsx`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/SessionRow.jsx src/renderer/components/Sidebar.css tests/renderer/SessionRow.test.jsx
git commit -m "feat(sidebar): add SessionRow for the workspace tree"
```

---

## Task 4: WorkspaceRow component

Extracts the existing workspace row out of `Sidebar.jsx`, adds the chevron and the count↔delete hover swap, and takes ownership of nickname edit state (currently `editingId` / `draft` / `inputRef` at `Sidebar.jsx:33-35`).

**Files:**
- Create: `src/renderer/components/WorkspaceRow.jsx`
- Modify: `src/renderer/components/Sidebar.css`
- Create: `tests/renderer/WorkspaceRow.test.jsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<WorkspaceRow ws isActive isExpanded hasSessions showDoneDot onSelect onToggleExpand onDelete onRenameNickname />` where
  - `ws`: `{ id, name, nickname, isolated, unconfigured, spawned, terminals, agentCounts }`
  - `onToggleExpand(wsId)`, `onSelect(wsId)`, `onDelete(wsId)`, `onRenameNickname(wsId, value)`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/WorkspaceRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkspaceRow from '../../src/renderer/components/WorkspaceRow.jsx'

const WS = {
  id: 'w1',
  name: 'CodeSpace',
  nickname: 'shell redesign',
  isolated: false,
  unconfigured: false,
  spawned: true,
  terminals: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  agentCounts: { claude: 3, codex: 0 }
}

const noop = () => {}
const base = {
  isActive: false, isExpanded: false, hasSessions: true, showDoneDot: false,
  onSelect: noop, onToggleExpand: noop, onDelete: noop, onRenameNickname: noop
}

describe('WorkspaceRow', () => {
  it('renders name and nickname on separate lines', () => {
    render(<WorkspaceRow ws={WS} {...base} />)
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('shell redesign')).toBeTruthy()
  })

  it('shows the add-nickname hint when there is no nickname', () => {
    render(<WorkspaceRow ws={{ ...WS, nickname: null }} {...base} />)
    expect(screen.getByText('add nickname')).toBeTruthy()
  })

  it('shows the live terminal count for a spawned workspace', () => {
    render(<WorkspaceRow ws={WS} {...base} />)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('falls back to agentCounts when not yet spawned', () => {
    render(
      <WorkspaceRow ws={{ ...WS, spawned: false, terminals: [], agentCounts: { claude: 2, codex: 2 } }} {...base} />
    )
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('renders no chevron when the workspace has no sessions', () => {
    const { container } = render(<WorkspaceRow ws={WS} {...base} hasSessions={false} />)
    expect(container.querySelector('.sb-chevron')).toBeNull()
  })

  it('toggles expansion without activating the workspace', async () => {
    const onToggleExpand = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(
      <WorkspaceRow ws={WS} {...base} onToggleExpand={onToggleExpand} onSelect={onSelect} />
    )
    await userEvent.click(container.querySelector('.sb-chevron'))
    expect(onToggleExpand).toHaveBeenCalledWith('w1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('activates the workspace when the row body is clicked', async () => {
    const onSelect = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('CodeSpace'))
    expect(onSelect).toHaveBeenCalledWith('w1')
  })

  it('shows the aggregate done dot only when collapsed', () => {
    const { container, rerender } = render(
      <WorkspaceRow ws={WS} {...base} showDoneDot isExpanded={false} />
    )
    expect(container.querySelector('.sb-item-dot')).toBeTruthy()

    rerender(<WorkspaceRow ws={WS} {...base} showDoneDot isExpanded />)
    expect(container.querySelector('.sb-item-dot')).toBeNull()
  })

  it('commits a nickname edit on Enter', async () => {
    const onRenameNickname = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onRenameNickname={onRenameNickname} />)
    await userEvent.dblClick(screen.getByText('shell redesign'))
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.clear(input)
    await userEvent.type(input, 'new nick{Enter}')
    expect(onRenameNickname).toHaveBeenCalledWith('w1', 'new nick')
  })

  it('cancels a nickname edit on Escape without calling the handler', async () => {
    const onRenameNickname = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onRenameNickname={onRenameNickname} />)
    await userEvent.dblClick(screen.getByText('shell redesign'))
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.type(input, 'xyz{Escape}')
    expect(onRenameNickname).not.toHaveBeenCalled()
  })

  it('deletes via the button that occupies the count slot', async () => {
    const onDelete = vi.fn()
    render(<WorkspaceRow ws={WS} {...base} onDelete={onDelete} />)
    await userEvent.click(screen.getByTitle('Delete workspace'))
    expect(onDelete).toHaveBeenCalledWith('w1')
  })

  it('reports expansion state to assistive tech', () => {
    const { container, rerender } = render(<WorkspaceRow ws={WS} {...base} isExpanded={false} />)
    expect(container.querySelector('[role="treeitem"]').getAttribute('aria-expanded')).toBe('false')

    rerender(<WorkspaceRow ws={WS} {...base} isExpanded />)
    expect(container.querySelector('[role="treeitem"]').getAttribute('aria-expanded')).toBe('true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/WorkspaceRow.test.jsx`
Expected: FAIL — cannot resolve `WorkspaceRow.jsx`

- [ ] **Step 3: Create the component**

Create `src/renderer/components/WorkspaceRow.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react'

const ChevronGlyph = ({ open }) => (
  <svg
    width="9" height="9" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }}
    aria-hidden
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

const IsolatedGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="url(#sb-iso-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <defs>
      <linearGradient id="sb-iso-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="var(--cs-cyan)" />
        <stop offset="100%" stopColor="var(--cs-green)" />
      </linearGradient>
    </defs>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

export default function WorkspaceRow({
  ws, isActive, isExpanded, hasSessions, showDoneDot,
  onSelect, onToggleExpand, onDelete, onRenameNickname
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const isDraft = !!ws.unconfigured
  const count = ws.spawned
    ? (ws.terminals?.length ?? 0)
    : (ws.agentCounts?.claude ?? 0) + (ws.agentCounts?.codex ?? 0)

  const startEdit = (e) => {
    e.stopPropagation()
    setDraft(ws.nickname ?? '')
    setEditing(true)
  }

  const commit = () => {
    if (!editing) return
    setEditing(false)
    onRenameNickname?.(ws.id, draft)
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
  }

  const handleNicknameKeyDown = (e) => {
    if (e.key === 'Enter')       { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
    e.stopPropagation()   // never let input chars reach the tree's roving nav
  }

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-selected={isActive}
      aria-expanded={hasSessions ? isExpanded : undefined}
      tabIndex={isActive ? 0 : -1}
      data-sb-node
      data-sb-kind="workspace"
      data-sb-id={ws.id}
      className={`sb-item${isActive ? ' active' : ''}${isDraft ? ' draft' : ''}`}
      onClick={() => onSelect(ws.id)}
    >
      <span className="sb-item-bar" />

      {hasSessions ? (
        <button
          type="button"
          className="sb-chevron"
          tabIndex={-1}
          aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(ws.id) }}
        >
          <ChevronGlyph open={isExpanded} />
        </button>
      ) : (
        <span className="sb-chevron-spacer" aria-hidden />
      )}

      <div className="sb-item-text">
        <span className="sb-item-name" title={ws.name}>{ws.name}</span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            className="sb-item-nickname-input"
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleNicknameKeyDown}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="Edit nickname"
          />
        ) : ws.nickname ? (
          <span
            className="sb-item-nickname"
            title={ws.nickname}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={startEdit}
          >
            {ws.nickname}
          </span>
        ) : (
          <span
            className="sb-item-nickname-hint"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={startEdit}
          >
            add nickname
          </span>
        )}
      </div>

      {/* Delete stays a sibling of .sb-item-status, as today: it is
          position:absolute against .sb-item and must not inherit the
          status row's flex gap. */}
      <span className="sb-item-status" aria-hidden>
        {showDoneDot && !isExpanded && (
          <span className="sb-item-dot" title="An agent finished" />
        )}
        {ws.isolated && (
          <span className="sb-iso" title="Isolated agents" aria-label="Isolated agents">
            <IsolatedGlyph />
          </span>
        )}
        <span className="sb-item-count">{isDraft ? '✦' : count}</span>
      </span>

      <button
        className="sb-item-delete"
        title="Delete workspace"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onDelete(ws.id) }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  )
}
```

**Reuse note:** the aggregate dot uses the **existing** `.sb-item-dot` class (`Sidebar.css:204`), not a new one. That class already participates in the hover fade at `Sidebar.css:241-244`, which is exactly the behavior wanted.

- [ ] **Step 4: Update the styles for the chevron gutter**

**This is a small delta, not a rewrite.** The count↔delete hover swap you were asked to build **already exists** in `Sidebar.css` — `.sb-item:hover .sb-item-count, .sb-item:hover .sb-item-dot { opacity: 0 }` at lines 241-244, and `.sb-item:hover .sb-item-delete { opacity: 1 }` at lines 298-300. Do not re-declare `.sb-item-delete`, `.sb-item-status`, `.sb-item-count`, `.sb-item-dot`, or any of those hover rules. Only three edits are needed.

**Edit 1** — `.sidebar` (line 2): change `width: 220px` to `width: 270px`.

**Edit 2** — `.sb-item` (line 64): the row is currently a two-column grid. Make it a flex row so the chevron can occupy a fixed left gutter. Replace only the layout properties, leaving `border-radius`, `cursor`, and any transition in place:

```css
.sb-item {
  position: relative;
  display: flex;              /* was: grid */
  align-items: flex-start;
  gap: 8px;                   /* was: 10px */
  padding: 8px 10px 8px 18px; /* was: 10px 14px 10px 16px */
  border-radius: 7px;
  cursor: pointer;
}
```

Delete the now-unused `grid-template-columns: 1fr auto;` declaration.

**Edit 3** — append the chevron rules, and let the text column flex:

```css
/* Chevron occupies a fixed left gutter; .sb-item-bar sits further left
   still, at left: 5px, and needs no change. */
.sb-chevron,
.sb-chevron-spacer {
  width: 10px;
  flex: 0 0 10px;
  padding-top: 3px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: none;
  border: 0;
  padding-left: 0;
  padding-right: 0;
  cursor: pointer;
  color: var(--cs-icon-muted);
  transition: color var(--cs-transition);
}

.sb-chevron:hover { color: var(--cs-icon-secondary); }

.sb-item-text { flex: 1; min-width: 0; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/renderer/WorkspaceRow.test.jsx`
Expected: PASS, 12 tests

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/WorkspaceRow.jsx src/renderer/components/Sidebar.css tests/renderer/WorkspaceRow.test.jsx
git commit -m "feat(sidebar): add WorkspaceRow with chevron and count-slot delete"
```

---

## Task 5: Sidebar tree assembly

Rewires `Sidebar.jsx` to render the two new row components as an ARIA tree with two-level roving keyboard navigation.

**Files:**
- Modify: `src/renderer/components/Sidebar.jsx`
- Create: `tests/renderer/Sidebar.test.jsx`

**Interfaces:**
- Consumes: `SessionRow` (Task 3), `WorkspaceRow` (Task 4)
- Produces: `<Sidebar workspaces activeId expandedIds doneTermIds exitedPtyIds focusedTerminalId onSelect onToggleExpand onSelectSession onCreate onDelete onOpenSettings onRenameNickname />`
  - `expandedIds`: `Set<string>` of workspace ids
  - `doneTermIds`: `Set<string>` of terminal ids
  - `exitedPtyIds`: `Set<string>` of pty ids
  - `onSelectSession(wsId, termId)`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/Sidebar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar from '../../src/renderer/components/Sidebar.jsx'

const WORKSPACES = [
  {
    id: 'w1', name: 'CodeSpace', nickname: null, spawned: true, agentCounts: { claude: 2, codex: 0 },
    terminals: [
      { id: 't1', ptyId: 'p1', shell: 'claude', name: '', autoName: 'alpha', agentNum: 1 },
      { id: 't2', ptyId: 'p2', shell: 'claude', name: '', autoName: 'beta',  agentNum: 2 }
    ]
  },
  {
    id: 'w2', name: 'portfolio', nickname: null, spawned: true, agentCounts: { claude: 1, codex: 0 },
    terminals: [{ id: 't3', ptyId: 'p3', shell: 'codex', name: '', autoName: 'gamma', agentNum: 1 }]
  },
  { id: 'w3', name: 'idle', nickname: null, spawned: false, agentCounts: { claude: 0, codex: 0 }, terminals: [] }
]

const base = {
  workspaces: WORKSPACES,
  activeId: 'w1',
  expandedIds: new Set(),
  doneTermIds: new Set(),
  exitedPtyIds: new Set(),
  focusedTerminalId: null,
  onSelect: () => {}, onToggleExpand: () => {}, onSelectSession: () => {},
  onCreate: () => {}, onDelete: () => {}, onOpenSettings: () => {}, onRenameNickname: () => {}
}

describe('Sidebar tree', () => {
  it('renders a tree containing every workspace', () => {
    render(<Sidebar {...base} />)
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('portfolio')).toBeTruthy()
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('hides sessions of collapsed workspaces', () => {
    render(<Sidebar {...base} />)
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('shows sessions of expanded workspaces, including non-active ones', () => {
    render(<Sidebar {...base} expandedIds={new Set(['w2'])} />)
    expect(screen.getByText('gamma')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('marks a session exited when its ptyId is in exitedPtyIds', () => {
    const { container } = render(
      <Sidebar {...base} expandedIds={new Set(['w1'])} exitedPtyIds={new Set(['p2'])} />
    )
    const rows = container.querySelectorAll('.sb-session')
    expect(rows[0].querySelector('.sb-session-dot').className).toContain('running')
    expect(rows[1].querySelector('.sb-session-dot').className).toContain('exited')
  })

  it('prefers exited over done when both apply', () => {
    const { container } = render(
      <Sidebar {...base}
        expandedIds={new Set(['w1'])}
        doneTermIds={new Set(['t1'])}
        exitedPtyIds={new Set(['p1'])} />
    )
    const dot = container.querySelector('.sb-session .sb-session-dot')
    expect(dot.className).toContain('exited')
  })

  it('fires onSelectSession with workspace and terminal ids', async () => {
    const onSelectSession = vi.fn()
    render(<Sidebar {...base} expandedIds={new Set(['w2'])} onSelectSession={onSelectSession} />)
    await userEvent.click(screen.getByText('gamma'))
    expect(onSelectSession).toHaveBeenCalledWith('w2', 't3')
  })

  it('shows the aggregate done dot on a collapsed workspace with a done agent', () => {
    const { container } = render(<Sidebar {...base} doneTermIds={new Set(['t3'])} />)
    expect(container.querySelectorAll('.sb-item-dot').length).toBe(1)
  })

  it('moves focus down through the visible flattened list', async () => {
    const { container } = render(<Sidebar {...base} expandedIds={new Set(['w1'])} />)
    const nodes = () => Array.from(container.querySelectorAll('[data-sb-node]'))
    nodes()[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    // w1 expanded, so its first session is next — not w2
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('t1')
  })

  it('skips hidden sessions when the workspace is collapsed', async () => {
    const { container } = render(<Sidebar {...base} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement.getAttribute('data-sb-id')).toBe('w2')
  })

  it('expands with ArrowRight and collapses with ArrowLeft', async () => {
    const onToggleExpand = vi.fn()
    const { container } = render(<Sidebar {...base} onToggleExpand={onToggleExpand} />)
    container.querySelectorAll('[data-sb-node]')[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onToggleExpand).toHaveBeenCalledWith('w1')
  })

  it('does not steal keys while a nickname is being edited', async () => {
    const onToggleExpand = vi.fn()
    render(<Sidebar {...base} onToggleExpand={onToggleExpand} />)
    await userEvent.dblClick(screen.getByText('add nickname', { selector: '.sb-item-nickname-hint' }))
    const input = screen.getByLabelText('Edit nickname')
    await userEvent.type(input, 'ab')
    expect(input.value).toBe('ab')
    expect(onToggleExpand).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/Sidebar.test.jsx`
Expected: FAIL — no `tree` role; `Sidebar` still renders a listbox

- [ ] **Step 3: Rewrite Sidebar.jsx**

Replace the body of `src/renderer/components/Sidebar.jsx`, keeping the existing `PlusGlyph`, `GearGlyph`, header and footer markup exactly as they are, and replacing the list:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import WorkspaceRow from './WorkspaceRow.jsx'
import SessionRow from './SessionRow.jsx'
import './Sidebar.css'

// ... PlusGlyph and GearGlyph unchanged ...

export default function Sidebar({
  workspaces, activeId, expandedIds, doneTermIds, exitedPtyIds, focusedTerminalId,
  onSelect, onToggleExpand, onSelectSession, onCreate, onDelete, onOpenSettings, onRenameNickname
}) {
  const listRef = useRef(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
  }, [])

  const sessionsOf = (ws) => (ws.spawned ? (ws.terminals ?? []) : [])

  const statusOf = (term) => {
    if (exitedPtyIds?.has(term.ptyId)) return 'exited'
    if (doneTermIds?.has(term.id)) return 'done'
    return 'running'
  }

  // The visible flattened list drives roving navigation: a collapsed
  // workspace's sessions are not in the sequence at all.
  const flat = useMemo(() => {
    const out = []
    for (const ws of workspaces) {
      out.push({ kind: 'workspace', id: ws.id, ws })
      if (expandedIds?.has(ws.id)) {
        for (const t of sessionsOf(ws)) out.push({ kind: 'session', id: t.id, ws, term: t })
      }
    }
    return out
  }, [workspaces, expandedIds])

  const handleKeyDown = (e, index) => {
    // A focused nickname input owns its keys; bail before touching anything.
    if (e.target.tagName === 'INPUT') return

    const nodes = listRef.current?.querySelectorAll('[data-sb-node]')
    if (!nodes || nodes.length === 0) return
    const focus = (i) => nodes[Math.max(0, Math.min(nodes.length - 1, i))]?.focus()
    const node = flat[index]

    if (e.key === 'ArrowDown') { e.preventDefault(); focus(index + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(index - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(nodes.length - 1) }
    else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (node.kind === 'workspace' && sessionsOf(node.ws).length > 0 && !expandedIds?.has(node.ws.id)) {
        onToggleExpand(node.ws.id)
      } else if (node.kind === 'workspace') {
        focus(index + 1)
      }
    }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (node.kind === 'session') {
        focus(flat.findIndex(n => n.kind === 'workspace' && n.ws.id === node.ws.id))
      } else if (expandedIds?.has(node.ws.id)) {
        onToggleExpand(node.ws.id)
      }
    }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (node.kind === 'workspace') onSelect(node.ws.id)
      else onSelectSession(node.ws.id, node.term.id)
    }
    else if (e.key === 'Delete' || (e.shiftKey && e.key === 'Backspace')) {
      if (node.kind !== 'workspace') return
      e.preventDefault()
      onDelete(node.ws.id)
    }
  }

  return (
    <aside className="sidebar">
      {/* header block unchanged */}

      <div className="sb-list" role="tree" aria-label="Workspaces" ref={listRef}>
        {flat.map((node, i) => (
          <div key={node.kind + node.id} onKeyDown={(e) => handleKeyDown(e, i)}>
            {node.kind === 'workspace' ? (
              <WorkspaceRow
                ws={node.ws}
                isActive={node.ws.id === activeId}
                isExpanded={!!expandedIds?.has(node.ws.id)}
                hasSessions={sessionsOf(node.ws).length > 0}
                showDoneDot={sessionsOf(node.ws).some(t => doneTermIds?.has(t.id))}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onDelete={onDelete}
                onRenameNickname={onRenameNickname}
              />
            ) : (
              <div role="group">
                <SessionRow
                  term={node.term}
                  status={statusOf(node.term)}
                  isFocused={node.ws.id === activeId && node.term.id === focusedTerminalId}
                  onSelect={(termId) => onSelectSession(node.ws.id, termId)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* footer block unchanged */}
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/Sidebar.test.jsx`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Sidebar.jsx tests/renderer/Sidebar.test.jsx
git commit -m "feat(sidebar): assemble the two-level workspace tree"
```

---

## Task 6: App wiring

**Files:**
- Create: `src/renderer/workspace-ops.js`
- Create: `tests/renderer/workspace-ops.test.js`
- Modify: `src/renderer/App.jsx`

**Interfaces:**
- Consumes: `subscribeExits` / `getExitedPtyIds` (Task 1), the `Sidebar` props contract (Task 5)
- Produces:
  - `focusSessionIn(workspaces, wsId, termId): Workspace[]`
  - `withExpanded(expandedIds: Set<string>, wsId): Set<string>`

**The trap in this task:** `setFocusedId` (`App.jsx:706`) delegates to `updateActive`, which is closed over the *current* `activeId`. Calling `setActiveId(wsId)` and then `setFocusedId(termId)` in the same handler writes the focus onto the **old** workspace. Cross-workspace focus must be a single `setWorkspaces` update that targets `wsId` explicitly.

**Why a new module:** `tests/renderer/App.test.jsx` contains a single test against the *empty* state with an inline `electronAPI` stub — there is no render helper and no workspace fixture to reuse. Rendering App with populated, spawned workspaces would mean mocking `useTerminal`, `settings-store`, and the whole `createPty` path, because `spawned` only flips after the lazy-spawn effect resolves real PTYs (`App.jsx:316-356`). That fixture is disproportionate and brittle.

Instead the two risky operations move into a small pure module, matching the pattern `editor-state.js` and `path-resolver.js` already set. They are then testable with no mocking at all, and the trap becomes structurally hard to hit.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/workspace-ops.test.js`:

```jsx
import { describe, it, expect } from 'vitest'
import { focusSessionIn, withExpanded } from '../../src/renderer/workspace-ops.js'

const WORKSPACES = [
  { id: 'w1', name: 'alpha', focusedTerminalId: 't1' },
  { id: 'w2', name: 'beta',  focusedTerminalId: null }
]

describe('focusSessionIn', () => {
  it('sets focus on the named workspace', () => {
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next.find(w => w.id === 'w2').focusedTerminalId).toBe('t9')
  })

  it('leaves every other workspace untouched', () => {
    // The bug this guards: routing through App's updateActive would write
    // focus onto the OUTGOING active workspace, because that helper closes
    // over the current activeId.
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next.find(w => w.id === 'w1').focusedTerminalId).toBe('t1')
  })

  it('returns a new array and new object only for the target', () => {
    const next = focusSessionIn(WORKSPACES, 'w2', 't9')
    expect(next).not.toBe(WORKSPACES)
    expect(next[0]).toBe(WORKSPACES[0])
    expect(next[1]).not.toBe(WORKSPACES[1])
  })

  it('is a no-op for an unknown workspace id', () => {
    const next = focusSessionIn(WORKSPACES, 'nope', 't9')
    expect(next.map(w => w.focusedTerminalId)).toEqual(['t1', null])
  })
})

describe('withExpanded', () => {
  it('adds an id that is absent', () => {
    expect(withExpanded(new Set(), 'w1').has('w1')).toBe(true)
  })

  it('returns the same Set reference when the id is already present', () => {
    // Keeps React from re-rendering the tree on a redundant activation.
    const set = new Set(['w1'])
    expect(withExpanded(set, 'w1')).toBe(set)
  })

  it('does not mutate the input when adding', () => {
    const set = new Set()
    withExpanded(set, 'w1')
    expect(set.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/workspace-ops.test.js`
Expected: FAIL — cannot resolve `workspace-ops.js`

- [ ] **Step 3: Create the module**

Create `src/renderer/workspace-ops.js`:

```js
// Pure workspace-array operations used by App's sidebar tree wiring.
// Kept out of App.jsx so they can be tested without mocking xterm, the
// settings store, or the PTY spawn path.

// Focus a terminal inside an EXPLICITLY named workspace.
//
// Deliberately not routed through App's `updateActive`: that helper is
// closed over the current `activeId`, so calling it in the same tick as
// setActiveId(wsId) writes the focus onto the workspace being navigated
// away from.
export function focusSessionIn(workspaces, wsId, termId) {
  return workspaces.map(w => (w.id === wsId ? { ...w, focusedTerminalId: termId } : w))
}

// Add wsId to an expanded-set, returning the SAME reference when it is
// already present so React can skip the re-render.
export function withExpanded(expandedIds, wsId) {
  if (expandedIds.has(wsId)) return expandedIds
  return new Set(expandedIds).add(wsId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/workspace-ops.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Add expansion state**

In `src/renderer/App.jsx`, add the import alongside the existing renderer imports:

```js
import { focusSessionIn, withExpanded } from './workspace-ops.js'
```

Then, next to `const [activeId, setActiveId] = useState(null)` (line 97):

```js
  // Session-only. Deliberately not persisted: terminals[] is lazily spawned,
  // so a restored "expanded" flag would open a chevron above an empty list.
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  const toggleExpand = useCallback((wsId) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }, [])
```

- [ ] **Step 6: Subscribe to the exit store**

Next to the existing `doneTermIds` subscription (line 296):

```js
  const exitedPtyIds = useSyncExternalStore(ptyPool.subscribeExits, ptyPool.getExitedPtyIds)
```

- [ ] **Step 7: Auto-expand on activation**

In `handleSelectWorkspace` (line 524), add the expansion alongside the existing activation, leaving the dirty-editor guard intact:

```js
  const handleSelectWorkspace = useCallback((wsId) => {
    if (activeWorkspace?.editor?.dirty) {
      setPendingDirtyAction({ kind: 'switch-workspace', payload: { wsId } })
      return
    }
    setActiveId(wsId)
    setExpandedIds(prev => withExpanded(prev, wsId))
  }, [activeWorkspace])
```

- [ ] **Step 8: Add cross-workspace session focus**

Add below `handleSelectWorkspace`:

```js
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
```

- [ ] **Step 9: Honour the optional termId in the dirty-action dispatcher**

In `proceedDirtyAction` (line 857), the `switch-workspace` branch currently only sets the active id. A session click that was deferred by the dirty-editor guard carries a `termId`, which must not be dropped:

```js
    else if (action.kind === 'switch-workspace') {
      const { wsId, termId } = action.payload
      if (termId) setWorkspaces(prev => focusSessionIn(prev, wsId, termId))
      setActiveId(wsId)
      setExpandedIds(prev => withExpanded(prev, wsId))
    }
```

- [ ] **Step 10: Update the Sidebar call site**

Replace the `<Sidebar>` block (line 983) — `notifyingIds` is gone, its job now done by `doneTermIds`:

```jsx
        <Sidebar
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
        />
```

- [ ] **Step 11: Remove the now-dead notifyingWorkspaceIds memo**

Delete the `notifyingWorkspaceIds` `useMemo` (lines 302-312) and its comment. Confirm no other reference remains:

Run: `grep -rn "notifyingWorkspaceIds\|notifyingIds" src/`
Expected: no output

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 13: Verify the wiring in the running app**

The App-level composition is not unit-tested (see the note at the head of this task). Run `npm run dev` and confirm:
- Activating a workspace expands it and its sessions appear.
- With workspace A active, clicking a session under workspace B switches to B **and** focuses the clicked pane.
- Switching back to A restores A's own previously focused pane — this is the regression `focusSessionIn` exists to prevent.
- With an unsaved editor open, clicking a session in another workspace raises the dirty prompt, and confirming it lands on the right workspace *and* the right pane.

- [ ] **Step 14: Commit**

```bash
git add src/renderer/App.jsx src/renderer/workspace-ops.js tests/renderer/workspace-ops.test.js
git commit -m "feat(app): wire expansion state and cross-workspace session focus"
```

---

## Task 7: Pane cards

**Files:**
- Modify: `src/renderer/App.css`
- Modify: `src/renderer/components/TerminalPane.css`

There is no unit test for pure styling; this task is verified by build plus a manual pass in Step 4.

- [ ] **Step 1: Widen the grid gutters**

In `src/renderer/App.css`, in the `.grid` rule, change `gap: 4px` to `gap: 6px` and `padding: 4px` to `padding: 6px`. Leave `background: var(--cs-bg-base)` alone.

- [ ] **Step 2: Lift the pane onto a card**

In `src/renderer/components/TerminalPane.css`, replace the `.pane` rule (lines 1-11):

```css
.pane {
  display: flex;
  flex-direction: column;
  background: var(--cs-bg-elevated);
  border: 1px solid var(--cs-border-mid);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
  box-shadow:
    0 2px 14px -4px rgba(0, 0, 0, 0.9),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: border-color var(--cs-transition), box-shadow var(--cs-transition);
  animation: scaleIn 0.2s ease both;
}
```

- [ ] **Step 3: Match the chrome bands**

Still in `TerminalPane.css`, set `.pane-header` and `.pane-subheader` to `background: var(--cs-bg-elevated)`. `.pane-subheader` currently uses `var(--cs-bg-surface)` at line 369.

**Do not touch `.xterm-container` or `--cs-term-bg`.** The resulting step between the breadcrumb and the terminal body is intentional — the terminal reads as a screen inset into the card.

- [ ] **Step 4: Verify visually**

Run: `npm run dev`

Confirm, in both `sarvis-dark` and `bridge` themes:
- Panes are rounded, separated, and visibly lifted off the canvas.
- The focused pane's border still changes (`.pane.focused` is unchanged).
- Fullscreen a pane (double-click its header) and confirm it still fills the area.
- A done pane's pulse overlay still renders inside the rounded corners.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.css src/renderer/components/TerminalPane.css
git commit -m "feat(pane): render terminals as elevated cards"
```

---

## Task 8: Pane breadcrumb

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx:283-308`
- Modify: `src/renderer/components/TerminalPane.css`
- Create: `tests/renderer/TerminalPane.breadcrumb.test.jsx`

**Interfaces:**
- Consumes: `shortenPath` (Task 2)

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/TerminalPane.breadcrumb.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// TerminalPane pulls in xterm and the pty pool; stub the hook so the test
// exercises only the breadcrumb markup.
vi.mock('../../src/renderer/hooks/useTerminal.js', () => ({
  default: () => ({ error: null, exitCode: null })
}))

import TerminalPane from '../../src/renderer/components/TerminalPane.jsx'

const props = {
  id: 't1', ptyId: 'p1', shell: 'claude',
  cwd: 'D:\\PC Backup\\ControlDeck\\CodeSpace',
  workspaceDir: 'D:\\PC Backup\\ControlDeck\\CodeSpace',
  agentNum: 1, name: '', autoName: 'alpha', branch: null, fontSize: 13,
  onClose: () => {}, onFocus: () => {}, onRename: () => {}, onPtyReady: () => {},
  onFontSizeChange: () => {}, onAddAgent: () => {}, onSwap: () => {}, onOpenFile: () => {},
  isFocused: false, isFullscreen: false, isHiddenForFullscreen: false,
  onToggleFullscreen: () => {}, themeId: 'sarvis-dark'
}

beforeEach(() => {
  window.electronAPI = { writeClipboardText: vi.fn() }
})

describe('TerminalPane breadcrumb', () => {
  it('always renders, showing agent type and shortened cwd', () => {
    const { container } = render(<TerminalPane {...props} />)
    const crumb = container.querySelector('.pane-subheader')
    expect(crumb).toBeTruthy()
    expect(crumb.textContent).toContain('claude')
    expect(crumb.textContent).toContain('D:\\…\\ControlDeck\\CodeSpace')
  })

  it('exposes the full cwd as a title', () => {
    const { container } = render(<TerminalPane {...props} />)
    expect(container.querySelector('.tp-crumb-cwd').getAttribute('title'))
      .toBe('D:\\PC Backup\\ControlDeck\\CodeSpace')
  })

  it('omits the branch for a non-isolated agent', () => {
    const { container } = render(<TerminalPane {...props} />)
    expect(container.querySelector('.tp-branch')).toBeNull()
  })

  it('folds the branch into the same row for an isolated agent', () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    const crumb = container.querySelector('.pane-subheader')
    expect(crumb.querySelector('.tp-branch')).toBeTruthy()
    expect(crumb.textContent).toContain('cs/a1f2')
  })

  it('still copies the branch on click', async () => {
    const { container } = render(<TerminalPane {...props} branch="cs/a1f2" />)
    container.querySelector('.tp-branch').click()
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('cs/a1f2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/TerminalPane.breadcrumb.test.jsx`
Expected: FAIL — `.pane-subheader` is null for a non-isolated agent

- [ ] **Step 3: Make the subheader unconditional**

In `src/renderer/components/TerminalPane.jsx`, add the import at the top:

```js
import { shortenPath } from '../path-resolver.js'
```

Then replace the entire `{branch && ( ... )}` block with:

```jsx
      <div className="pane-subheader">
        <span className="tp-crumb-icon" aria-hidden>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </span>
        <span className="tp-crumb-shell">{shell}</span>
        <span className="tp-crumb-sep" aria-hidden>·</span>
        <span className="tp-crumb-cwd" title={cwd}>{shortenPath(cwd)}</span>
        {branch && (
          <>
            <span className="tp-crumb-sep" aria-hidden>·</span>
            <button
              type="button"
              className="tp-branch"
              title={`${branch} — click to copy`}
              onClick={(e) => {
                e.stopPropagation()
                window.electronAPI.writeClipboardText(branch)
              }}
            >
              <span className="tp-branch-icon" aria-hidden>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              </span>
              <span className="tp-branch-text">{branch}</span>
            </button>
          </>
        )}
      </div>
```

- [ ] **Step 4: Add the breadcrumb styles**

Append to `src/renderer/components/TerminalPane.css`:

```css
.tp-crumb-icon {
  display: flex;
  color: var(--cs-icon-muted);
  flex: 0 0 auto;
}

.tp-crumb-shell,
.tp-crumb-cwd {
  font-family: var(--cs-font-mono);
  font-size: 10px;
  color: var(--cs-text-muted);
  white-space: nowrap;
}

.tp-crumb-cwd {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.tp-crumb-sep {
  color: var(--cs-text-dim);
  font-size: 10px;
  flex: 0 0 auto;
}
```

Also add `gap: 5px;` to the existing `.pane-subheader` rule so the crumb parts space evenly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/renderer/TerminalPane.breadcrumb.test.jsx`
Expected: PASS, 5 tests

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: both succeed

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/TerminalPane.jsx src/renderer/components/TerminalPane.css tests/renderer/TerminalPane.breadcrumb.test.jsx
git commit -m "feat(pane): show agent type and cwd in a persistent breadcrumb"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: PASS, **300 tests**. Baseline is 246; this plan adds 54 across 6 new files (`pty-pool`, `SessionRow`, `WorkspaceRow`, `Sidebar`, `workspace-ops`, `TerminalPane.breadcrumb`) plus 5 appended to `path-resolver.test.js`.

Per-task counts: T1 7, T2 5, T3 7, T4 12, T5 11, T6 7, T8 5.

- [ ] **Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Manual pass in `npm run dev`**

Walk the spec's acceptance criteria:
- Expand a non-active workspace — its sessions appear, the grid does not change.
- Click a session in a non-active workspace — it switches and that pane is focused.
- Kill an agent in a background workspace (close its process) — the tree shows it exited.
- Collapse a workspace holding a done agent — the aggregate dot appears; expand it — the dot moves to the session row.
- Double-click a nickname, edit, Enter, Escape — behaves as in v1.4.0.
- Delete a workspace via the hover × over the count.
- Tab into the tree, then Arrow keys, Left/Right, Enter, Delete.
- Every pane shows agent type and cwd; isolated panes show a copyable branch on the same line.
- Check both `sarvis-dark` and `bridge` themes.
