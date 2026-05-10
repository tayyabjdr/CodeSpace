# Codex Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI's `codex` CLI as a second selectable agent type alongside Claude, with per-pane picker, persistence of the Claude/Codex split, and CLI availability detection.

**Architecture:** Single new branch in `shellSpec()` for spawning codex, a small floating picker shared by every "add agent" entry point, and a `agentCount: N` → `agentCounts: { claude, codex }` schema bump with read-time migration. Each pane's `shell` field becomes load-bearing (it was already there, just always `'claude'`).

**Tech Stack:** Electron + React + Vite + node-pty. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-11-codex-agents-design.md`.

**Notes for the implementer:**
- This codebase has no unit tests today (vitest is configured but `tests/` is empty). Verification = `npm run build` succeeds + manual smoke in `npm run dev`. The plan is explicit at each step about what to look for in the running app.
- Windows-only project. Test from a Windows shell with both `claude` and `codex` ideally on PATH; if only one is installed, the disabled-row tooltip should still be reachable.
- The codespace is in a worktree at `.codespace/worktrees/ad0da9fc-928b-4ee1-81f5-6b0528462393/` but the actual source files live under the parent `C:\Users\TJ\Desktop\ControlDeck\CodeSpace\` — `git status` shows changes against the parent paths (`../../../src/...`). Edit the parent paths directly.
- Frequent commits. Each task is one commit.

---

## File map

**Create:**
- `src/renderer/components/AgentTypePicker.jsx` — floating popover, shared by all add-agent entry points
- `src/renderer/components/AgentTypePicker.css` — styles for the popover

**Modify (main process):**
- `src/main/pty-manager.js` — add `codex` branch to `shellSpec()`; add `isCodexAvailable()`
- `src/main/ipc-handlers.js` — `codex-missing` error path; new `agents:availability` handler
- `src/main/settings-store.js` — add `agents.codexDangerouslyBypassApprovals` default + validator
- `src/main/workspaces-store.js` — bump to `version: 2`, `agentCount` → `agentCounts: { claude, codex }`, read-time migration

**Modify (preload):**
- `src/preload/index.js` — expose `agents.getAvailability()`

**Modify (renderer):**
- `src/renderer/constants.js` — `AGENT_TYPES`, `AGENT_LABELS`
- `src/renderer/settings-store.js` — sync DEFAULTS with new codex toggle
- `src/renderer/design-tokens.css` — add `--cs-violet` token for Codex badge
- `src/renderer/App.jsx` — `materializeAgents` takes items array; `addAgent(shell)`; picker state; availability fetch; `agentCount` → `agentCounts` everywhere; lazy-spawn builds items from counts
- `src/renderer/components/TerminalPane.jsx` — agent-type badge in header
- `src/renderer/components/TerminalPane.css` — badge styles
- `src/renderer/components/Onboarding.jsx` — split control under the 1–8 grid; `onLaunch` passes `{claude, codex}`
- `src/renderer/components/Onboarding.css` — split control styles
- `src/renderer/components/SettingsModal.jsx` — Codex bypass toggle under the Claude toggle

---

## Task 1: Constants and design tokens

**Files:**
- Modify: `src/renderer/constants.js`
- Modify: `src/renderer/design-tokens.css`

- [ ] **Step 1: Add agent-type constants**

Append to `src/renderer/constants.js`:

```javascript

// The set of agent CLIs CodeSpace can spawn into a pane. Single source of
// truth — picker, badge, persistence, and settings all reference these
// instead of stringly-typed sprinkles.
export const AGENT_TYPES = ['claude', 'codex']

export const AGENT_LABELS = {
  claude: 'Claude',
  codex:  'Codex'
}

// Hard cap on agents per workspace (matches the 1–8 onboarding grid).
export const AGENT_COUNT_MAX = 8
```

- [ ] **Step 2: Add the Codex accent token**

Open `src/renderer/design-tokens.css` and find the existing accent tokens (search for `--cs-cyan`). Right after the existing accent block, add:

```css
  /* Codex agent accent — warmer counterpart to --cs-cyan. */
  --cs-violet: #c4b5fd;
```

(If `--cs-cyan` lives inside `:root` and there are sibling accent vars, drop `--cs-violet` next to them.)

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build completes with no errors. (No behavior change yet.)

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/constants.js src/renderer/design-tokens.css
git commit -m "feat(agents): add AGENT_TYPES/AGENT_LABELS constants and --cs-violet token"
```

---

## Task 2: Main — add `codex` branch and availability detection

**Files:**
- Modify: `src/main/pty-manager.js`

- [ ] **Step 1: Add `isCodexAvailable()`**

In `src/main/pty-manager.js`, just below the existing `checkClaudeAvailable`/`isClaudeAvailable` block (around line 6–20), add:

```javascript
let codexAvailable = null
function checkCodexAvailable() {
  if (codexAvailable !== null) return codexAvailable
  try {
    execFileSync('where', ['codex.exe'], { stdio: 'ignore', windowsHide: true })
    codexAvailable = true
  } catch {
    codexAvailable = false
  }
  return codexAvailable
}

export function isCodexAvailable() {
  return checkCodexAvailable()
}
```

- [ ] **Step 2: Add `codex` to `shellSpec()`**

Replace the existing `shellSpec` function:

```javascript
function shellSpec(shell) {
  if (shell === 'cmd') return { file: 'cmd.exe', args: [] }
  if (shell === 'claude') {
    const skip = getCached().agents.dangerouslySkipPermissions
    const cmd = skip ? 'claude --dangerously-skip-permissions' : 'claude'
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  if (shell === 'codex') {
    const bypass = getCached().agents.codexDangerouslyBypassApprovals
    const cmd = bypass ? 'codex --dangerously-bypass-approvals-and-sandbox' : 'codex'
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  return { file: 'powershell.exe', args: [] }
}
```

- [ ] **Step 3: Confirm the trust-prompt block stays Claude-only**

Re-read `createSession()` (around lines 34–67). The `if (shell === 'claude') { let trusted = false; ... }` block already gates on `claude` — no change needed. Codex with the bypass flag does not emit the "Yes, I trust this folder" string, so adding nothing here is correct.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build completes. No runtime change yet because nothing calls `shellSpec('codex')` and `agents.codexDangerouslyBypassApprovals` is `undefined` (Task 3 adds it).

- [ ] **Step 5: Commit**

```powershell
git add src/main/pty-manager.js
git commit -m "feat(main): add codex spawn branch and isCodexAvailable check"
```

---

## Task 3: Main — settings field for codex bypass

**Files:**
- Modify: `src/main/settings-store.js`

- [ ] **Step 1: Add the default and validator entry**

In `src/main/settings-store.js`:

Replace the `agents` block in `DEFAULTS` (around line 19–21):

```javascript
  agents: {
    dangerouslySkipPermissions: true,
    codexDangerouslyBypassApprovals: true
  }
```

Replace the `agents` block in `validate()` (around line 54–56):

```javascript
    agents: {
      dangerouslySkipPermissions: typeof g.dangerouslySkipPermissions === 'boolean' ? g.dangerouslySkipPermissions : DEFAULTS.agents.dangerouslySkipPermissions,
      codexDangerouslyBypassApprovals: typeof g.codexDangerouslyBypassApprovals === 'boolean' ? g.codexDangerouslyBypassApprovals : DEFAULTS.agents.codexDangerouslyBypassApprovals
    }
```

`mergeAndSave()` already shallow-spreads `base.agents` with the patch, so it picks up the new key automatically — no change there.

- [ ] **Step 2: Verify the codex branch in `shellSpec()` now reads a real value**

Run: `npm run build`
Expected: Build succeeds. The settings file on disk doesn't have the new key yet — `validate()` defaults it to `true` on load, so `getCached().agents.codexDangerouslyBypassApprovals` returns `true`.

- [ ] **Step 3: Commit**

```powershell
git add src/main/settings-store.js
git commit -m "feat(settings): add codexDangerouslyBypassApprovals default and validator"
```

---

## Task 4: Main — IPC for codex-missing error and availability

**Files:**
- Modify: `src/main/ipc-handlers.js`

- [ ] **Step 1: Import the new availability check**

Update the import on line 4:

```javascript
import { createSession, writeSession, resizeSession, killSession, isClaudeAvailable, isCodexAvailable } from './pty-manager.js'
```

- [ ] **Step 2: Add the codex-missing check to `pty:create`**

Inside the `ipcMain.handle('pty:create', ...)` body, replace the existing claude-missing line (around line 39) with:

```javascript
    if (shell === 'claude' && !isClaudeAvailable()) {
      return { error: 'claude-missing' }
    }
    if (shell === 'codex' && !isCodexAvailable()) {
      return { error: 'codex-missing' }
    }
```

- [ ] **Step 3: Add the availability handler**

Right after the `pty:kill` handler (around line 75), add:

```javascript
  ipcMain.handle('agents:availability', () => ({
    claude: isClaudeAvailable(),
    codex:  isCodexAvailable()
  }))
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/main/ipc-handlers.js
git commit -m "feat(ipc): add codex-missing error and agents:availability handler"
```

---

## Task 5: Preload — expose availability bridge

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add the agents bridge entry**

In `src/preload/index.js`, just after the `agentName` block (around line 60), add:

```javascript

  agents: {
    getAvailability: () => ipcRenderer.invoke('agents:availability'),
  },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/preload/index.js
git commit -m "feat(preload): expose agents.getAvailability bridge"
```

---

## Task 6: Renderer — settings DEFAULTS + SettingsModal Codex toggle

**Files:**
- Modify: `src/renderer/settings-store.js`
- Modify: `src/renderer/components/SettingsModal.jsx`

