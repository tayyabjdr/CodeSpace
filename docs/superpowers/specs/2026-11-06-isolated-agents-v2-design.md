# Isolated Agents v2: On by Default, Ready to Run, Merges Itself

**Date:** 2026-11-06
**Status:** Draft for review
**Extends:** `2026-05-09-isolated-agents-design.md`

## Why

The user runs several agents on one project and every terminal ends up showing conflicts. Those runs were all in one shared folder, because the "Isolated agents" toggle is off by default, appears only when creating a workspace, and the user did not know it existed.

v1 shipped isolation with no way to get work back. Agents finish on a branch and the work stays there until someone merges by hand.

## Goals

1. New workspaces in a git repo are isolated without the user doing anything.
2. An agent's folder can build and run as soon as it opens.
3. Finished work reaches the main branch without review, if the tests pass.
4. The main branch never receives work that failed its tests.

## Non-goals

- Pushing to any remote. Pushing stays the user's decision.
- Detecting on its own that an agent is finished (see Decisions).
- A diff or review panel.
- Keeping an agent's conversation when a running workspace switches to isolated.
- Merging branches left over from an earlier session from inside the app (they are listed, see Part 3).
- Configurable check commands per project.

## Decisions

**From the user:**

| Decision | Choice |
|---|---|
| Review before merge | None. Merge automatically if the tests pass. |

**Claude's calls, made after the user asked for fewer questions. Each can be overruled:**

| Decision | Choice | Why |
|---|---|---|
| What counts as finished | A one-click **Finish** button on the pane | The existing "Done" signal is 4s of silence, which looks identical to an agent waiting on a question. Silence would merge half-finished work. |
| Default | On for repos with at least one commit | The user should not need to find a setting. |
| Non-git folders | Shared folder as today, with a small "not isolated" note | Blocking would break existing use. |
| Existing workspaces | Not migrated. Can be switched when no agents are running | Moving a live agent to another folder breaks its session. |
| Merge method | Rebase onto target, test, then fast-forward | Tests run against exactly what lands, and history stays linear. |
| No test script | Fall back to `build`. If neither exists, merge and label the result "merged, untested" | Many of the user's projects have no tests, and blocking would make the feature useless there. The label keeps it honest. |
| Failure | Nothing lands. The error goes to that agent's terminal. The user clicks Finish again | No automatic retry loop, so a stuck agent cannot spin unattended. |
| Worktree location | Stays at `.codespace/worktrees/` | Least change. See Risks for the cost. |

## Current state of the code

- `worktree-manager.js` creates, closes and cleans up worktrees. There is no merge, rebase or cherry-pick anywhere in `src`.
- `Onboarding.jsx:67` defaults the toggle to false, and `:156` blocks launch when it is on in a non-repo.
- `App.jsx:144-146` logs a failed `worktree.create` to the console and skips the agent, so the pane silently never appears. **This becomes serious once isolation is on by default**, because a repo with no commits fails this way.
- `App.jsx:331` wipes clean worktrees on first activation each session, which differs from the v1 spec's "reuse on restart". Branches with commits survive but nothing lists them. Dirty worktrees survive with only a `console.warn`.
- `ensureGitignoreExcludes` edits the user's `.gitignore`, leaving an uncommitted change in the main folder.
- `createSession(shell, cwd, cols, rows)` in `pty-manager.js` has no way to pass per-pane environment variables.
- Leftover empty folders exist in this repo's `.codespace/worktrees/` while `git worktree list` shows none, so cleanup is not fully removing them.

## Part 1: On by default

- `Onboarding.jsx`: the toggle defaults to on when the folder is a repo with at least one commit. Otherwise it is off and launch is not blocked, with a one-line reason shown. The user can still turn it off.
- Add `worktree:canIsolate(dir)` returning `{ ok, reason }` where reason is `git-missing`, `not-a-repo` or `no-commits`.
- A notice above the grid offers to switch a shared workspace to separate folders, and clicking the sidebar's isolated glyph turns it off. Both are enabled only when the workspace has no running agents, and otherwise explain why they are unavailable.
- A failed `worktree.create` shows a visible error and a retry in that same notice, never a silent skip and never a fallback to the shared folder.
- Replace the `.gitignore` edit with an entry in `<git-common-dir>/info/exclude`, so isolation leaves no change in the user's repo. Existing `.gitignore` lines are left alone.

