# Isolated Agents — Design

**Date:** 2026-05-09
**Status:** Draft for review
**Problem:** Multiple Claude agents in the same workspace all spawn with `cwd: workspace.dir`, so concurrent edits collide on the same files.

## Goal

Give each agent in a workspace its own git worktree on its own branch, so agents can edit files in parallel without stepping on each other. Opt-in per workspace at creation time. Pure isolation — no in-app merge UI in v1.

## Non-goals (v1)

- Cross-agent file sharing UI (no "pull from agent X" button, no merge panel).
- Editing the isolation toggle on existing workspaces (creation-time only).
- Auto-init git in non-git folders. We block instead.
- Surfacing leftover branches from closed agents in the UI. They live in `git branch` only.

## Decisions and rationale

| Decision | Choice | Why |
| --- | --- | --- |
| Scope of isolation | Per-workspace toggle, set at creation, immutable in v1 | Lets non-git or "shared chat" workspaces opt out cleanly; no migration logic needed. |
| Sharing UX | None in v1 (manual git in the pane) | Smallest surface; validate the core idea before building UI on top. |
| Branch source | Workspace dir's HEAD at the moment of agent spawn | Matches how a developer would manually run `git worktree add`. Each new agent starts from the latest committed state. |
| Non-git folder + isolation on | Block workspace creation with a clear error | No silent side effects in user's directory; no surprise `git init`. |
| Worktree location | `<repo>/.codespace/worktrees/<agentId>/` | Sits next to the repo, easy to `cd` into, deleted with the repo. `.codespace/` auto-added to `.gitignore`. |
| Close-pane cleanup | Smart: remove worktree always; delete branch only if no commits beyond base; confirm if dirty | Releases disk space without silently destroying committed work. |
| Existing workspaces | Stay shared (current behavior) | Avoids mid-flight migration risk. |

## Architecture

A new main-process module `src/main/worktree-manager.js` owns all git interactions. The renderer never shells out to git; it asks main to create/destroy worktrees via IPC and gets back a filesystem path to spawn the PTY in.

```
renderer (App.jsx)
  ├── on '+ Agent' click in isolated workspace
  │     └── electronAPI.worktree.create({ workspaceId, agentId, sourceDir })
  │           → main: worktree-manager.create()
  │             ├── ensure source is a git repo
  │             ├── ensure .codespace/ in .gitignore (idempotent)
  │             ├── compute branch name: cs/<workspace-slug>/<agentId-short>
  │             ├── execFile git: `git worktree add -b <branch> .codespace/worktrees/<agentId> HEAD`
  │             ├── record { branch, baseSha, createdAt } in .codespace/worktrees/.cs-meta.json
  │             └── return absolute worktree path
  │     └── pty-pool.createPty(shell, worktreePath, ...)
  │
  └── on pane close
        └── electronAPI.worktree.close({ workspaceId, agentId, force? })
              → main: worktree-manager.close()
                ├── git status --porcelain in worktree → if dirty and !force, return { dirty: true }
                ├── git rev-list <branch> ^<baseSha> --count
                ├── git worktree remove --force <path>
                └── if commits === 0: git branch -D <branch>; else leave branch
```

`pty-manager.js` is unchanged. It just spawns at whatever cwd it's given. All git logic is isolated to the new module.

### Module boundaries

- **`src/main/worktree-manager.js`** (new): owns `git` shell-outs, owns `.cs-meta.json`, exposes `create`, `close`, `closeAllForWorkspace`, `repairOrphans`, `isGitRepo`, `isGitAvailable`. Single in-memory lock serializes mutations on the same workspace.
- **`src/main/ipc-handlers.js`**: registers `worktree:create`, `worktree:close`, `worktree:isGitRepo`. Validates inputs.
- **`src/preload/index.js`**: exposes `worktree.create / close / isGitRepo` on `electronAPI`.
- **`src/main/workspaces-store.js`**: persists new field `isolated: boolean`.
- **`src/renderer/App.jsx`**: branches `cwd` resolution on `workspace.isolated`. Calls worktree IPC on agent spawn and pane close. Handles dirty-confirm modal.
- **`src/renderer/components/Onboarding.jsx`**: new toggle, validates `isGitRepo` before submit.
- **`src/renderer/components/TerminalPane.jsx`**: shows branch name in pane header for isolated workspaces.

