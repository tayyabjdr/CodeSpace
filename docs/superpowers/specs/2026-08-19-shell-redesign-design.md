# CodeSpace Shell Redesign — Design

**Date:** 2026-08-19
**Status:** Approved, ready for implementation planning
**Reference:** BridgeMind product screenshot supplied in chat (inspiration for structure only — no assets, branding, or naming copied)

## Summary

Restructure the CodeSpace shell in three places:

1. The sidebar becomes a **two-level tree** — workspaces expand to reveal their live agent sessions, across every spawned workspace, not just the active one.
2. Terminal panes become **elevated cards** rather than flush tiles.
3. Each pane gains a persistent **breadcrumb** showing its agent type and working directory.

This is a structural change only. It introduces no new colors and no new persisted data.

## Constraints

These were settled during brainstorming and bound everything below.

| Constraint | Consequence |
| --- | --- |
| No palette changes | `src/renderer/design-tokens.css` is not edited. Every color used already exists as a token. |
| No persistence changes | `src/main/workspaces-store.js` and `workspaces.json` are not edited. Expansion state is session-only. |
| No new features | No titlebar mode switcher, app-drawn composer, sidebar nav, account footer, or idle-time tracking. |

## 1. Sidebar tree

### Product behavior

The sidebar is a **global agent navigator**. Any spawned workspace can be expanded to show its live sessions, including workspaces the grid is not currently displaying — PTYs outlive their panes, so this data is real and live.

- Expansion and activation are **independent axes**. Several workspaces may be expanded at once; exactly one is active.
- Clicking a **workspace row** activates that workspace (existing behavior).
- Clicking its **chevron** toggles expansion without changing the active workspace.
- Clicking a **session row** activates that session's workspace *and* focuses that pane.
- A workspace with no spawned sessions renders no chevron.

### Expansion state

Session-only, held in `App.jsx`:

```js
const [expandedIds, setExpandedIds] = useState(() => new Set())
```

- A workspace is added on first spawn, so activating it reveals its sessions.
- The chevron toggles membership.
- Nothing is written to disk. On a cold start every row is collapsed, which is correct: `terminals[]` is session-only and lazily spawned, so no workspace has children until it is activated. A persisted flag would restore an open chevron above an empty list.

### Row anatomy

The rail widens from **220px to 270px** (`Sidebar.css:2`) to afford a level of indentation.

**Workspace row** — two lines, preserving the nickname feature shipped in v1.4.0:

```
│ ▾   CodeSpace                    3
│     shell redesign
```

- Chevron occupies a fixed 10px left gutter; the active accent bar (`.sb-item-bar`) shifts inward to accommodate it.
- Line 1 is the workspace name, line 2 the nickname (or the hover-only `add nickname` hint).
- Right cluster: aggregate done dot, isolated badge, count.
- The count **swaps to the delete `×` on hover**, rather than the delete button claiming its own column.

**Session row** — single line, minimal:

```
│       ● ✳ fix the pty seg-fault
```

Status dot, agent glyph, auto-generated name. No branch chip and no status text — both were considered and rejected. The branch chip duplicated information already visible in the pane breadcrumb, and status text required a per-session last-activity timestamp the app does not track. That timestamp remains available as a separate future feature.

### Status resolution

The session dot resolves in strict priority order. Note the two sources key differently; both keys are already present on the terminal object (`id` and `ptyId`, set at `App.jsx:142`).

| Priority | State | Appearance | Source | Key |
| --- | --- | --- | --- | --- |
| 1 | exited | dim | new pty-pool exit store | `ptyId` |
| 2 | done | cyan + glow | `doneTracker.getDoneTermIds()` | `id` |
| 3 | running | green | fallback | — |

The **workspace aggregate dot** renders only when a row is collapsed and only for the **done** state — it is an attention cue, not a status summary. A collapsed workspace containing exited-but-not-done sessions shows no dot; expanding it reveals them. When expanded, child rows carry their own state and the aggregate dot is hidden so the same signal is never shown twice.

This subsumes the current `notifyingIds` computation (`App.jsx:295-312`), which exists to mark done work in *non-active* workspaces — a narrower version of the same idea.

### Component split

`Sidebar.jsx` is 215 lines today and the tree pushes it past 350, mixing workspace rows, session rows, nickname editing, and two-level keyboard navigation. It splits three ways:

| File | Lines (est.) | Owns |
| --- | --- | --- |
| `Sidebar.jsx` | ~120 | Rail shell, header + `+` button, footer gear/version, list container, keyboard navigation |
| `components/WorkspaceRow.jsx` | ~140 | Two-line row, nickname edit state, chevron, count↔delete hover swap, aggregate dot |
| `components/SessionRow.jsx` | ~50 | Status dot, agent glyph, name, click handling |

