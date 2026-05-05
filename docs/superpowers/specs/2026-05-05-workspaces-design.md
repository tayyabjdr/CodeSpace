# Workspaces — Design Spec

**Date:** 2026-05-05
**Status:** Approved (verbal sign-off, "Lets GO")

## Problem

CodeSpace currently runs a single project at a time — onboarding picks one directory and spawns N Claude agents inside it. Users want to work on **multiple projects in parallel**, each with its own set of agents, without losing the others when they switch focus.

## Solution

Introduce **Workspaces**: a left-rail sidebar lists named workspaces; each workspace is a (name, project directory, set of running PTY agents) container. Multiple workspaces stay alive in the background; the main grid renders only the active workspace's terminals.

## Decisions (locked)

| Question | Decision |
|---|---|
| Lifetime when switching | Background-running. PTYs of inactive workspaces stay alive. |
| Persistence | Full — workspace list (id, name, dir, agentCount) saved across restarts. |
| Creation flow | Inline mini-popup: name + folder + initial agent count. |
| First-launch / empty state | Existing onboarding screen is shown whenever zero workspaces exist. |
| Agent numbering | Resets per workspace (each has its own Agent 01, 02, …). |
| Sidebar item content | Workspace name, folder name (muted), live agent count. |
| Workspace switch | Instant grid swap, no transition. |
| Delete | Hover-revealed × on sidebar item, confirms before killing PTYs. |

## Architecture

### Renderer state shape

```js
workspaces: [
  {
    id: 'uuid',
    name: 'CodeSpace',
    dir: 'C:\\Users\\TJ\\Desktop\\ControlDeck\\CodeSpace',
    agentCount: 4,            // last-used count, persisted
    terminals: [               // session-only, not persisted
      { id, shell, agentNum, cwd }
    ],
    agentCounter: 4,           // per-workspace counter
    focusedTerminalId: 'uuid'  // last focused pane within this workspace
  }
],
activeWorkspaceId: 'uuid'
```

Only `{ id, name, dir, agentCount }` is persisted. `terminals` are spawned lazily on first activation each session; `agentCounter` and `focusedTerminalId` are session-only.

### Lazy spawn

When a workspace becomes active for the first time in a session, its `agentCount` agents are spawned. Subsequent activations reuse the existing terminals.

### Hidden workspaces

Inactive workspaces' `TerminalPane` components are **unmounted** from React. Their PTYs keep running in the main process; the PTY's internal buffer holds recent output. On reactivation, the renderer remounts the panes, attaches xterm to fresh DOM nodes, and replays the recent buffer (last ~10k chars per PTY) so the user sees context immediately.

### Buffer ring

A small per-PTY ring buffer in the renderer (or main) keeps the last N kilobytes of output, populated as PTY data streams. On remount, replay the ring into xterm before live data resumes. This is the only addition to the PTY pipeline.

### Persistence

Electron `userData/workspaces.json`:

```json
{
  "workspaces": [
    { "id": "...", "name": "CodeSpace", "dir": "...", "agentCount": 4 }
  ],
  "activeWorkspaceId": "..."
}
```

Read on app start in main, exposed to renderer via IPC `workspaces.load()` / `workspaces.save(state)`. Save on every meaningful change (create, rename, delete, agent count change, active switch).

## Components

- **`Sidebar.jsx`** — left rail, lists workspaces, "+ New Workspace" button at bottom. Active item highlighted.
- **`WorkspaceItem.jsx`** — single sidebar entry: name, folder name (muted), agent count badge, hover × delete.
- **`NewWorkspaceModal.jsx`** — popup for name + folder browse + agent count.
- **`App.jsx`** (modified) — top-level state: workspaces list + activeWorkspaceId. Routes the active workspace's `terminals` into the existing grid.
- **`TerminalPane.jsx`** (modified) — accepts initial buffer to replay on mount.
- **`useTerminal.js`** (modified) — supports replay-from-buffer on attach, registers PTY data to a ring buffer kept across mounts.
- **`Onboarding.jsx`** (modified) — its successful "Initialize" submission now creates the *first* workspace, instead of bypassing the workspaces system.

## Data flow

1. **App start**: main reads `workspaces.json`, sends to renderer. If empty → show Onboarding.
2. **Create workspace**: user fills modal → renderer adds to state → save → set active → lazy-spawn agents.
3. **Switch**: click sidebar item → set active → unmount previous panes → mount new ones → replay buffers.
4. **Add agent in workspace**: existing `+ new agent` button now adds to the active workspace only.
5. **Close last terminal in active workspace**: workspace stays (zero agents); user can still add more, or delete the workspace.
6. **Delete workspace**: confirm → kill all its PTYs → remove from state → if it was active, switch to next or back to onboarding.

## Visual / UX (frontend-design pass to refine)

- Left sidebar, ~220px wide, dark surface matching existing cyberpunk palette.
- Workspace name in display font (Orbitron-ish), folder name in mono small/muted.
- Active item: accent border + brighter background.
- Sidebar header: small "WORKSPACES" label.
- Footer: "+ new workspace" button styled like the existing "+ new agent" button.
- Modal: minimal, matches Onboarding's aesthetic (Browse button, count cards, Initialize-style submit).

## Out of scope (YAGNI)

- Reordering workspaces (drag-drop) — defer.
- Renaming workspaces inline — defer (delete + recreate works).
- Per-workspace shell type override — all agents are Claude.
- Persisting terminal scrollback to disk — buffer ring is in-memory only, lost on restart.
- Importing/exporting workspaces.

## Testing

- Unit: workspace reducer (create/delete/switch/agent-count update), persistence load/save round-trip.
- Integration: create two workspaces, switch between them, verify PTYs of the inactive one continue to receive data and replay on reactivation.
- Manual: app restart restores workspace list; deleting active workspace falls back correctly; onboarding reappears when last workspace deleted.

## Risks

- **xterm remount cost** when switching: mitigated by lazy spawn + buffer replay. If remount feels janky, fall back to Approach 2 (hidden via CSS) for ≤4 workspaces, switch strategy above that.
- **Buffer ring size** trade-off: 10k chars × workspaces × agents — bounded and fine.