## Data model

### Persisted workspace fields

Add `isolated: boolean` to the saved workspace record. Default `false`. Sanitized in `loadWorkspaces` and round-tripped in `saveWorkspaces` alongside the existing `id, name, dir, agentCount, editor`.

### Per-repo worktree metadata

`<repo>/.codespace/worktrees/.cs-meta.json`:

```json
{
  "version": 1,
  "gitignoreTouched": true,
  "agents": {
    "<agentId>": {
      "branch": "cs/codespace/3a4f9c2e",
      "baseSha": "9c2e1f...",
      "createdAt": "2026-05-09T14:31:02.114Z"
    }
  }
}
```

Single writer (main process). Atomic write via temp+rename.

### Branch and path naming

- Branch: `cs/<workspace-slug>/<agentId-short>` where `<workspace-slug>` is the workspace name lowercased, non-alphanum → `-`, collapsed and trimmed; `<agentId-short>` is the first dash-delimited segment of the agent's UUID (8 hex chars, ~32 bits of entropy — comfortably unique within a single workspace).
- Worktree path: `<repo>/.codespace/worktrees/<agentId>/` (full UUID — guaranteed unique).
- If the branch name collides (stale state from a prior crash), append `-2`, `-3` until free, capped at 5 retries.

## Lifecycle

### Workspace creation

1. User toggles "Isolated agents" in `Onboarding.jsx`.
2. On submit, renderer calls `electronAPI.worktree.isGitRepo(dir)`. False → submit blocked with inline error: "This folder isn't a git repo. Run `git init` here first, or turn off isolated agents."
3. Persisted record gets `isolated: true`.

### First agent spawn (and every subsequent agent)

1. Renderer constructs the agent record with a fresh `id`.
2. If workspace is isolated: `cwd = await electronAPI.worktree.create({ workspaceId, agentId, sourceDir: workspace.dir })`. Otherwise: `cwd = workspace.dir`.
3. Renderer calls `pty-pool.createPty(shell, cwd, ...)`.
4. On worktree creation error, renderer shows a non-blocking toast and the agent doesn't spawn.

### App restart

- Worktrees and branches survive on disk.
- Terminals are spawned lazily on workspace activation (current behavior).
- For isolated workspaces, main reuses the existing worktree at the deterministic path if `git worktree list` confirms it. If the directory or git registration is missing → recreate fresh (treated as a new agent at current HEAD; meta file updated).

### Close-pane cleanup

1. Renderer calls `electronAPI.worktree.close({ workspaceId, agentId })`.
2. Main runs `git status --porcelain` inside the worktree.
3. If output is non-empty and `force !== true` → return `{ dirty: true }`.
4. Renderer shows a confirmation modal (see UI section). On confirm, calls again with `force: true`.
5. Main runs `git worktree remove --force <path>`.
6. Main runs `git rev-list <branch> ^<baseSha> --count`.
   - 0 → `git branch -D <branch>`.
   - >0 → leave the branch in place (silent in v1; user finds it via `git branch`).
7. Meta file entry for the agent is deleted.

### Workspace deletion

1. Persistence saves first (matching the existing pattern that protects against mid-cleanup crashes).
2. For each agent in the workspace: same close logic, `force: true`. No per-agent confirms; one workspace-level confirm covers it.
3. After all worktrees removed, attempt to `rmdir` `.codespace/worktrees/`; ignore failure.

## UI

### Onboarding (`Onboarding.jsx`)

- New toggle row below the folder picker:
  - Label: "Isolated agents"
  - Helper: "Each agent gets its own git branch and folder under `.codespace/worktrees/`. Requires a git repo."
  - Default: off.
- If on and folder isn't a git repo, submit stays disabled with a one-line reason underneath the folder field.

### Sidebar workspace row

- Small branch-icon glyph next to the workspace name when `isolated: true`. No text. Hover tooltip: "Isolated agents."
- Reuses existing dim-tier color tokens; no new visual primitive.

### TerminalPane header (isolated workspaces only)

- One additional dim line under the agent name showing the branch (e.g. `cs/codespace/3a4f9c2e`).
- Click to copy to clipboard.
- Middle-truncate on narrow panes.
- Visual weight: same dim level as the existing path-hint affordance.

