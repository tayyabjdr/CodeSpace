# Workspace Nickname Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-workspace nickname rendered as a dim subtitle in the sidebar, edited inline via double-click.

**Architecture:** A new `nickname: string | null` field on each workspace, sanitized in `workspaces-store` (trim, ≤40 chars, empty → null) and persisted alongside existing workspace identity fields. Rendered in `Sidebar.jsx` as a second text row beneath the name; visible only when set, with a hover-only "add nickname" hint when empty. Edit mode matches the existing terminal-rename pattern (Enter commits, Esc cancels, blur commits). Editing does not change the active workspace.

**Tech Stack:** React (renderer), Electron main (`workspaces-store.js`), Vitest (`jsdom`).

**Spec:** `docs/superpowers/specs/2026-05-28-workspace-nickname-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/main/workspaces-store.js` | modify | Add `sanitizeNickname`; include `nickname` in load/save shapes |
| `src/renderer/App.jsx` | modify | Thread `nickname` through workspace state; add `handleRenameNickname`; include `nickname` in both persist paths |
| `src/renderer/components/Sidebar.jsx` | modify | Restructure item markup; add per-row edit state; double-click handlers; bail keyboard nav while editing |
| `src/renderer/components/Sidebar.css` | modify | `.sb-item-text`, `.sb-item-nickname`, `.sb-item-nickname-hint`, `.sb-item-nickname-input`; align right column to name row |
| `tests/workspaces-store.test.js` | create | Unit tests for `sanitizeNickname` + load/save round-trip + backward compat |

---

## Task 1: Storage layer — `sanitizeNickname` + load/save threading

**Files:**
- Modify: `src/main/workspaces-store.js`
- Create: `tests/workspaces-store.test.js`

- [ ] **Step 1: Write failing tests for `sanitizeNickname`**

Create `tests/workspaces-store.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import os from 'os'

// Mock electron `app.getPath('userData')` to a tmpdir per-test so each test
// writes to an isolated workspaces.json file.
let tmp
vi.mock('electron', () => ({
  app: {
    getPath: () => tmp
  }
}))

// Import AFTER the mock so the module captures the mocked `app`.
const importStore = () => import('../src/main/workspaces-store.js')

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(os.tmpdir(), 'cs-ws-store-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('sanitizeNickname (via loadWorkspaces)', () => {
  it.each([
    [null,              null],
    [undefined,         null],
    ['',                null],
    ['   ',             null],
    ['ok',              'ok'],
    [' ok ',            'ok'],
    ['x'.repeat(41),    'x'.repeat(40)],
    [123,               null],
    [{},                null],
  ])('coerces %p to %p', async (input, expected) => {
    const { saveWorkspaces, loadWorkspaces } = await importStore()
    await saveWorkspaces({
      workspaces: [{ id: 'w1', name: 'n', dir: 'd', agentCounts: { claude: 0, codex: 0 }, nickname: input }],
      activeWorkspaceId: 'w1'
    })
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe(expected)
  })
})

describe('load/save round-trip', () => {
  it('preserves a valid nickname through save → load', async () => {
    const { saveWorkspaces, loadWorkspaces } = await importStore()
    await saveWorkspaces({
      workspaces: [{ id: 'w1', name: 'n', dir: 'd', agentCounts: { claude: 1, codex: 0 }, nickname: 'client redesign' }],
      activeWorkspaceId: 'w1'
    })
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe('client redesign')
  })

  it('loads legacy JSON (no nickname field) with nickname: null', async () => {
    const path = join(tmp, 'workspaces.json')
    await fs.writeFile(path, JSON.stringify({
      version: 2,
      workspaces: [{ id: 'w1', name: 'old', dir: 'd', agentCounts: { claude: 1, codex: 0 } }],
      activeWorkspaceId: 'w1'
    }), 'utf8')
    const { loadWorkspaces } = await importStore()
    const state = await loadWorkspaces()
    expect(state.workspaces[0].nickname).toBe(null)
  })
})
```

- [ ] **Step 2: Run the tests — they should fail**

Run from the repo root: `npm test -- workspaces-store`

Expected: all tests fail because `nickname` is undefined on the loaded shape.

- [ ] **Step 3: Implement `sanitizeNickname` and thread it through load/save**

Open `src/main/workspaces-store.js`. Add this helper next to `sanitizeEditor` (after line ~99):

```js
function sanitizeNickname(v) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, 40)
}
```

Update the `loadWorkspaces` return mapping (the `parsed.workspaces.map` block around line 79–86) to add `nickname`:

```js
return {
  workspaces: parsed.workspaces.map(w => ({
    id: String(w.id),
    name: String(w.name ?? 'Workspace'),
    dir: String(w.dir ?? ''),
    agentCounts: sanitizeAgentCounts(w),
    isolated: !!w.isolated,
    editor: sanitizeEditor(w.editor),
    nickname: sanitizeNickname(w.nickname)
  })),
  activeWorkspaceId: parsed.activeWorkspaceId ?? null
}
```

Update `saveWorkspaces` (the `safe.workspaces` mapping around line 104–111) to write `nickname`:

```js
const safe = {
  version: SCHEMA_VERSION,
  workspaces: (state?.workspaces ?? []).map(w => ({
    id: w.id,
    name: w.name,
    dir: w.dir,
    agentCounts: sanitizeAgentCounts(w),
    isolated: !!w.isolated,
    editor: sanitizeEditor(w.editor),
    nickname: sanitizeNickname(w.nickname)
  })),
  activeWorkspaceId: state?.activeWorkspaceId ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- workspaces-store`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspaces-store.js tests/workspaces-store.test.js
git commit -m "feat(workspaces): persist optional nickname field"
```

---

## Task 2: Thread `nickname` through renderer state

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Load `nickname` into the in-memory workspace shape**

In `src/renderer/App.jsx`, find the restore mapping inside the first-mount `useEffect` (around line 157):

```js
const restored = (state?.workspaces ?? []).map(w => ({
  ...w,
  agentCounts: w.agentCounts ?? { claude: w.agentCount ?? 0, codex: 0 },
  terminals: [],
  agentCounter: 0,
  focusedTerminalId: null,
  fullscreenPaneId: null,
  spawned: false,
  fontSize: getSettings().appearance.defaultPaneFontSize,
  editor: w.editor ? { ...defaultEditorState(), ...w.editor, dirty: false, scroll: 0 } : defaultEditorState()
}))
```

The spread `...w` already carries `nickname` from `loadWorkspaces`, but make it explicit so the field is documented in the in-memory shape. Replace with:

```js
const restored = (state?.workspaces ?? []).map(w => ({
  ...w,
  agentCounts: w.agentCounts ?? { claude: w.agentCount ?? 0, codex: 0 },
  nickname: w.nickname ?? null,
  terminals: [],
  agentCounter: 0,
  focusedTerminalId: null,
  fullscreenPaneId: null,
  spawned: false,
  fontSize: getSettings().appearance.defaultPaneFontSize,
  editor: w.editor ? { ...defaultEditorState(), ...w.editor, dirty: false, scroll: 0 } : defaultEditorState()
}))
```

- [ ] **Step 2: Default `nickname: null` on newly-created workspaces**

Two creation sites in `App.jsx`:

In `handleOnboardingLaunch` (around line 348), add `nickname: null` to the `ws` object:

```js
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
```

In `handleStartDraft` (around line 370), add `nickname: null` similarly:

```js
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
```

- [ ] **Step 3: Include `nickname` in both persistence paths**

The debounced save effect (around line 197–218) builds a payload from `workspaces`. Add `nickname: w.nickname ?? null` to the per-workspace object:

```js
window.electronAPI.saveWorkspaces({
  workspaces: persistable.map(w => {
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
  activeWorkspaceId: activeIsDraft ? (persistable[0]?.id ?? null) : activeId
})
```

The pre-delete save in `handleConfirmDelete` (around line 453–466) also builds the same payload. Apply the same change there:

```js
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
```

- [ ] **Step 4: Add `handleRenameNickname` and pass it to Sidebar**

After `handleSelectWorkspace` (around line 507), add a new callback. Place this just before `updateActive`:

```js
const handleRenameNickname = useCallback((wsId, value) => {
  // Trim → empty becomes null (clears the nickname); clamp at 40 chars on save.
  // Sanitization in workspaces-store is the source of truth; this is a defensive trim.
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const next = trimmed.length === 0 ? null : trimmed.slice(0, 40)
  setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, nickname: next } : w))
}, [])
```

Then update the `<Sidebar />` invocation (around line 945) to pass it:

```jsx
<Sidebar
  workspaces={workspaces}
  activeId={activeId}
  notifyingIds={notifyingWorkspaceIds}
  onSelect={handleSelectWorkspace}
  onCreate={handleStartDraft}
  onDelete={handleDeleteWorkspace}
  onOpenSettings={() => setSettingsOpen(true)}
  onRenameNickname={handleRenameNickname}
/>
```

- [ ] **Step 5: Manual smoke-test that nothing regressed**

Run: `npm run dev`

Verify:
- App launches.
- Existing workspaces still load.
- Creating a new workspace still works.
- No console errors about `nickname`.

(The nickname won't render yet — Sidebar changes land in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(workspaces): thread nickname through renderer state and persistence"
```