## Part 2: Ready-to-run worktrees

Add a `setupWorktree` step after `git worktree add`. A failure in it shows a warning but does not stop the agent from starting.

**Dependencies**
- If `<repo>/node_modules` exists, create a directory junction to it at `<worktree>/node_modules`.
- Add `/node_modules` to `info/exclude`. A common `.gitignore` line of `node_modules/` matches directories only and may not match a link, in which case `git add -A` would commit the link. Test this rather than assuming it.
- **Safety requirement:** remove the junction with a link-only call before any `git worktree remove --force` or recursive delete, on every cleanup path (`close`, `closeAllForWorkspace`, `wipeAll`, `repairOrphans`). A test must prove the main `node_modules` survives each path.

**Environment files**
- Copy top-level `.env*` files only when `git check-ignore` confirms they are ignored. A tracked `.env` already arrives through checkout, and copying an unignored one risks committing secrets at Finish.
- Copy rather than link, so one agent's edits do not affect the others.

**Port**
- Extend `createSession` and the `pty:create` channel with an optional `env` object.
- Give each isolated pane a free `PORT`, probed from the range 4100-4999 at spawn and shown in the pane's band.
- Known limit: this only helps frameworks that read `PORT`. Scripts with a hardcoded port, such as `next dev -p 3120`, will still clash if two agents start them. The pane can only report the port, so this is documented rather than solved.

## Part 3: Finish

### Pane band

The existing `pane-subheader` gains status and a button:

`cs/codespace/3a4f9c2e · 3 commits, 5 files · Finish`

States: `Idle`, `Queued`, `Testing`, `Merged into <target>`, `Merged, untested`, `Tests failed`, `Conflict`, `Blocked: <reason>`.

Counts refresh when the pane goes quiet, with no polling timer. Finish is disabled while the pane is producing output, and disabled with nothing to merge. Its tooltip names the target branch. Follow `DESIGN_SYSTEM.md`, use white opacity tiers by default and reserve accent colour for the failure and success moments. Run the `frontend-design` skill first, as `CLAUDE.md` requires.

### Pipeline

A new `src/main/merge-queue.js` handles one Finish at a time per repo.

Tests can run for minutes, so **do not hold `withRepoLock` for the whole pipeline**: that would block new agents from spawning. Take it only for the final landing step. Run tests with async `spawn`, never `execFileSync`, so the main process does not freeze.

1. **Target:** the branch checked out in the main folder when Finish is clicked. Detached HEAD gives `Blocked`.
2. **Commit leftovers:** if the worktree is dirty, `git add -A` and commit as `<agent name>: finish`.
3. **Rebase** onto the target. On conflict, leave the rebase in progress, set `Conflict`, and go to Handoff. Clicking Finish again requires that no rebase is in progress.
4. **Dependencies changed?** If the lockfile differs from the target's, replace the junction with a real install using the package manager that lockfile implies.
5. **Check:** run `test` from `package.json`, skipping the npm placeholder ("no test specified"). Otherwise run `build`. Otherwise skip and mark untested. Set `CI=1` so watch modes do not hang. Time out at 10 minutes and kill the whole process tree. Save output to `<repo>/.codespace/merge-logs/<agentId>.log`.
6. **Guard:** confirm the worktree's HEAD is unchanged and the tree is clean. If the agent or user changed something during the check, stop with `Blocked: changed during tests`.
7. **Land:** take `withRepoLock` and run `git -C <repoDir> merge --ff-only <branch>`.
   - If the target moved because the user committed in the main folder, go back to step 3 once.
   - If the user's uncommitted edits overlap, git refuses and nothing is lost. Set `Blocked` and name the files.