Nickname edit state (`editingId`, `draft`, `inputRef`) moves out of `Sidebar.jsx` and into `WorkspaceRow.jsx`, where each row owns its own.

All three share the existing **`Sidebar.css`**. The two levels' indentation geometry is interdependent and easier to maintain in one stylesheet than split across three files. This is a deliberate exception to the repo's usual one-CSS-per-component convention.

### Keyboard and ARIA

The rail is currently `role="listbox"` with `role="option"` children and flat Up/Down roving navigation (`Sidebar.jsx:66-84`). A two-level structure requires tree semantics:

- Container becomes `role="tree"`; workspace and session rows become `role="treeitem"`; each session group becomes `role="group"`.
- Workspace rows carry `aria-expanded`; all rows carry `aria-level`.
- **Up/Down** traverse the *visible flattened* list — expanded children are in the sequence, collapsed children are not.
- **Left** collapses an expanded workspace, or moves to the parent from a session row. **Right** expands a collapsed workspace, or moves to its first child.
- **Enter/Space** activates. **Delete / Shift+Backspace** deletes, on workspace rows only.
- Navigation remains disabled while a nickname input is focused (existing `if (editingId) return` guard, relocated).

## 2. Pane cards

### Grid

`App.css` `.grid`: `gap` and `padding` move from `4px` to `6px`. Deliberately small — separation comes from elevation, not space, so dense grids (4×2) lose almost no terminal width.

### Pane surface

`.pane` (`TerminalPane.css:1-11`) currently uses `background: var(--cs-bg-surface)` and `border-radius: 0`. It becomes:

```css
background: var(--cs-bg-elevated);          /* #11151b — existing token */
border-radius: 8px;
box-shadow:
  0 2px 14px -4px rgba(0, 0, 0, 0.9),
  inset 0 1px 0 rgba(255, 255, 255, 0.04);
```

Both backgrounds are existing tokens; the shadow and highlight are neutral black/white alpha, not palette colors. No token is added or altered.

`.pane` is the card container. Its background is visible only where chrome sits — the header and breadcrumb bands — because xterm paints its own background over `.xterm-container`. `.pane-header` and `.pane-subheader` therefore also move to `--cs-bg-elevated` so the three bands agree; `.xterm-container` is left alone.

### The terminal seam — deliberate

xterm does not inherit the pane background. `terminal-theme.js:8` reads a dedicated `--cs-term-bg` (`#0d0f12`). Lifting the pane chrome to `--cs-bg-elevated` (`#11151b`) therefore leaves a visible step between the breadcrumb band and the terminal body.

**This seam is kept intentionally.** Only the chrome bands — pane header and breadcrumb — lift to elevated; the terminal body stays at `--cs-term-bg` and reads as a screen inset into the card. The alternative, overriding `--cs-term-bg` to match, is a palette edit and is out of scope. Implementers must not "fix" this seam.

## 3. Pane breadcrumb

`.pane-subheader` (`TerminalPane.css:364`) currently renders only when `branch` is set — i.e. only for isolated agents. It becomes unconditional:

```
⊡ claude · D:\…\CodeSpace
⊡ claude · D:\…\portfolio · cs/a1f2      ← isolated
```

- Content is the agent type (`shell`) and a shortened `cwd`.
- For isolated agents the branch joins the **same line**, retaining its existing copy-on-click button, rather than claiming a second row. The pane keeps three fixed bands — header, breadcrumb, terminal — instead of a variable four.
- Background lifts to `--cs-bg-elevated` to match the header.

Path shortening needs a `shortenPath(absPath)` helper. It belongs in `src/renderer/path-resolver.js` alongside the existing `basename` (`path-resolver.js:53`), which is already shared between the renderer and terminal link handling.

Contract: preserve the leading root segment and the final two segments, replacing anything between them with `…`. Paths already at or under four segments are returned unchanged. The full path remains available as the element's `title`.

```
D:\PC Backup\ControlDeck\CodeSpace          ->  D:\…\ControlDeck\CodeSpace
D:\PC Backup\ControlDeck\portfolio\src      ->  D:\…\portfolio\src
D:\dev\app                                  ->  D:\dev\app          (unchanged)
```

## 4. Exit store on pty-pool

### Problem

The sidebar cannot currently know that a background agent exited. `exitCode` is returned by `useTerminal()` and consumed inside `TerminalPane` (`TerminalPane.jsx:67`), so only a **mounted** pane knows. `App.jsx` has no exit awareness at all.