---

## Task 3: Sidebar markup + edit state

**Files:**
- Modify: `src/renderer/components/Sidebar.jsx`

- [ ] **Step 1: Add per-row edit state and a stable nickname-edit hook**

At the top of the `Sidebar` function (just under the `version` `useState`), add:

```js
const [editingId, setEditingId] = useState(null)   // ws.id of the row currently editing, or null
const [draft, setDraft] = useState('')             // local typed value while editing
const inputRef = useRef(null)
```

`useState` is already imported; `useRef` is already imported. No new imports needed.

Add a focus-on-open effect after the existing `useEffect`:

```js
useEffect(() => {
  if (editingId && inputRef.current) {
    inputRef.current.focus()
    inputRef.current.select()
  }
}, [editingId])
```

- [ ] **Step 2: Add commit/cancel/start helpers**

Inside the `Sidebar` function, above `handleKeyDown`, add:

```js
const startEditNickname = (ws, e) => {
  e.stopPropagation()
  setDraft(ws.nickname ?? '')
  setEditingId(ws.id)
}

const commitNickname = () => {
  if (!editingId) return
  const id = editingId
  setEditingId(null)
  onRenameNickname?.(id, draft)
}

const cancelNickname = () => {
  setEditingId(null)
  setDraft('')
}

const handleNicknameKeyDown = (e) => {
  if (e.key === 'Enter')      { e.preventDefault(); commitNickname() }
  else if (e.key === 'Escape') { e.preventDefault(); cancelNickname() }
  e.stopPropagation()   // never let nickname input chars bubble to row roving-nav
}
```

- [ ] **Step 3: Bail row roving-nav while editing**

In `handleKeyDown` (the existing row keydown handler), add an early return at the top:

```js
const handleKeyDown = (e, index) => {
  if (editingId) return   // input owns keys; row nav must not steal them
  const items = listRef.current?.querySelectorAll('[data-sb-item]')
  // ...rest unchanged
}
```

- [ ] **Step 4: Add `onRenameNickname` to the function signature**

Update the `Sidebar` export signature:

```js
export default function Sidebar({ workspaces, activeId, notifyingIds, onSelect, onCreate, onDelete, onOpenSettings, onRenameNickname }) {
```

- [ ] **Step 5: Restructure the item markup**

Replace the existing `.sb-item-name` line inside the `workspaces.map(...)` block with a two-row text column. The relevant block today is:

```jsx
<span className="sb-item-bar" />
<span className="sb-item-name" title={ws.name}>{ws.name}</span>
<span className="sb-item-status" aria-hidden>
  ...
```

Replace with:

```jsx
<span className="sb-item-bar" />
<div className="sb-item-text">
  <span className="sb-item-name" title={ws.name}>{ws.name}</span>
  {editingId === ws.id ? (
    <input
      ref={inputRef}
      type="text"
      className="sb-item-nickname-input"
      value={draft}
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleNicknameKeyDown}
      onBlur={commitNickname}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label="Edit nickname"
    />
  ) : ws.nickname ? (
    <span
      className="sb-item-nickname"
      title={ws.nickname}
      onDoubleClick={(e) => startEditNickname(ws, e)}
    >
      {ws.nickname}
    </span>
  ) : (
    <span
      className="sb-item-nickname-hint"
      onDoubleClick={(e) => startEditNickname(ws, e)}
    >
      add nickname
    </span>
  )}
</div>
<span className="sb-item-status" aria-hidden>
  ...
```

The rest of the `.sb-item-status` block, the iso glyph, the count, and the `.sb-item-delete` button are unchanged.

- [ ] **Step 6: Manual smoke-test the rendering**

Run: `npm run dev`