- [ ] **Step 1: Sync DEFAULTS in the renderer settings store**

In `src/renderer/settings-store.js`, replace the `agents` line in `DEFAULTS` (line 8):

```javascript
  agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true }
```

(The renderer DEFAULTS is only a fallback before `initSettings()` resolves; main is authoritative once it returns.)

- [ ] **Step 2: Add the Codex toggle to the Agents section**

In `src/renderer/components/SettingsModal.jsx`, replace the existing `<section>` with `<h3>Agents</h3>` (lines 136–148) with:

```jsx
          <section className="cs-settings-card">
            <h3>Agents</h3>
            <Row
              label="Skip permission prompts"
              caption={<>Runs <code>claude</code> with <code>--dangerously-skip-permissions</code></>}
            >
              <Toggle
                checked={s.agents.dangerouslySkipPermissions}
                onChange={(v) => update({ agents: { dangerouslySkipPermissions: v } })}
                ariaLabel="Skip permission prompts"
              />
            </Row>
            <Row
              label="Codex — bypass approvals and sandbox"
              caption={<>Runs <code>codex</code> with <code>--dangerously-bypass-approvals-and-sandbox</code></>}
            >
              <Toggle
                checked={s.agents.codexDangerouslyBypassApprovals}
                onChange={(v) => update({ agents: { codexDangerouslyBypassApprovals: v } })}
                ariaLabel="Codex bypass approvals and sandbox"
              />
            </Row>
          </section>
```

- [ ] **Step 3: Smoke in dev**

Run: `npm run dev`
Expected:
- App opens normally.
- Open Settings (gear icon in sidebar). The Agents card now shows two toggles. Both default ON. Flipping the Codex one persists across an app restart.

Close dev.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/settings-store.js src/renderer/components/SettingsModal.jsx
git commit -m "feat(settings-ui): add Codex bypass approvals toggle"
```

---

## Task 7: Persistence schema — `agentCount` → `agentCounts`

**Files:**
- Modify: `src/main/workspaces-store.js`

- [ ] **Step 1: Replace load and save with v2-aware versions**

Replace the entire contents of `src/main/workspaces-store.js` with:

```javascript
import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'workspaces.json'
const SCHEMA_VERSION = 2
const AGENT_COUNT_MAX = 8

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

const EMPTY = { workspaces: [], activeWorkspaceId: null }

let lastLoadCorruptBackup = null