8. **After landing:** set the agent's `baseSha` in `.cs-meta.json` to the new head, or a later close would keep the branch as though it held unmerged work. The worktree stays open so the agent can take another task. If the lockfile changed, show a note to run an install in the main folder, because running it automatically can fail on Windows file locks from a live dev server.

Other agents are not rebased when something lands. They pick up the new work at their own Finish.

### Handoff

For `claude` and `codex` panes, write one line to the PTY with `writeSession`, ending in `\r`:

`CodeSpace could not merge this branch into <target>: <tests failed|rebase conflict>. Details are in <log path>. Please fix it and commit. For a conflict, finish with git rebase --continue.`

Plain shell panes get the status only. Agents are idle at this point because Finish requires it, but a user may have typed in the pane since. Check the pane is quiet first, and if it is not, show the status without writing.

### Work left over from earlier sessions

Before `wipeAll` runs, collect kept dirty worktrees and any `cs/<slug>/*` branch with commits not on the target. Show them in a visible notice with a copy-branch-name action. This replaces the `console.warn`.

## Risks to check early

Check these before building Part 3, since each could change Part 2:

1. **Junctions and bundlers.** Vite, webpack or Turbopack may resolve the link to its real path or reject it for sitting outside the project root. Try a Next.js 16 project and a Vite project. If it fails, fall back to a real install per worktree, which is slower and uses more disk.
2. **Nested folders in the main repo.** Test runners, file watchers and Tailwind content globs running in the main folder may pick up `.codespace/worktrees/**`, for example running every agent's tests. Check this repo's vitest first. If it happens, move worktrees outside the repo, keyed by repo, and update the paths in `worktree-manager.js`.
3. **Agents installing packages.** `npm install` inside a worktree writes through the junction into the shared `node_modules`, affecting everyone. There is no full fix in this version. Step 4 keeps the test run accurate.
4. **Long paths.** Worktree paths add about 60 characters, and deep `node_modules` paths may hit Windows limits.

5. **Two workspaces on one folder.** Found while planning: `wipeAll` works per repo, so activating a second workspace on the same folder deletes the first one's clean, live worktrees. Default-on makes this reachable, so `wipeAll` must skip agents that are still live.

## Delivery order

1. Part 1: visible value straight away, and the toggle becomes discoverable.
2. Part 2 with risks 1 and 2 checked.
3. Part 3.

Each part ships on its own.

## Test plan

**Unit, against real temp git repos, extending `tests/worktree-manager.test.js`:**
- `canIsolate` returns each reason correctly.
- Isolation leaves `git status` clean in the main folder.
- `setupWorktree` links dependencies, copies ignored `.env` files and skips unignored ones.
- `git add -A` in a worktree never stages the junction.
- The main `node_modules` survives every cleanup path.
- Pipeline: clean merge, failing tests leave the target untouched, conflict leaves the rebase in progress, no-tests merges as untested, the placeholder test script is ignored, a timeout kills the process tree, the guard catches changes during tests, overlapping main-folder edits give `Blocked` with nothing lost, two queued Finishes land in order, and `baseSha` updates so close deletes the merged branch.

**Manual smoke on Windows:**
- Four agents on one project edit different files, each clicks Finish, and all four land on the main branch with a linear history.
- Two agents edit the same lines. The second gets a conflict in its terminal, resolves it, and lands on the second Finish.
- A test made to fail leaves the main branch unchanged and the agent receives the log path.
- A `git init` folder with no commits launches as shared and shows the note.
- Confirm that nothing is ever pushed.

## Migration

None required. Existing records keep their saved `isolated` value, and only the default for new workspaces changes. `.gitignore` lines from v1 stay in place.

## Possible follow-ups

- Finish without a click: an agent hook signal rather than silence, if the button feels like too much.
- A warning when two live branches touch the same file.
- Merging leftover branches from the notice.
- Auto-pruning of old `cs/*` branches.