Verify:
- Workspaces with no nickname still look like today at rest (hint is hidden by CSS, which lands in Task 4 — for now the hint text may be visible; that's expected).
- Workspaces with a nickname show the second line.
- Double-click the nickname (or the "add nickname" text) opens the input, focused with text selected.
- Type, press Enter → nickname updates, input closes.
- Type, press Esc → input closes without saving.
- Type, click another row → blur commits and selection switches normally.
- Editing an inactive row's nickname does NOT activate that workspace.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/Sidebar.jsx
git commit -m "feat(sidebar): nickname row with double-click inline editing"
```

---

## Task 4: Sidebar styles

**Files:**
- Modify: `src/renderer/components/Sidebar.css`

- [ ] **Step 1: Replace the single-line item layout with a two-row text column**

In `src/renderer/components/Sidebar.css`, find `.sb-item` (around line 64). Update `align-items` from `center` to `start` so the right column anchors to the name row, not the centerline of the two-line stack:

```css
.sb-item {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 10px;
  padding: 10px 14px 10px 16px;
  border-radius: 7px;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background var(--cs-transition),
    border-color var(--cs-transition);
  animation: sbItemIn 0.22s ease both;
  min-height: 36px;
}
```

- [ ] **Step 2: Style the text column and nickname row**

Append below `.sb-item.active .sb-item-name { ... }` (around line 134):

```css
.sb-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sb-item-nickname,
.sb-item-nickname-hint {
  font-family: var(--cs-font-ui);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  transition: color var(--cs-transition), opacity var(--cs-transition);
}

.sb-item-nickname {
  color: var(--cs-text-muted);
}

.sb-item:hover .sb-item-nickname,
.sb-item.active .sb-item-nickname {
  color: var(--cs-text-tertiary);
}

/* Empty-state hint — not rendered (display: none) at rest so the row stays
   compact; revealed only while the row is hovered. The layout shift on hover
   is intentional per the spec. */
.sb-item-nickname-hint {
  color: var(--cs-text-dim);
  font-style: italic;
  display: none;
}

.sb-item:hover .sb-item-nickname-hint {
  display: block;
}

.sb-item-nickname-input {
  font-family: var(--cs-font-ui);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: -0.005em;
  color: var(--cs-text-secondary);
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  margin: 0;
  width: 100%;
  min-width: 0;
  /* Match the row height of the nickname so the layout doesn't jump on enter/exit. */
  line-height: 1.35;
}
```

- [ ] **Step 3: Anchor the right column to the name row**

The right column (`.sb-item-status`, `.sb-iso`, `.sb-item-count`) inherits `align-items: start` from the grid change in Step 1, so it now sits at the top. Pad it down slightly so it visually aligns to the name baseline instead of the very top of the row. Append:

```css
.sb-item-status {
  padding-top: 1px;
}
```

The delete button is absolutely positioned with `top: 50%` (already in the file around line 220) — leave it centered on the whole row; that's still acceptable visually because the delete button only appears on hover and replaces the status column.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`

Verify:
- Workspaces with no nickname at rest look identical to before — single line, no hint visible, count/dot on the right.
- Hover over an empty workspace → faint italic "add nickname" appears below the name. Row height grows by ~14px. The count/dot stays anchored to the name row.
- Workspaces with a nickname always show the dim second line. Long nicknames truncate with ellipsis; full text in the tooltip on hover.
- Active workspace's nickname is slightly brighter than inactive.
- Edit mode looks visually consistent with the nickname row (same size/font), input is borderless and inherits the row background.
- Switching between empty and set nickname doesn't cause layout judder beyond the expected row-height change on hover.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Sidebar.css
git commit -m "feat(sidebar): styles for nickname row, hint, and edit input"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass (the new `workspaces-store.test.js` + any existing tests).

- [ ] **Step 2: Manual end-to-end test in `npm run dev`**

Walk through this scenario in the running app:

1. Launch with at least one existing workspace.
2. Hover the workspace row → "add nickname" hint appears.
3. Double-click the hint → input opens, focused.
4. Type `client redesign`, press Enter → nickname appears as dim subtitle.
5. Restart the app (`Ctrl+R` in dev) → nickname persists.
6. Double-click the nickname → input reopens with `client redesign` pre-selected.
7. Type a replacement, click another workspace row → previous edit commits, focus switches to the clicked row.
8. Double-click an inactive workspace's nickname slot to edit → active workspace does NOT change.
9. Edit a nickname, press Esc → input closes, original text restored.
10. Edit a nickname to empty string and press Enter → second line disappears, hover-hint behavior restored.
11. Try typing more than 40 characters → input refuses extra characters at the boundary.

- [ ] **Step 3: Inspect `workspaces.json`**

Open `%APPDATA%/CodeSpace/workspaces.json` in a text editor. Each workspace object should include `"nickname": "..."` or `"nickname": null`. Old workspaces upgraded silently to `null`.

- [ ] **Step 4: No commit at this step**

This is a verification-only step. If anything in Step 2 fails, return to the relevant task and fix in a separate commit. No "verification passed" commit needed.

---

## Out of scope

- Renaming the workspace `name` itself (still set only at creation).
- Showing the nickname anywhere outside the sidebar (window title, drag preview, etc.).
- Search/filter by nickname.
- Color-coding or icons per nickname.
- React Testing Library harness for sidebar interactions (`tests/` is empty for UI; matches how rename shipped in `TerminalPane`).
