# Isolated Agents v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-agent worktrees the default, make each one ready to run, and add a Finish button that merges an agent's work into the main branch if its tests pass.

**Architecture:** All git and filesystem work stays in the Electron main process: `worktree-manager.js` (existing), plus new `worktree-setup.js`, `check-runner.js` and `merge-queue.js`. The renderer asks over IPC and receives status events. It owns the terminal-facing parts, namely quiet detection and writing the failure message to the PTY.

**Tech Stack:** Electron, React, node-pty, git CLI via `child_process`, vitest (real temp git repos, as in `tests/worktree-manager.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-06-isolated-agents-v2-design.md`

## Global Constraints

- Work on branch `feat/isolated-agents-v2`, not `master`. Baseline before Task 1: 36 test files, 377 tests passing with `npx vitest run`.
- Never run `git push`, and nothing in the product code may push.
- Call git and processes with argument arrays. Never build a command string from a path, because the user's repos live under `D:\PC Backup\`.
- `.cmd` tools (`npm`, `pnpm`, `yarn`) run as `spawn('cmd.exe', ['/d', '/s', '/c', '<tool> <args>'], { cwd, windowsHide: true })` with fixed strings only.
- Main-process test files start with `// @vitest-environment node`.
- UI: run the `frontend-design` skill before Tasks 3, 4, 10 and 11. Follow `DESIGN_SYSTEM.md`, white opacity tiers by default, accent colour only for success and failure moments, no infinite animations, no flanking rules around labels, no em-dashes in copy.
- Port range: 4100-4999. Check timeout: 10 minutes. Quiet threshold: 4000ms, matching `done-tracker.js`.

## Review Focus

- A repo path containing a space (`D:\PC Backup\...`) should work through junctions, env copy, checks and landing. Pinned in Tasks 5 and 7.
- Two workspaces on the same folder: activating one must not delete the other's live worktrees. Pinned in Task 2.
- Closing a pane while its Finish is queued or testing should stop cleanly, with nothing landing. Pinned in Tasks 8 and 10.
- The user commits or switches branch in the main folder during a check: never land on the wrong branch or lose work. Pinned in Task 8.
- Double-clicking Finish should queue one run, not two. Pinned in Task 8.

---

### Task 1: Check the two risks that could change the design

No product code. Do this in the scratchpad, on clones, and never touch the original projects.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-isolated-agents-v2-design.md` (record results under "Risks to check early")

**Interfaces:**
- Produces: a decision on `depsMode` (`'link'` or `'install'`, used in Task 5) and worktree location (used by `worktreePath` in Task 2).

- [ ] **Step 1: Test a linked `node_modules` with a bundler.** Clone one Next.js 16 project and one Vite project from `ControlDeck` (`Portfolio` and `Finance` are candidates), run `npm ci`, add a worktree under `.codespace/worktrees/x`, and create the link with `mklink /J`.

Run in the worktree: `npm run build`, and start `npm run dev` for about 20 seconds.
Expected: both succeed. Record any symlink or "outside root" error verbatim.

- [ ] **Step 2: Test nested folders.** In a CodeSpace clone with a worktree at `.codespace/worktrees/x`, run `npx vitest run` from the clone's root.

Expected: record whether the test file count doubles. Repeat `npm run build` in the Next.js clone with a worktree present and record whether anything from the worktree is scanned or fails.

- [ ] **Step 3: Apply the decision rules and record them.**
  - A bundler rejects the link: `depsMode = 'install'`, meaning `setupWorktree` runs a real install. Task 5 keeps the same interface, and the agent starts while it installs.
  - Nested worktrees get picked up: change `worktreePath` to `<parent-of-repo>/.codespace-worktrees/<repo-folder-name>/<agentId>`. The meta file stays in the repo.
  - Tell the user if either rule fires, in one line, then continue.

- [ ] **Step 4: Commit** the spec update on `feat/isolated-agents-v2`.

### Task 2: Eligibility, local excludes and safe wipes

**Files:**
- Modify: `src/main/worktree-manager.js`, `src/main/ipc-handlers.js`, `src/preload/index.js`
- Test: `tests/worktree-manager.test.js`, `tests/ipc-handlers.test.js`

**Interfaces:**
- Produces:
  - `canIsolate(dir): { ok: boolean, reason: 'git-missing' | 'not-a-repo' | 'no-commits' | null }`
  - `ensureLocalExcludes(repoDir): void`, replacing `ensureGitignoreExcludes`
  - `worktreePath(repoDir, agentId): string`, the single place that path is computed
  - `execGit`, `withRepoLock`, `readMeta`, `writeMeta` exported for later tasks
  - `wipeAll({ repoDir, liveAgentIds = [] }): { kept: [...], stranded: [{ branch, ahead }] }`
  - IPC `worktree:canIsolate`, preload `worktree.canIsolate(dir)`

- [ ] **Step 1: Write the failing tests**

```js
it('canIsolate reports each reason', () => {
  expect(canIsolate(repoWithCommit)).toEqual({ ok: true, reason: null })
  expect(canIsolate(emptyInitRepo)).toEqual({ ok: false, reason: 'no-commits' })
  expect(canIsolate(plainDir)).toEqual({ ok: false, reason: 'not-a-repo' })
})
it('create leaves the main folder clean', async () => {
  await create({ repoDir, workspaceName: 'w', agentId: id })
  expect(git(repoDir, 'status', '--porcelain').trim()).toBe('')
  expect(existsSync(join(repoDir, '.gitignore'))).toBe(false)
  expect(readFileSync(join(repoDir, '.git/info/exclude'), 'utf8')).toContain('.codespace/')
})
it('ensureLocalExcludes adds each line once', () => { /* call twice; count of '.codespace/' lines === 1 and '/node_modules' === 1 */ })
it('wipeAll skips live agents of another workspace on the same repo', async () => {
  const a = await create({ repoDir, workspaceName: 'w', agentId: idA })
  await wipeAll({ repoDir, liveAgentIds: [idA] })
  expect(existsSync(a.path)).toBe(true)
  expect(readMeta(repoDir).agents[idA]).toBeTruthy()
})
it('wipeAll lists unmerged cs/ branches as stranded, excluding live ones', async () => { /* commit on a closed agent's branch; expect stranded to contain { branch, ahead: 1 } */ })
it('close removes the worktree folder completely', async () => { /* after close, existsSync(path) === false even if git left an empty dir */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/worktree-manager.test.js`
Expected: FAIL, `canIsolate is not a function`.

- [ ] **Step 3: Implement in `worktree-manager.js`.** `ensureLocalExcludes` finds the file with `git rev-parse --git-common-dir`, resolved against `repoDir`, and writes lines `.codespace/` and `/node_modules`. Replace every `join(repoDir, '.codespace', 'worktrees', id)` with `worktreePath`. In removal, `rmSync(wtPath, { recursive: true, force: true })` only after `git worktree remove` and only for a real directory (Task 5 adds the junction guard ahead of this). Stranded means `git for-each-ref refs/heads/cs/` entries with a non-zero `rev-list --count HEAD..<branch>`, minus branches of live agents. Delete `ensureGitignoreExcludes` and rewrite its tests.

- [ ] **Step 4: Add `worktree:canIsolate` and pass `liveAgentIds` from `App.jsx:331`,** collecting terminal ids from every workspace whose `dir` matches, including the one activating.

- [ ] **Step 5: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit** with `feat(worktree): eligibility check, local excludes, never wipe live agents`.

### Task 3: On by default in onboarding

**Files:**
- Modify: `src/renderer/components/Onboarding.jsx:67-68,100-105,152-163,298-318`
- Test: `tests/renderer/Onboarding.isolation.test.jsx` (new)

**Interfaces:**
- Consumes: `electronAPI.worktree.canIsolate(dir)`
- Produces: `onLaunch(counts, dir, name, isolated)` unchanged, with `isolated` true only when eligible.

- [ ] **Step 1: Write the failing tests** with a mocked `electronAPI`:

```js
it('turns on for an eligible repo')          // checkbox checked, launch passes isolated=true
it('stays off and allows launch for a non-repo') // launch enabled, isolated=false, shows the note
it('stays off for a repo with no commits')   // note text mentions making a first commit
it('keeps the user\'s choice when they turned it off, across folder changes')
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/renderer/Onboarding.isolation.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `isRepo` with `canIso` state. Track a user override in a ref. Effective value: `canIso.ok && (override ?? true)`. Remove `isRepo` from `canLaunch`. Disable the checkbox when not eligible. Copy: not a repo, "This folder isn't a git repo, so agents will share it."; no commits, "This repo has no commits yet, so agents will share the folder. Make a first commit to separate them."; git missing, "Git wasn't found, so agents will share this folder."

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(onboarding): isolate agents by default in eligible repos`.

### Task 4: Workspace notice, switching and visible spawn failures

Fixes `App.jsx:144-146`, where a failed create silently drops the pane.

**Files:**
- Create: `src/renderer/isolation-notice.js`, `src/renderer/components/IsolationNotice.jsx` and its CSS
- Modify: `src/renderer/App.jsx:131-159,343` and the render above the grid; `src/renderer/components/WorkspaceRow.jsx:138-146`
- Test: `tests/renderer/isolation-notice.test.js`, `tests/renderer/IsolationNotice.test.jsx`, `tests/renderer/WorkspaceRow.test.jsx`

**Interfaces:**
- Consumes: `canIsolate`
- Produces:
  - `isolationNotice({ isolated, canIso, liveAgents, failures }): { kind: 'spawn-failed' | 'can-isolate' | 'cannot-isolate' | null, actionEnabled: boolean }`
  - `materializeAgents` now returns `{ agents, failures: [{ item, error, detail }] }`
  - App handler `setWorkspaceIsolated(wsId, boolean)`

- [ ] **Step 1: Write the failing tests**

```js
expect(isolationNotice({ isolated: false, canIso: { ok: true }, liveAgents: 2, failures: [] }))
  .toEqual({ kind: 'can-isolate', actionEnabled: false })
expect(isolationNotice({ isolated: false, canIso: { ok: true }, liveAgents: 0, failures: [] }))
  .toEqual({ kind: 'can-isolate', actionEnabled: true })
expect(isolationNotice({ isolated: false, canIso: { ok: false, reason: 'not-a-repo' }, liveAgents: 1, failures: [] }).kind).toBe('cannot-isolate')
expect(isolationNotice({ isolated: true, canIso: { ok: true }, liveAgents: 1, failures: [] }).kind).toBe(null)
expect(isolationNotice({ isolated: true, canIso: { ok: true }, liveAgents: 0, failures: [{}] }).kind).toBe('spawn-failed')
```

Also: the component renders a Retry button for `spawn-failed` and calls `onRetry`; clicking the isolated glyph in `WorkspaceRow` with no live agents calls `onToggleIsolated(id, false)` without selecting the row.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/renderer/isolation-notice.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Copy: `can-isolate`, "Agents here share one folder, so their changes can collide." with action "Use separate folders" (when disabled: "Close this workspace's agents to switch."); `cannot-isolate` uses the Task 3 lines; `spawn-failed`, "Couldn't create a folder for {n} agent(s): {detail}" with action "Retry". Never fall back to the shared folder after a failed create. Store failures on the session-only workspace object and update every `materializeAgents` caller. Turn the `sb-iso` glyph into a button titled "Isolated agents. Click to turn off.", disabled with an explaining title when agents are live, and drop `aria-hidden` from the status wrapper in favour of marking the dot and count individually. Persistence already round-trips `isolated`.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(workspace): isolation notice, switching, visible spawn failures`.

### Task 5: Linked dependencies and env copy

Uses the `depsMode` from Task 1.

**Files:**
- Create: `src/main/worktree-setup.js`
- Modify: `src/main/worktree-manager.js` (`_createImpl`, `_closeImpl`, and every removal path)
- Test: `tests/worktree-setup.test.js` (new)

**Interfaces:**
- Consumes: `execGit`, `worktreePath`
- Produces:
  - `setupWorktree({ repoDir, wtPath }): { warnings: string[] }`
  - `removeDepsLink(wtPath): void`, a no-op when `node_modules` is missing or a real folder
  - `isDepsLink(wtPath): boolean`
  - `worktree.create` result gains `warnings`

- [ ] **Step 1: Write the failing tests.** Create the fixture under a folder named `with space`:

```js
it('links node_modules and git add -A does not stage it', () => {
  setupWorktree({ repoDir, wtPath })
  expect(lstatSync(join(wtPath, 'node_modules')).isSymbolicLink()).toBe(true)
  git(wtPath, 'add', '-A')
  expect(git(wtPath, 'diff', '--cached', '--name-only')).not.toContain('node_modules')
})
it('copies ignored .env files and skips unignored ones', () => {
  // .gitignore contains .env.local only; repo has .env.local and .env.other (untracked, not ignored)
  setupWorktree({ repoDir, wtPath })
  expect(existsSync(join(wtPath, '.env.local'))).toBe(true)
  expect(existsSync(join(wtPath, '.env.other'))).toBe(false)
})
it('does not treat the link as dirty', async () => {
  expect(await checkDirty({ repoDir, agentId })).toEqual({ dirty: false })
})
it.each(['close', 'closeAllForWorkspace', 'wipeAll', 'repairOrphans'])(
  '%s leaves the main node_modules intact', async (path) => {
    writeFileSync(join(repoDir, 'node_modules', 'sentinel'), 'x')
    /* create the agent, then run the named cleanup; repairOrphans needs the wt folder removed first */
    expect(existsSync(join(repoDir, 'node_modules', 'sentinel'))).toBe(true)
  })
it('reports a warning and still returns when the link fails', () => { /* node_modules path blocked by a file in wtPath; warnings.length === 1 */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/worktree-setup.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `symlinkSync(target, path, 'junction')` for the link and `unlinkSync` after an `lstat` check for removal. Candidates are top-level names matching `/^\.env/`, copied only when `git check-ignore -q <name>` exits 0. Call `removeDepsLink` first in the shared removal helper, before `git worktree remove --force`. `setupWorktree` catches its own errors into `warnings`, and `App.jsx` logs them to the pane's warning area through the Task 4 notice.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(worktree): link node_modules and copy env files into new worktrees`.

### Task 6: A port for each isolated pane

**Files:**
- Modify: `src/main/worktree-setup.js`, `src/main/worktree-manager.js`, `src/main/pty-manager.js:55-71`, `src/main/ipc-handlers.js:39-51`, `src/preload/index.js:14-15`, `src/renderer/pty-pool.js:67-84`, `src/renderer/hooks/useTerminal.js`, `src/renderer/components/TerminalPane.jsx`, `src/renderer/App.jsx:151-156,1075`
- Test: `tests/worktree-setup.test.js`, `tests/pty-manager.test.js`, `tests/ipc-handlers.test.js`, `tests/renderer/TerminalPane.branchband.test.jsx`

**Interfaces:**
- Produces:
  - `pickPort(): Promise<number>` in range 4100-4999, reserved in memory until `releasePort(port)`
  - `worktree.create` result gains `port`; `close` releases it
  - `createSession(shell, cwd, cols, rows, extraEnv = {})`
  - `pty:create` accepts `port` (not arbitrary env); `createPty(shell, cwd, cols, rows, port)` in preload; `ptyPool.createPty(shell, cwd, token, cols, rows, port)`
  - Agent records and `TerminalPane` gain `port`

- [ ] **Step 1: Write the failing tests**

```js
it('pickPort skips a port in use and never repeats a reserved one', async () => { /* listen on 4100; two picks differ and neither is 4100 */ })
it('createSession merges extraEnv', () => { /* with the node-pty mock, spawn options env.PORT === '4101' */ })
it('pty:create ignores an invalid port', () => { /* port: 'x' or 80 -> no PORT in env */ })
it('band shows the port', () => { /* render with branch and port=4101; text contains 'port 4101' */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/worktree-setup.test.js tests/pty-manager.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Probe with `net.createServer().listen(port, '127.0.0.1')`. Validate in `pty:create` that port is an integer within 4100-4999 before adding `{ PORT: String(port) }`. Failing to find a port returns `port: null` and a warning, and the agent still starts.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(pty): give each isolated pane its own PORT`.

### Task 7: Check runner

**Files:**
- Create: `src/main/check-runner.js`
- Test: `tests/check-runner.test.js` (new)

**Interfaces:**
- Produces:
  - `detectPackageManager(cwd): 'npm' | 'pnpm' | 'yarn'` from the lockfile, default npm
  - `detectCheck(cwd): 'test' | 'build' | null`
  - `runCheck({ cwd, logPath, timeoutMs = 600000, signal }): Promise<{ result: 'passed' | 'failed' | 'none' | 'timeout' | 'cancelled', script: string | null }>`
  - `runInstall({ cwd, logPath, signal }): Promise<{ ok: boolean }>`

- [ ] **Step 1: Write the failing tests.** The fixture folder name contains a space:

```js
expect(detectCheck(pkg({ test: 'vitest run', build: 'x' }))).toBe('test')
expect(detectCheck(pkg({ test: 'echo "Error: no test specified" && exit 1', build: 'x' }))).toBe('build')
expect(detectCheck(pkg({ dev: 'x' }))).toBe(null)
expect(detectCheck(noPackageJsonDir)).toBe(null)
expect((await runCheck({ cwd: pkg({ test: 'node -e "process.exit(0)"' }), logPath })).result).toBe('passed')
expect((await runCheck({ cwd: pkg({ test: 'node -e "console.log(123);process.exit(1)"' }), logPath })).result).toBe('failed')
expect(readFileSync(logPath, 'utf8')).toContain('123')
it('sets CI=1')
it('timeout kills the process tree', async () => {
  // test script writes its pid to a file, then waits 60s; timeoutMs: 3000
  expect(r.result).toBe('timeout')
  expect(() => process.kill(pid, 0)).toThrow()
})
it('abort signal gives cancelled and kills the tree')
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/check-runner.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Async `spawn` only, following the Global Constraints form. `taskkill /pid <pid> /T /F` for kill. Install commands: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`. Create the log's parent folder. Append both stdout and stderr to the log.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run tests/check-runner.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** with `feat(merge): detect and run a project's check command`.

### Task 8: Merge queue

The highest-risk task, because it writes to the user's main branch.

**Files:**
- Create: `src/main/merge-queue.js`
- Test: `tests/merge-queue.test.js` (new)

**Interfaces:**
- Consumes: `execGit`, `withRepoLock`, `readMeta`, `writeMeta`, `worktreePath`, `isDepsLink`, `removeDepsLink`, and `detectPackageManager`. `runCheck` and `runInstall` are injected.
- Produces:
  - `createMergeQueue({ runCheck, runInstall, onStatus })` returning:
    - `finish({ repoDir, agentId, agentName }): { accepted: boolean }`
    - `cancel(agentId): void`
    - `info({ repoDir, agentId }): { ahead: number, files: number, dirty: boolean, target: string | null }`
  - `onStatus({ agentId, state, target?, detail?, logPath?, lockfileChanged? })` with state one of `'queued' | 'testing' | 'merged' | 'merged-untested' | 'tests-failed' | 'conflict' | 'blocked' | 'idle'`

- [ ] **Step 1: Write the failing tests** with real temp repos and a stub `runCheck`:

```js
it('commits leftovers, rebases, checks, and fast-forwards the target')
  // state sequence: queued, testing, merged. main folder contains the agent's file.
  // master history is linear. Meta baseSha === new head. Close then deletes the branch.
it('leaves the target untouched when the check fails')
  // state tests-failed with logPath; rev-parse master unchanged
it('treats timeout as tests-failed with detail "Timed out after 10 minutes"')
it('marks merged-untested when the check returns none')
it('leaves the rebase in progress on conflict')
  // state conflict; rebase-merge path exists; master unchanged
it('reports conflict again without restarting while a rebase is in progress')
it('blocks when the worktree changed during the check')
  // stub runCheck commits in the worktree; state blocked, detail 'changed during tests'; master unchanged
it('names files when a generated file dirties the tree during the check')
it('re-runs once from rebase when the user committed in the main folder during the check')
  // stub runCheck commits in repoDir on first call only; runCheck called twice; merged; linear
it('blocks if the main folder switched branch during the check')
  // stub runs git switch -c other in repoDir; state blocked; both branches unmoved
it('blocks and names files when main-folder edits overlap, losing nothing')
  // user's uncommitted edit to the same file is still present afterwards
it('blocks on detached HEAD in the main folder')
it('blocks when there is nothing to merge')
it('runs Finishes for one repo in order, never overlapping')
  // deferred stub; second stays 'queued' until the first resolves; second lands rebased on the first
it('runs different repos independently')
it('ignores a second finish for an agent already queued or running')
  // accepted false; runCheck called once
it('cancel while queued removes it; state idle')
it('cancel while checking aborts the signal; nothing lands; state idle')
it('replaces the link with a real install when the lockfile differs, and flags lockfileChanged')
it('blocks when the install fails')
it('does not hold withRepoLock during the check')
  // worktree.create resolves while the stub check is pending
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/merge-queue.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createMergeQueue`** with one promise chain per `repoDir`. The pipeline is spec Part 3 steps 1-8, with these specifics:
  - Run git with `LC_ALL: 'C'` in env so stderr can be parsed. Overlapping files come from the tab-indented lines of git's "would be overwritten" message.
  - Rebase-in-progress check: `git rev-parse --git-path rebase-merge` (and `rebase-apply`), then `existsSync`.
  - Landing, all inside `withRepoLock`: re-read `symbolic-ref --short -q HEAD` and block if it differs from the target; if `merge-base --is-ancestor <target> HEAD` fails, leave the lock and go back to rebase, at most once (a second move gives `blocked`); otherwise `merge --ff-only`.
  - Log path: `<repoDir>/.codespace/merge-logs/<agentId>.log`.
  - Commit message for leftovers: `<agentName>: finish`. A failing commit (hook, no identity) gives `blocked` with stderr, truncated to 500 characters.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run tests/merge-queue.test.js`
Expected: PASS. Run it three times to surface timing flakes.

- [ ] **Step 5: Commit** with `feat(merge): serial rebase-check-fast-forward queue`.

### Task 9: IPC and preload

**Files:**
- Modify: `src/main/ipc-handlers.js`, `src/preload/index.js:106-114`
- Test: `tests/ipc-handlers.test.js`, `tests/preload-sandbox.test.js`

**Interfaces:**
- Consumes: `createMergeQueue`, `runCheck`, `runInstall`
- Produces: `electronAPI.merge = { finish(args), cancel(agentId), info(args), onStatus(cb) => unsubscribe }`, using channels `merge:finish`, `merge:cancel`, `merge:info`, `merge:status`.

- [ ] **Step 1: Write the failing tests**: invalid args (relative `repoDir`, missing `agentId`) return `{ error: 'invalid-args' }`; status events reach `webContents.send('merge:status', ...)` and are skipped when the window is destroyed; preload still loads under the sandbox guard.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ipc-handlers.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement,** following the existing `worktree:*` handler style. `worktree:close` and `worktree:closeAll` call `queue.cancel` first for each agent.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(merge): expose the merge queue over IPC`.

### Task 10: Pane band and failure handoff

**Files:**
- Create: `src/renderer/merge-status.js`, `src/renderer/merge-handoff.js`, `src/renderer/components/FinishControl.jsx` and its CSS
- Modify: `src/renderer/components/TerminalPane.jsx:273-294`, `src/renderer/App.jsx` (subscribe once; pass props)
- Test: `tests/renderer/FinishControl.test.jsx`, `tests/renderer/merge-handoff.test.js`

**Interfaces:**
- Consumes: `electronAPI.merge`, `ptyPool.attach`, `ptyPool.writePty`
- Produces:
  - `handoffText({ target, kind, logPath }): string`
  - `deliverHandoff({ ptyId, shell, text, lastOutputAt, now }): boolean`
  - `useMergeStatus(agentId)`, `useQuiet(ptyId, 4000)`

- [ ] **Step 1: Write the failing tests**

```js
expect(handoffText({ target: 'master', kind: 'tests failed', logPath: 'L' })).toBe(
  'CodeSpace could not merge this branch into master: tests failed. Details are in L. Please fix it and commit. For a conflict, finish with git rebase --continue.')
it('writes the text, then \\r 150ms later, for claude and codex panes') // fake timers; two separate writePty calls
it('does not write to shell panes')
it('does not write when the pane produced output in the last 4000ms; returns false')
it('Finish is disabled while the pane is busy, when nothing is ahead, and while queued or testing')
it('shows "3 commits, 5 files"')
it('tooltip names the target branch')
it('renders each state label') // Queued, Testing, Merged into master, Merged, untested, Tests failed, Conflict, Blocked: reason
it('fires a handoff once per failure, not on re-render')
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/renderer/FinishControl.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** Separate writes matter because text and `\r` in one chunk can read as a paste rather than a submit, the same reason `pty-manager.js:78` delays its `\r`. Call `merge.info` when the pane goes quiet and after each status change, with no polling timer. Clicking a failed or blocked status copies nothing and only exposes its detail as a tooltip. When `lockfileChanged` is set on a merged status, add "Run an install in the main folder." Keep the band hidden on panes without a branch, as today.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(pane): Finish button, merge status and failure handoff`.

### Task 11: Show leftover work

**Files:**
- Create: `src/renderer/components/LeftoverWorkNotice.jsx` and its CSS
- Modify: `src/renderer/App.jsx:330-339`
- Test: `tests/renderer/LeftoverWorkNotice.test.jsx`

**Interfaces:**
- Consumes: `wipeAll` result `{ kept, stranded }`

- [ ] **Step 1: Write the failing tests**: lists each kept worktree with path and branch; lists each stranded branch with its commit count; copy action calls `writeClipboardText(branch)`; dismiss hides it; nothing renders when both lists are empty.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/renderer/LeftoverWorkNotice.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement,** replacing the `console.warn`. Title: "Work left from an earlier session". Dismissing lasts for the session, so the notice returns on the next launch until the branches are dealt with.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit** with `feat(workspace): surface leftover worktrees and unmerged branches`.

### Task 12: Docs and full smoke test

**Files:**
- Modify: `CLAUDE.md` (add `worktree-setup.js`, `check-runner.js` and `merge-queue.js` to the architecture list; add the junction safety rule)

- [ ] **Step 1: Update `CLAUDE.md`.**

- [ ] **Step 2: Run the whole suite and build**

Run: `npx vitest run && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 3: Run the spec's manual smoke list in the real app with the `run` skill,** against a scratch repo, not a client project: four agents landing with linear history, a same-lines conflict resolved on the second Finish, a failing test leaving the main branch unchanged, a no-commits folder launching as shared, and `git reflog` plus remote checks showing nothing pushed.

Expected: each passes. Report any failure with its output rather than marking this done.

- [ ] **Step 4: Commit** with `docs: describe isolated agents v2`, then use superpowers:finishing-a-development-branch.