### Close-confirm modal (uncommitted changes only)

- Title: "Discard agent's uncommitted changes?"
- Body: "**<agent name>** has uncommitted changes in `<branch>`. The worktree will be removed and the changes lost. Committed work on the branch is preserved."
- Buttons: "Cancel" (default) | "Discard and close" (destructive).
- Single, narrow modal; reuses existing modal primitive if one exists, otherwise add a minimal one alongside the design tokens.

## Errors and edge cases

| Case | Behavior |
| --- | --- |
| `git` not on PATH | Detected once at app start (same pattern as `isClaudeAvailable`). Onboarding blocks with: "Git not found on PATH. Install git or turn off isolated agents." |
| `git worktree add` fails (general) | Main returns `{ error: 'worktree-create-failed', detail: <stderr-truncated> }`. Renderer shows non-blocking toast; agent doesn't spawn. |
| Branch name already exists | Retry with `-2`, `-3`, ... up to 5; then surface the error. |
| Source HEAD is unborn (empty repo) | `git worktree add` will fail. Onboarding doesn't catch this (a fresh `git init` looks like a repo); we surface the toast and the user makes a first commit. |
| Source repo has uncommitted changes at spawn time | Fine. `git worktree add ... HEAD` doesn't carry working-tree changes; the new worktree starts clean at the HEAD commit. |
| Source repo on detached HEAD | `git worktree add -b <branch> <path> HEAD` still works; the new branch is created at the detached commit. |
| `.gitignore` exists with `.codespace/` already | Read first, exact-line check, append only if missing. Tracked once per repo via `gitignoreTouched` in meta file so we don't re-touch. |
| No `.gitignore` exists | Create one containing just `.codespace/`. |
| User manually deletes `<repo>/.codespace/worktrees/<agentId>` | Next request from renderer triggers existence check in main; missing → recreate fresh. Silent recovery. |
| Stale entries in meta file | On workspace activation, `repairOrphans` reconciles meta against `git worktree list` and prunes mismatches. |
| conpty seg-fault during deletion | Persistence saved first; meta file written before each git op; worktree removal wrapped in try/catch so one failure doesn't block subsequent agents. Orphans reaped on next activation. |
| Concurrent worktree mutations | Funnel through `worktree-manager.js` with an in-memory per-workspace lock. Atomic write of meta via temp+rename (matches `workspaces-store.js`). |

## Test plan

Unit tests (vitest, `tests/main/worktree-manager.test.js`):

- `create` against a fresh git repo creates a worktree at the expected path on the expected branch.
- `create` ensures `.codespace/` is in `.gitignore` exactly once across multiple invocations.
- `create` retries with numeric suffix when branch name collides.
- `close` with a clean worktree removes the worktree and prunes the branch when there are no new commits.
- `close` with commits beyond base removes the worktree but keeps the branch.
- `close` with uncommitted changes returns `{ dirty: true }` and does nothing until called with `force: true`.
- `repairOrphans` removes meta entries that have no corresponding git worktree.

Manual smoke (Windows):

- Create a non-isolated workspace → confirm current behavior unchanged.
- Create an isolated workspace in a git repo → spawn 3 agents → verify three worktrees on three branches in `git worktree list`.
- Have agent 1 edit file `A`, agent 2 edit file `B` simultaneously; confirm no collisions.
- Commit in agent 1, close pane → branch survives; reopen workspace → committed branch still present.
- Close pane with uncommitted changes → confirm modal appears; discard → worktree gone, branch gone.
- Delete an isolated workspace → all worktrees removed, no orphan branches for that workspace remain.
- Try to create an isolated workspace pointing at a non-git folder → submit blocked with inline error.

## Migration

None. `loadWorkspaces` defaults `isolated` to `false` for any record without the field, so existing `workspaces.json` files just keep working.

## Out of scope (tracked for v2)

- "Sync from agent X" button (one-click merge another agent's branch into this one).
- Workspace settings panel to flip the isolation toggle on existing workspaces.
- Branches panel showing all live agent branches with diff and merge-to-base actions.
- Auto-pruning of long-abandoned branches kept after agent close.
- Worktree-aware editor pane (peek at another agent's files without merging).
