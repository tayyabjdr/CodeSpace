# Codex agents — design

**Date:** 2026-05-11
**Status:** approved, ready for implementation plan

## Summary

CodeSpace today spawns every pane as a Claude CLI session. This feature adds OpenAI's `codex` CLI as a second supported agent type. Users pick the type per agent (no global mode), can mix Claude and Codex panes in the same workspace, and the choice persists across sessions.

The change is a lightweight extension of the existing single-agent architecture: one new branch in `shellSpec()`, a small picker UI, and a persistence-schema bump from a single `agentCount` to `agentCounts: { claude, codex }`.

## Goals

- Add Codex (`codex --dangerously-bypass-approvals-and-sandbox` by default) as a selectable agent type.
- Per-agent type choice: workspaces can freely mix Claude and Codex panes.
- Workspace creation lets users split the chosen total between Claude and Codex.
- Adding an agent mid-session opens a small picker.
- Persist the per-type split so reopening a workspace restores the same mix.
- Show which type each pane is via a small text badge in the pane header.
- Detect missing CLIs and surface that in the picker rather than failing inside the PTY.

## Non-goals

- No per-pane re-typing (cannot convert a live Claude pane into a Codex pane without closing and re-adding).
- No Codex-specific settings beyond a sandbox-bypass toggle that parallels Claude's `dangerouslySkipPermissions`.
- No Codex model selection inside the app — defer to codex's own config.
- No visual differentiation beyond the text badge (no colored pane borders, no different cursor colors).
- No first-run auto-accept logic for Codex (the bypass flag covers it).

## Architecture overview

The pivot point is `src/main/pty-manager.js`'s `shellSpec()`. Today it switches on `shell` and returns `{file, args}` for `cmd`, `claude`, or default PowerShell. Adding a `codex` case is the smallest possible change. From there:

- Main exposes a new IPC channel for availability (`agents:availability`) so the renderer can grey out unavailable options without trying to spawn.
- Settings gain one new field: `agents.codexDangerouslyBypassApprovals` (defaults `true`, mirrors the Claude toggle).
- Persistence bumps to `version: 2` — the only field change is `agentCount: number` → `agentCounts: { claude: number, codex: number }`. Read-time migration handles v1 files transparently.
- The renderer's `terminals[]` already has a `shell` field on each pane; that becomes load-bearing instead of a constant. `materializeAgents()` takes an items array of `{shell}` instead of a count.
- A new `AgentTypePicker` component is shared by the toolbar `+` button, the empty-workspace "New Agent" button, and `Ctrl+T`.
- `Onboarding` keeps its 1–8 grid for total `N`, adds a two-segment split control for Claude/Codex allocation.

The done-tracker, auto-namer, and worktree isolation are all agent-agnostic and require no changes.

## Detailed design

### 1. Main process — spawn + availability

`src/main/pty-manager.js`:

- `shellSpec()` adds a `codex` branch:
  - With `settings.agents.codexDangerouslyBypassApprovals === true`: `{ file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', 'codex --dangerously-bypass-approvals-and-sandbox'] }`.
  - Otherwise: `{ file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', 'codex'] }`.
- New `isCodexAvailable()` mirrors `isClaudeAvailable()` — cached `where codex.exe` probe via `execFileSync`.
- The `if (shell === 'claude') { ...trust prompt swallow... }` block stays gated on `claude` only. Codex with bypass on emits no comparable prompt.

`src/main/ipc-handlers.js`:

- `pty:create` adds a parallel check: `if (shell === 'codex' && !isCodexAvailable()) return { error: 'codex-missing' }`.
- New handler: `ipcMain.handle('agents:availability', () => ({ claude: isClaudeAvailable(), codex: isCodexAvailable() }))`. Called once on renderer mount; not re-polled.

`src/main/settings-store.js`:

- `DEFAULTS.agents` gains `codexDangerouslyBypassApprovals: true`.
- `validate()` carries the new field with a boolean check identical to the existing `dangerouslySkipPermissions`.
- `mergeAndSave()`'s `agents` spread already merges new keys without any other change.
- Settings file `version` stays at 1 — missing keys default in on load, so old settings files self-heal.

`src/preload/index.js`:

- Expose `agents: { getAvailability: () => ipcRenderer.invoke('agents:availability') }` on the bridge.

### 2. Persistence schema

`src/main/workspaces-store.js` bumps to `version: 2`:

```jsonc
{
  "version": 2,
  "workspaces": [
    {
      "id": "...",
      "name": "...",
      "dir": "...",
      "isolated": false,
      "agentCounts": { "claude": 2, "codex": 1 },
      "editor": { ... }
    }
  ],
  "activeWorkspaceId": "..."
}
```

Read-time migration:

- For each workspace in a loaded file, if `agentCounts` is absent and `agentCount` is a finite number, set `agentCounts = { claude: agentCount, codex: 0 }` and drop `agentCount` from the in-memory shape.
- The validator clamps each count to `[0, 8]`. If the sum exceeds 8 (existing grid cap), Codex is truncated first to bring the total to 8 (Claude is preserved as the historical default). Non-numeric/garbled input falls back to `{ claude: 0, codex: 0 }`.
- Save always writes the v2 schema. Files self-heal on first save after upgrade.
- Save derives `agentCounts` from the live `terminals` array (count by `t.shell`) — never trusts a stale `agentCounts` from state. This guarantees on-screen state and on-disk state cannot drift.

### 3. Renderer — state + picker + onboarding

`src/renderer/App.jsx`:

- `materializeAgents(workspace, count, startNum)` becomes `materializeAgents(workspace, items, startNum)` where `items` is an array of `{shell: 'claude' | 'codex'}`. Returns the same terminal records, with `shell` taken from each item.
- `addAgent()` becomes `addAgent(shell)` — called by the picker. Builds a single-item array `[{shell}]` and reuses `materializeAgents`.
- Lazy-spawn effect builds the items array from `w0.agentCounts`: all `claude` first, then all `codex`, in a stable per-session order. `agentNum` numbers sequentially across both types.
- Persist effect replaces `agentCount: w.agentCount` with `agentCounts: { claude: w.terminals.filter(t => t.shell === 'claude').length, codex: w.terminals.filter(t => t.shell === 'codex').length }`. Same swap in `handleConfirmDelete`.
- `handleOnboardingLaunch` / `handleInitializeDraft` receive `counts: {claude, codex}` from Onboarding instead of a single `count`.
- `Ctrl+T` no longer fires `addAgent()` directly — it opens the `AgentTypePicker` anchored to a virtual "shortcut" anchor (center-top of the active workspace area). `Ctrl+W` unchanged.
- App.jsx loads availability on mount in parallel with workspaces (`window.electronAPI.agents.getAvailability()`), stores it in state, passes to `AgentTypePicker` and `Onboarding`. Not re-polled during the session.

**New component `src/renderer/components/AgentTypePicker.jsx`** (~80 LOC):

- Floating popover positioned next to its anchor (toolbar `+`, empty-state "New Agent", or the Ctrl+T virtual anchor).
- Two rows: `Claude` and `Codex`. Each row shows the badge as it appears in pane headers plus a one-line description ("Anthropic" / "OpenAI").
- A row is disabled (greyed out, non-clickable) with a tooltip when `availability[shell]` is false. Tooltip text:
  - Claude missing: `"claude not found on PATH — install Claude Code"`
  - Codex missing: `"codex not found on PATH — install OpenAI Codex CLI"`
- Closes on selection, ESC, outside click, or window blur.
- If both rows are disabled (neither CLI available), the picker still opens but shows a single help line explaining both are missing and links to install. No selection possible.
- Single instance in `App.jsx` state: `{open: bool, anchor: 'toolbar' | 'empty' | 'shortcut'}`. Selection calls `addAgent(shell)`.

`src/renderer/components/Toolbar.jsx`:

- The `+` button now opens the picker (small caret added next to the icon). The button itself does not pick a default type — the picker is the only way to add.

`src/renderer/components/Onboarding.jsx`:

- Existing 1–8 grid still picks total `N`.
- Below the grid, a **Split** control: two pill-segments labeled `Claude` and `Codex` showing their current numbers, summing to `N`. Clicking the Claude segment increments Claude and decrements Codex (until Codex hits 0); clicking Codex does the inverse. Defaults to `{claude: N, codex: 0}` for new drafts so a Claude-only user gets today's behavior with no extra clicks.
- A tiny header note above the segments: `"X Claude · Y Codex"`.
- If only one type's CLI is available, the split control hides entirely and a one-line hint shows under the grid: `"Only Claude detected on this machine"` (or `"Only Codex detected"`). All `N` slots go to the available type.
- `onLaunch` signature becomes `(counts, projectDir, name, isolated)` where `counts = {claude, codex}`. App.jsx adapts call sites.
- `TerminalPreview` (the grid mockup in each card) stays purely about layout — no per-cell type styling.

`src/renderer/components/TerminalPane.jsx`:

- After the agent name in the header, render `<span className="tp-agent-badge tp-badge-{shell}">{shell}</span>` — small monospace pill, low-contrast border, tucked to the right of the name. Hidden while the pane is in `editing` (rename) mode.
- Badge tokens: `--cs-cyan` accent for Claude (matches existing emphasis), a new `--cs-violet` (or similar warm token added to `design-tokens.css`) for Codex.
- Pane drag/swap/close/auto-name logic untouched — `shell` is cosmetic at the pane level.

`src/renderer/constants.js`:

- Add `AGENT_TYPES = ['claude', 'codex']` and `AGENT_LABELS = { claude: 'Claude', codex: 'Codex' }`. The picker, badge, and settings reference these so the strings never drift.

### 4. Settings, done-tracker, auto-namer, isolation

`src/renderer/components/SettingsModal.jsx`:

- The existing "Agents" section gets a second toggle directly under the Claude bypass toggle: **"Codex — bypass approvals and sandbox"** with helper text `"Adds --dangerously-bypass-approvals-and-sandbox to the codex launch command."` Independent of the Claude toggle.

`src/renderer/done-tracker.js`: no change. The "Enter, then 4s of silence" heuristic is agent-agnostic.

`src/renderer/auto-namer.js` (and `src/main/auto-namer.js`): no change. The summarizer takes pane tail text and asks Claude for a 1–3-word label regardless of which agent produced the text.

Worktree isolation: no change. Worktree creation only deals with git; the pane spawned inside the worktree can be either agent type.

### 5. Error paths

- `pty:create` returning `{ error: 'codex-missing' }` is logged by `materializeAgents()`'s existing `if (r?.error)` branch. In practice this only fires if the availability cache went stale (e.g. user uninstalled mid-session); the picker already disables the row otherwise.
- If a workspace's persisted `agentCounts.codex > 0` but codex isn't installed on this launch, lazy-spawn skips those panes with a `console.warn`. The workspace opens with whatever was successfully spawned. The next save derives `agentCounts` from the live `terminals` array, so the missing panes are reflected on disk and don't get re-attempted next launch. User re-adds them via the picker once codex is back.

## Out of scope

- Per-pane re-typing.
- Codex model selection / Codex configuration UI.
- Codex-specific settings beyond the bypass toggle.
- Visual differentiation beyond the text badge.
- Migration tooling — read-time migration covers it.
- Codex first-run auto-accept (bypass flag obviates the need).

## Open questions

None at this time.