The data already exists globally: `pty-pool.js:15` keeps a module-level `exitCodes` Map that survives unmount, because PTYs outlive their panes. What is missing is a way to subscribe to it. `exitListeners` is per-`ptyId` with no snapshot API.

### Solution

Add a store-shaped API to `src/renderer/pty-pool.js`, mirroring the shape `doneTracker` already provides and `App.jsx` already consumes via `useSyncExternalStore`:

```js
export function subscribeExits(cb)      // returns an unsubscribe function
export function getExitedPtyIds()       // returns a stable Set of exited ptyIds
```

- The notify fires where the exit already lands (`pty-pool.js:38`).
- Cleanup on `killPty` already removes from `exitCodes` (`pty-pool.js:121-122`); the snapshot rebuilds and notifies there too.

### Snapshot stability — required

`useSyncExternalStore` requires a **referentially stable** snapshot. Returning `new Set(exitCodes.keys())` on every call produces a new identity each render and causes an infinite re-render loop.

The store must cache a Set and rebuild it **only** when an exit or a cleanup fires. `getExitedPtyIds()` returns that cached reference unchanged between mutations. This is the single most likely implementation error in this design and is explicitly covered by tests.

## Files changed

| File | Change | Detail |
| --- | --- | --- |
| `src/renderer/pty-pool.js` | modify | Add `subscribeExits` / `getExitedPtyIds` with a cached snapshot |
| `src/renderer/App.jsx` | modify | `expandedIds` state, toggle handler, cross-workspace session focus, pass exit + done sets to Sidebar |
| `src/renderer/components/Sidebar.jsx` | modify | Reduce to shell + list + tree keyboard navigation |
| `src/renderer/components/WorkspaceRow.jsx` | create | Two-line workspace row |
| `src/renderer/components/SessionRow.jsx` | create | Single-line session row |
| `src/renderer/components/Sidebar.css` | modify | Width 270px, chevron gutter, indentation, session rows, hover swap |
| `src/renderer/components/TerminalPane.jsx` | modify | Breadcrumb renders unconditionally; branch folds into it |
| `src/renderer/components/TerminalPane.css` | modify | Card surface, radius, shadow, inset highlight, breadcrumb band |
| `src/renderer/App.css` | modify | `.grid` gap and padding `4px → 6px` |
| `src/renderer/path-resolver.js` | modify | Add `shortenPath` |

## Testing

| File | Status | Covers |
| --- | --- | --- |
| `tests/renderer/pty-pool.test.js` | create | Subscribe/notify, **snapshot referential stability across repeat calls**, unsubscribe, cleanup on kill |
| `tests/renderer/WorkspaceRow.test.jsx` | create | Nickname edit (Enter commits, Esc cancels, blur commits), chevron toggle does not activate, count↔delete hover swap, aggregate dot only when collapsed |
| `tests/renderer/SessionRow.test.jsx` | create | Dot priority exited > done > running, click activates workspace and focuses terminal |
| `tests/renderer/Sidebar.test.jsx` | create | Two-level roving navigation over the visible flattened list, Left/Right expand/collapse, ARIA roles and `aria-expanded`, navigation suppressed while editing |
| `tests/renderer/App.test.jsx` | modify | `expandedIds` lifecycle, cross-workspace session focus |
| `tests/path-resolver.test.js` | modify | `shortenPath` |

There is no `Sidebar.test.jsx` or `pty-pool.test.js` in the repo today; both are new coverage.

## Acceptance criteria

- Expanding a non-active workspace shows its live sessions without switching the grid.
- Clicking a session in a non-active workspace switches to that workspace and focuses that pane.
- A session that exits while its workspace is not displayed shows as exited in the tree.
- A workspace collapsed with a done agent shows an aggregate dot; expanded, the done session carries it instead.
- Nickname display and inline editing behave exactly as they do in v1.4.0.
- Deleting a workspace still works from the row, via the hover swap over the count.
- Keyboard navigation traverses the tree and never traps focus inside a nickname input.
- Panes render as elevated cards; the terminal body remains `--cs-term-bg` and the seam is present by design.
- Every pane shows agent type and cwd; isolated panes additionally show a copyable branch on the same line.
- `npm test` passes; `npm run build` succeeds.

## Non-goals

- Titlebar mode switcher (`Agent | Code | Chat`).
- App-drawn prompt composer beneath each terminal.
- Sidebar app-level nav (Dashboard / Routines / Plugins) and the account/credits footer.
- Per-session idle-time tracking and status text.
- Any change to palette, tokens, themes, persistence, PTY lifecycle, or worktree behavior.
- Copying BridgeMind assets, branding, imagery, or naming.