export function consumeCorruptBackupNotice() {
  const path = lastLoadCorruptBackup
  lastLoadCorruptBackup = null
  return path
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${path}.corrupt-${ts}`
  try {
    await fs.rename(path, backup)
    lastLoadCorruptBackup = backup
  } catch {
    // best-effort — if rename fails, leave the file in place
  }
}

// Coerce any persisted shape (v1 `agentCount`, v2 `agentCounts`, garbage) into
// a clamped {claude, codex} object. Total can't exceed AGENT_COUNT_MAX —
// when truncation is required, Codex is dropped first so existing Claude
// workspaces never lose panes during the v1→v2 migration.
function sanitizeAgentCounts(w) {
  let claude = 0
  let codex  = 0
  if (w && w.agentCounts && typeof w.agentCounts === 'object') {
    if (Number.isFinite(w.agentCounts.claude)) claude = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCounts.claude)))
    if (Number.isFinite(w.agentCounts.codex))  codex  = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCounts.codex)))
  } else if (Number.isFinite(w?.agentCount)) {
    claude = Math.max(0, Math.min(AGENT_COUNT_MAX, Math.floor(w.agentCount)))
  } else {
    claude = 2  // matches previous default
  }
  if (claude + codex > AGENT_COUNT_MAX) {
    codex = Math.max(0, AGENT_COUNT_MAX - claude)
  }
  return { claude, codex }
}

export async function loadWorkspaces() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY
    return EMPTY
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    return EMPTY
  }

  if (!parsed || !Array.isArray(parsed.workspaces)) {
    await quarantineCorrupt(path)
    return EMPTY
  }

  return {
    workspaces: parsed.workspaces.map(w => ({
      id: String(w.id),
      name: String(w.name ?? 'Workspace'),
      dir: String(w.dir ?? ''),
      agentCounts: sanitizeAgentCounts(w),
      isolated: !!w.isolated,
      editor: sanitizeEditor(w.editor)
    })),
    activeWorkspaceId: parsed.activeWorkspaceId ?? null
  }
}

function sanitizeEditor(e) {
  if (!e || typeof e !== 'object') return undefined
  return {
    open:  !!e.open,
    file:  typeof e.file === 'string' ? e.file : null,
    line:  Number.isFinite(e.line) ? e.line : null,
    width: Number.isFinite(e.width) ? e.width : 0
  }
}

export async function saveWorkspaces(state) {
  const safe = {
    version: SCHEMA_VERSION,
    workspaces: (state?.workspaces ?? []).map(w => ({
      id: w.id,
      name: w.name,
      dir: w.dir,
      agentCounts: sanitizeAgentCounts(w),
      isolated: !!w.isolated,
      editor: sanitizeEditor(w.editor)
    })),
    activeWorkspaceId: state?.activeWorkspaceId ?? null
  }
  const path = filePath()
  const tmp = `${path}.tmp`
  const data = JSON.stringify(safe, null, 2)
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, path)
}
```

- [ ] **Step 2: Verify the renderer (which still sends `agentCount`) is gracefully accepted**

Run: `npm run build`
Expected: Build succeeds. At this point the renderer is still emitting `agentCount` on save; `sanitizeAgentCounts` converts it. Old v1 files on disk also migrate. Renderer migration to `agentCounts` comes in Task 11.

- [ ] **Step 3: Commit**

```powershell
git add src/main/workspaces-store.js
git commit -m "feat(persistence): bump to schema v2 with agentCounts {claude, codex}"
```

---

## Task 8: AgentTypePicker component

**Files:**
- Create: `src/renderer/components/AgentTypePicker.jsx`
- Create: `src/renderer/components/AgentTypePicker.css`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/AgentTypePicker.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { AGENT_TYPES, AGENT_LABELS } from '../constants.js'
import './AgentTypePicker.css'

const DESCRIPTIONS = {
  claude: 'Anthropic Claude CLI',
  codex:  'OpenAI Codex CLI'
}

const MISSING_HINTS = {
  claude: 'claude not found on PATH — install Claude Code',
  codex:  'codex not found on PATH — install OpenAI Codex CLI'
}

// Floating popover anchored to an existing button (toolbar/pane "+", empty-
// workspace "New Agent", or Ctrl+T virtual anchor). Closes on selection,
// ESC, outside-click, and window blur.
//
// Props:
//   - availability: { claude: boolean, codex: boolean }
//   - anchorRect:   DOMRect-like { left, top, right, bottom } in viewport coords,
//                   or null to center near the top of the active workspace.
//   - onPick:       (shell) => void  — called with the chosen agent type
//   - onClose:      () => void
export default function AgentTypePicker({ availability, anchorRect, onPick, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onBlur = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  // Position: below-right of the anchor, or top-center if no anchor.
  const style = (() => {
    if (!anchorRect) {
      return { left: '50%', top: 80, transform: 'translateX(-50%)' }
    }
    return { left: anchorRect.left, top: anchorRect.bottom + 6 }
  })()

  const allMissing = AGENT_TYPES.every(t => !availability?.[t])

  return (
    <div className="agent-picker" ref={ref} style={style} role="menu" aria-label="Choose agent type">
      {allMissing && (
        <div className="agent-picker-empty">
          Neither <code>claude</code> nor <code>codex</code> was found on PATH. Install one of them and restart CodeSpace.
        </div>
      )}
      {!allMissing && AGENT_TYPES.map(shell => {
        const available = !!availability?.[shell]
        return (
          <button
            key={shell}
            type="button"
            className={`agent-picker-row agent-picker-row-${shell}${available ? '' : ' is-disabled'}`}
            disabled={!available}
            title={available ? '' : MISSING_HINTS[shell]}
            onClick={() => available && onPick(shell)}
            role="menuitem"
          >
            <span className={`agent-picker-badge agent-picker-badge-${shell}`}>{shell}</span>
            <span className="agent-picker-label">{AGENT_LABELS[shell]}</span>
            <span className="agent-picker-desc">{DESCRIPTIONS[shell]}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create the styles**

Create `src/renderer/components/AgentTypePicker.css`:

```css
.agent-picker {
  position: fixed;
  z-index: 1000;
  min-width: 280px;
  background: var(--cs-surface-1, #11151b);
  border: 1px solid var(--cs-border-2, #2b3038);
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: agent-picker-in 140ms ease-out;
}

@keyframes agent-picker-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.agent-picker-empty {
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--cs-text-dim, rgba(255,255,255,0.6));
}
.agent-picker-empty code {
  background: rgba(255,255,255,0.06);
  padding: 1px 5px;
  border-radius: 3px;
}

.agent-picker-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--cs-text-primary, rgba(255,255,255,0.92));
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 120ms ease, border-color 120ms ease;
}
.agent-picker-row:hover:not(.is-disabled) {
  background: rgba(255,255,255,0.04);
  border-color: var(--cs-border-2, #2b3038);
}
.agent-picker-row.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.agent-picker-badge {
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
  font-size: 10.5px;
  text-transform: lowercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  letter-spacing: 0.02em;
}
.agent-picker-badge-claude {
  color: var(--cs-cyan, #67e8f9);
  border-color: rgba(103, 232, 249, 0.4);
  background: rgba(103, 232, 249, 0.08);
}
.agent-picker-badge-codex {
  color: var(--cs-violet, #c4b5fd);
  border-color: rgba(196, 181, 253, 0.4);
  background: rgba(196, 181, 253, 0.08);
}

.agent-picker-label {
  font-size: 13px;
  font-weight: 500;
}
.agent-picker-desc {
  font-size: 11.5px;
  color: var(--cs-text-dim, rgba(255,255,255,0.55));
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. (Component not wired in yet; that's Task 11.)

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/components/AgentTypePicker.jsx src/renderer/components/AgentTypePicker.css
git commit -m "feat(ui): add AgentTypePicker popover component"
```

---

## Task 9: TerminalPane — agent badge in header

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx`
- Modify: `src/renderer/components/TerminalPane.css`

- [ ] **Step 1: Render the badge next to the agent name**

Open `src/renderer/components/TerminalPane.jsx`. Find the pane-header area where `displayName` is rendered (search for `displayName` — it appears around line 26, and is rendered inside the header label). Locate the JSX that shows the display name (likely a `<span>` or similar inside the header). Add the badge directly after the name span, only when not editing.

Use a Grep to find the exact spot:

```
Grep: displayName in TerminalPane.jsx
```

Then replace the name-rendering line. The expected pattern is something like:

```jsx
<span className="pane-name">{displayName}</span>
```

Replace with:

```jsx
<span className="pane-name">{displayName}</span>
{!editing && shell && (
  <span className={`tp-agent-badge tp-badge-${shell}`} title={shell}>{shell}</span>
)}
```

If the surrounding element handles the rename input differently (`editing` swaps in an `<input>` instead of the span), keep the same `!editing && shell` guard so the badge hides during rename. Look at how `editing` is already used in the file — the badge should follow the same pattern.

- [ ] **Step 2: Add badge styles**

Append to `src/renderer/components/TerminalPane.css`:

```css

/* Agent-type badge — small monospace pill rendered next to the agent name
   in the pane header. Hidden while the pane is in rename mode. */
.tp-agent-badge {
  display: inline-flex;
  align-items: center;
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
  font-size: 9.5px;
  text-transform: lowercase;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  margin-left: 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  line-height: 1.4;
  vertical-align: middle;
  user-select: none;
}
.tp-badge-claude {
  color: var(--cs-cyan, #67e8f9);
  border-color: rgba(103, 232, 249, 0.35);
  background: rgba(103, 232, 249, 0.06);
}
.tp-badge-codex {
  color: var(--cs-violet, #c4b5fd);
  border-color: rgba(196, 181, 253, 0.35);
  background: rgba(196, 181, 253, 0.06);
}
```

- [ ] **Step 3: Smoke in dev**

Run: `npm run dev`
Expected:
- Existing workspaces open. Each pane's header now shows a small `claude` badge next to the agent name.
- Double-click the name to rename — the badge disappears while editing and returns when you press Enter/Esc.

Close dev.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/components/TerminalPane.jsx src/renderer/components/TerminalPane.css
git commit -m "feat(ui): show agent-type badge in pane header"
```

---

## Task 10: Onboarding — split control under the 1–8 grid

**Files:**
- Modify: `src/renderer/components/Onboarding.jsx`
- Modify: `src/renderer/components/Onboarding.css`

- [ ] **Step 1: Add availability and split state, change `onLaunch` shape**

In `src/renderer/components/Onboarding.jsx`:

After the existing `useState` block (around line 67), add:

```javascript
  const [availability, setAvailability] = useState({ claude: true, codex: true })
  const [codexShare, setCodexShare] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.agents?.getAvailability?.().then(av => {
      if (cancelled || !av) return
      setAvailability(av)
      // If only one CLI is installed, force that type for all slots.
      if (av.codex && !av.claude) setCodexShare(selectedCount)
      else if (!av.codex && av.claude) setCodexShare(0)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Then add an effect that clamps `codexShare` whenever the total changes:

```javascript
  useEffect(() => {
    setCodexShare(prev => Math.max(0, Math.min(selectedCount, prev)))
  }, [selectedCount])
```

The claude share is derived: `const claudeShare = selectedCount - codexShare`.

Replace the existing `handleLaunch` (around line 115) with:

```javascript
  const handleLaunch = () => {
    if (!canLaunch) return
    setLaunching(true)
    const counts = { claude: selectedCount - codexShare, codex: codexShare }
    setTimeout(() => onLaunch(counts, projectDir, name.trim(), isolated), ONBOARDING_BOOT_DELAY_MS)
  }
```

- [ ] **Step 2: Render the split control**

In the JSX, find the agents card (`<section className="ob-col">` containing `<label className="ob-label">Agents</label>` and the cards grid — around line 190–211). Right after the `</div>` that closes `<div className="ob-cards">`, insert:

```jsx
              {availability.claude && availability.codex && (
                <div className="ob-split">
                  <div className="ob-split-title">
                    <span>{selectedCount - codexShare} Claude</span>
                    <span className="ob-split-dot">·</span>
                    <span>{codexShare} Codex</span>
                  </div>
                  <div className="ob-split-bar" role="group" aria-label="Split agents between Claude and Codex">
                    <button
                      type="button"
                      className="ob-split-seg ob-split-claude"
                      onClick={() => setCodexShare(s => Math.max(0, s - 1))}
                      disabled={selectedCount - codexShare <= 0}
                      title="More Claude (fewer Codex)"
                    >
                      − Claude
                    </button>
                    <button
                      type="button"
                      className="ob-split-seg ob-split-codex"
                      onClick={() => setCodexShare(s => Math.min(selectedCount, s + 1))}
                      disabled={codexShare >= selectedCount}
                      title="More Codex (fewer Claude)"
                    >
                      + Codex
                    </button>
                  </div>
                </div>
              )}
              {(!availability.claude || !availability.codex) && (
                <p className="ob-split-hint">
                  Only <code>{availability.claude ? 'claude' : 'codex'}</code> detected on this machine. All agents will be {availability.claude ? 'Claude' : 'Codex'}.
                </p>
              )}
```

- [ ] **Step 3: Style the split control**

Append to `src/renderer/components/Onboarding.css`:

```css

/* Onboarding split control — sits under the 1–8 agent count grid, splits
   the chosen total between Claude and Codex. Locked-sum: clicking − Claude
   moves one slot to Codex and vice versa. */
.ob-split {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ob-split-title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--cs-text-dim, rgba(255,255,255,0.6));
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
}
.ob-split-dot { opacity: 0.5; }
.ob-split-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ob-split-seg {
  padding: 8px 10px;
  font: inherit;
  font-size: 12.5px;
  background: var(--cs-surface-1, #11151b);
  color: var(--cs-text-primary, rgba(255,255,255,0.88));
  border: 1px solid var(--cs-border-2, #2b3038);
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ob-split-seg:hover:not(:disabled) {
  background: rgba(255,255,255,0.04);
}
.ob-split-seg:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ob-split-claude { color: var(--cs-cyan, #67e8f9); }
.ob-split-codex  { color: var(--cs-violet, #c4b5fd); }

.ob-split-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--cs-text-dim, rgba(255,255,255,0.55));
}
.ob-split-hint code {
  background: rgba(255,255,255,0.06);
  padding: 1px 5px;
  border-radius: 3px;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds. Onboarding won't fully work yet because App.jsx still expects `onLaunch(count, dir, name, isolated)`; the renderer wiring is in Task 11.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/Onboarding.jsx src/renderer/components/Onboarding.css
git commit -m "feat(onboarding): split control for Claude/Codex allocation"
```

---

## Task 11: App.jsx — items-based materialize, picker wiring, persistence

This is the biggest task. Done in one commit so the in-memory shape, the persistence shape, and the picker all change together.

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Add imports**

Add to the existing import block at the top of `src/renderer/App.jsx`:

```javascript
import AgentTypePicker from './components/AgentTypePicker.jsx'
import { AGENT_TYPES } from './constants.js'
```

- [ ] **Step 2: Add availability + picker state**

Inside `AppInner()`, near the other `useState` declarations (around line 78–89), add:

```javascript
  const [availability, setAvailability] = useState({ claude: true, codex: true })
  const [pickerState, setPickerState] = useState(null) // null | { anchorRect: DOMRect|null }
```

- [ ] **Step 3: Fetch availability on mount**

Add an effect right after the `loadWorkspaces` effect (after line ~150):

```javascript
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.agents?.getAvailability?.().then(av => {
      if (cancelled || !av) return
      setAvailability(av)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 4: Rewrite `materializeAgents` to take an items array**

Replace the existing `materializeAgents` (lines 94–119) with:

```javascript
  // `items` is an array like [{shell:'claude'}, {shell:'codex'}]. Each entry
  // becomes one terminal record; isolated workspaces create one worktree per
  // entry. Spawn order is preserved so persisted (claude-first, codex-last)
  // ordering survives a lazy re-spawn.
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
```

- [ ] **Step 5: Convert `addAgent` to take a `shell` argument**

Replace `addAgent` (around lines 461–473) with:

```javascript
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
```

- [ ] **Step 6: Picker open/close helpers**

Add below `addAgent`:

```javascript
  const openPicker = useCallback((anchorEl) => {
    const rect = anchorEl?.getBoundingClientRect?.() ?? null
    setPickerState({ anchorRect: rect })
  }, [])
  const closePicker = useCallback(() => setPickerState(null), [])
  const handlePickAgent = useCallback((shell) => {
    setPickerState(null)
    addAgent(shell)
  }, [addAgent])
```

- [ ] **Step 7: Update Ctrl+T to open the picker**

In the keyboard-shortcut effect (around lines 692–695), replace the Ctrl+T branch:

```javascript
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        openPicker(null)
      }
```

(Update the effect's dependency array: replace `addAgent` with `openPicker`.)

- [ ] **Step 8: Update `handleOnboardingLaunch` and `handleInitializeDraft` to take `counts`**

Replace `handleOnboardingLaunch` (around lines 295–314):

```javascript
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
      spawned: false,
      fontSize: getSettings().appearance.defaultPaneFontSize,
      editor: defaultEditorState()
    }
    setWorkspaces([ws])
    setActiveId(ws.id)
  }, [])
```

Replace `handleInitializeDraft` (around lines 340–361):

```javascript
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
```

Add the helper near the top of the file, outside `AppInner` (next to `makeId`):

```javascript
function countsToItems(counts) {
  const c = Math.max(0, Number(counts?.claude) || 0)
  const x = Math.max(0, Number(counts?.codex)  || 0)
  return [
    ...Array.from({ length: c }, () => ({ shell: 'claude' })),
    ...Array.from({ length: x }, () => ({ shell: 'codex'  }))
  ]
}
```

- [ ] **Step 9: Update `handleStartDraft` to use `agentCounts`**

Replace `handleStartDraft` (around lines 319–335):

```javascript
  const handleStartDraft = useCallback(() => {
    const ws = {
      id: makeId(),
      name: 'New Workspace',
      dir: '',
      agentCounts: { claude: 0, codex: 0 },
      terminals: [],
      agentCounter: 0,
      focusedTerminalId: null,
      spawned: false,
      fontSize: getSettings().appearance.defaultPaneFontSize,
      editor: defaultEditorState(),
      unconfigured: true
    }
    setWorkspaces(prev => [...prev, ws])
    setActiveId(ws.id)
  }, [])
```

- [ ] **Step 10: Update the lazy-spawn effect to build items from `agentCounts`**

In the lazy-spawn effect (around lines 254–293), replace the line:

```javascript
      const terminals = await materializeAgents(w0, w0.agentCount, 1)
```

with:

```javascript
      const items = countsToItems(w0.agentCounts)
      const terminals = await materializeAgents(w0, items, 1)
```

Also update the `setWorkspaces` block at the end of the same effect:

```javascript
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
```

- [ ] **Step 11: Update workspace mapping in load to use `agentCounts`**

In the loadWorkspaces resolved block (around line 133–141), replace the workspace map:

```javascript
      const restored = (state?.workspaces ?? []).map(w => ({
        ...w,
        agentCounts: w.agentCounts ?? { claude: w.agentCount ?? 0, codex: 0 },
        terminals: [],
        agentCounter: 0,
        focusedTerminalId: null,
        spawned: false,
        fontSize: getSettings().appearance.defaultPaneFontSize,
        editor: w.editor ? { ...defaultEditorState(), ...w.editor, dirty: false, scroll: 0 } : defaultEditorState()
      }))
```

- [ ] **Step 12: Update the persist effect to write `agentCounts` derived from live terminals**

In the persist effect (around lines 165–180), replace the inner mapper:

```javascript
      const persistable = workspaces.filter(w => !w.unconfigured)
      const activeIsDraft = workspaces.find(w => w.id === activeId)?.unconfigured
      window.electronAPI.saveWorkspaces({
        workspaces: persistable.map(w => {
          const claude = w.terminals.filter(t => t.shell === 'claude').length
          const codex  = w.terminals.filter(t => t.shell === 'codex').length
          // Pre-spawn workspaces have no terminals yet — fall back to agentCounts so
          // we don't overwrite the configured split with zeros before lazy-spawn runs.
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
```

- [ ] **Step 13: Update `handleConfirmDelete`'s save call the same way**

In `handleConfirmDelete` (around lines 401–408), replace the `workspaces` map inside the `saveWorkspaces` call with the same `agentCounts` derivation:

```javascript
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
```

- [ ] **Step 14: Wire the picker into TerminalPane's `+` button and the empty-workspace button**

Find the `onAddAgent={addAgent}` prop on `<TerminalPane>` (around line 819). Replace with a wrapper that opens the picker:

```jsx
                  onAddAgent={(anchorEl) => openPicker(anchorEl)}
```

But the existing `onAddAgent` signature is `() => void` — the button calls `onAddAgent?.()`. We need to pass the anchor. The cleanest fix is to change `TerminalPane.jsx` to forward the event-target's button.

In `src/renderer/components/TerminalPane.jsx`, replace the existing pane-add-btn click handler:

```jsx
            onClick={e => { e.stopPropagation(); onAddAgent?.(e.currentTarget) }}
```

Back in App.jsx, the `onAddAgent` prop is now `(anchorEl) => openPicker(anchorEl)`.

For the empty-workspace "New Agent" button (around lines 794–799), replace the `onClick` with:

```jsx
                  <button className="empty-btn" onClick={(e) => openPicker(e.currentTarget)}>
```

For the Toolbar `onAdd` prop on line 755 — that callback was previously `addAgent` (which spawned directly). Replace with a picker-opener. The Toolbar `+` button doesn't currently render in this codebase (the prop is unused), but to keep the wiring forward-compatible:

```jsx
        onAdd={() => openPicker(null)}
```

- [ ] **Step 15: Render the picker**

At the bottom of `AppInner`'s return JSX, just before `</div>` of the outer `<div className="app">` (right after the existing `SettingsModal` / `ConfirmDialog` blocks), add:

```jsx
      {pickerState && (
        <AgentTypePicker
          availability={availability}
          anchorRect={pickerState.anchorRect}
          onPick={handlePickAgent}
          onClose={closePicker}
        />
      )}
```

- [ ] **Step 16: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 17: Smoke in dev — golden path**

Run: `npm run dev`

Test sequence (do every step):

1. App opens to an existing workspace OR Onboarding.
2. **If Onboarding**: pick a folder, choose 4 agents in the grid. With both CLIs installed, the split control appears under the grid showing "4 Claude · 0 Codex". Click **+ Codex** twice → "2 Claude · 2 Codex". Click **Initialize** → workspace opens with 2 panes labeled `claude` and 2 labeled `codex`. Codex panes show `codex --dangerously-bypass-approvals-and-sandbox` running.
3. Press **Ctrl+T** → picker appears centered near the top. Click **Codex** → a new Codex pane appears.
4. Click the **+** button in any pane header → picker appears anchored below that button. Pick **Claude** → new Claude pane appears.
5. Close one pane (`x`) → it disappears; remaining panes renumber.
6. Quit the app (Ctrl+Q or close window). Relaunch.
7. The workspace reopens with the same per-type split as before the close (e.g. if you ended with 3 Claude and 2 Codex, it comes back with 3 Claude and 2 Codex).
8. Open Settings → Agents card shows both toggles. Toggle off "Codex — bypass approvals and sandbox" → close settings → Ctrl+T → pick Codex → new pane runs plain `codex` with no bypass flag.

If anything in 1–8 fails, fix before moving on. The most likely failure is a missing `availability[shell]` guard or a stale `agentCount` field somewhere — search `agentCount` in App.jsx and confirm zero occurrences remain (only `agentCounter` and `agentCounts`).

- [ ] **Step 18: Smoke in dev — CLI missing**

If you have one of `claude.exe` or `codex.exe` not on PATH (or temporarily rename one for the test):

1. Restart `npm run dev`.
2. Ctrl+T → picker shows the missing row greyed out with a tooltip on hover ("codex not found on PATH — …" or vice versa).
3. Onboarding (new workspace) → split control hides; the hint "Only `claude` detected on this machine" appears.

Restore PATH if you renamed anything.

- [ ] **Step 19: Commit**

```powershell
git add src/renderer/App.jsx src/renderer/components/TerminalPane.jsx
git commit -m "feat(agents): wire AgentTypePicker, items-based materialize, agentCounts persistence"
```

---

## Task 12: Manual migration check

**Files:** none modified — verification only.

- [ ] **Step 1: Verify v1 → v2 migration with a real file**

Stop dev. Locate the workspaces file:

```powershell
Get-Content "$env:APPDATA\CodeSpace\workspaces.json"
```

Confirm it now contains `"version": 2` and each workspace has `"agentCounts": { "claude": N, "codex": M }` with no `agentCount` field.

If you have a backup of a v1 file (e.g. from before this branch), restore it temporarily and run `npm run dev` once to confirm it migrates cleanly — workspaces open with the same number of (all-Claude) panes they had before, then a save rewrites the file in v2 shape.

- [ ] **Step 2: Final build + clean status**

Run: `npm run build`
Expected: clean build.

Run: `git status`
Expected: clean working tree (all 11 task commits in place).

- [ ] **Step 3: Tag the merge candidate**

No commit needed for this task. Open a PR for `cs/codespace/ad0da9fc` against `master` whenever ready.

---

## Self-review against the spec

(Done by the planner as a sanity check; the implementer can skim.)

- §"Main process — spawn + availability" → Task 2 (`codex` branch + `isCodexAvailable`), Task 4 (IPC `codex-missing` + `agents:availability`), Task 3 (settings field).
- §"Persistence schema" → Task 7 (v2 + sanitizer), Task 11 step 11–13 (renderer load/save derives from terminals).
- §"Renderer — state + picker + onboarding" → Task 8 (component), Task 10 (onboarding split), Task 11 (App.jsx wiring).
- §"Settings, done-tracker, auto-namer, isolation" → Task 6 (Codex toggle); spec confirms no change for done-tracker/auto-namer/isolation, plan reflects that.
- §"Error paths" → Task 4 (IPC error), Task 11 step 4 (materialize logs and skips on error), Task 11 step 12 (persist derives from live terminals so missing-codex panes self-prune on save).
- §"Out of scope" — no tasks for per-pane re-typing, model selection, etc.

All explicit spec requirements have a task. The picker's "both missing" empty state is in Task 8. The truncate-codex-first behavior is in Task 7's `sanitizeAgentCounts`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-codex-agents.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
