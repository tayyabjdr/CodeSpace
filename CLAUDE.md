# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**CodeSpace** — Windows-only Electron desktop app: a multi-workspace grid of Claude CLI agent terminals. Each pane is an `xterm.js` instance backed by a `node-pty` PTY running `powershell.exe -NoLogo -NoProfile -Command 'claude --dangerously-skip-permissions'`. Multiple workspaces can run in parallel; switching unmounts xterm but PTYs keep buffering.

## Commands

```bash
npm run dev            # electron-vite dev — hot reload (renderer); main/preload changes need restart
npm run build          # build all three targets to out/
npm run preview        # run the built app
npm run package        # electron-builder → NSIS installer
npm test               # vitest run (jsdom by default; main-process tests opt into node with a `// @vitest-environment node` header)
npm run test:watch     # vitest watch mode
```

`postinstall` runs `electron-rebuild -f -w node-pty`. node-pty is a native module — if rebuild fails on Windows, see "Windows quirks" below.

## Architecture

Three processes, three source roots under `src/`:

**`src/main/`** — Electron main. Owns:
- `pty-manager.js` — single `Map<id, IPty>` of live PTY sessions. All `write/resize/kill` are defensive: silent no-op on `_exited` flag (set in `proc.onExit`). `kill()` is wrapped in try/catch because conpty cleanup throws on Windows.
- `ipc-handlers.js` — registers `pty:create/write/resize/kill` channels. PTY data flows out via `webContents.send('pty:data:${id}')`.
- `workspaces-store.js` — JSON persistence under `app.getPath('userData')/workspaces.json`.
- `index.js` — `BrowserWindow` (1400×900, `frame: false`), window controls, clipboard IPC, `process.on('uncaughtException')` swallows known node-pty Windows errors so they don't pop dialogs.
- **Isolated agents** (a workspace with `isolated: true` gives each agent its own git worktree):
  - `worktree-manager.js` — create/close/wipe worktrees under `<parent>/.codespace-worktrees/<repo>/<agentId>` on branch `cs/<repo>/<id>`; meta in `.codespace/worktrees/.cs-meta.json`; every mutation runs inside `withRepoLock` (per-repo promise chain). Close keeps a branch that has commits not on the main branch.
  - `worktree-setup.js` — links the main folder's `node_modules` into a worktree as a junction, copies `.env*`, and hands out a per-agent `PORT` (4100–4999, probed on 127.0.0.1, 0.0.0.0, ::1 and ::).
  - `check-runner.js` — runs the repo's `test` (else `build`) script with absolute `cmd.exe`/`taskkill` paths, a timeout and tree kill; `runInstall` does a clean install when the lockfile changed.
  - `merge-queue.js` — the Finish button: commit leftovers, rebase the agent's own commits onto the main branch, run the check, then fast-forward the main branch to exactly the tested commit. One job per repo at a time; status goes to the renderer on `merge:status`.
  - `claude-trust.js` — marks each new agent folder trusted in Claude's `~/.claude.json` (honours `CLAUDE_CONFIG_DIR`) so Claude doesn't ask per agent, and removes the entry when the folder is deleted. Only ever touches paths under a CodeSpace worktree root, never writes a file it can't parse, writes via temp + rename. `tests/setup.js` points `CLAUDE_CONFIG_DIR` at a temp folder so tests never touch the real file.
  - **Junction safety rule:** a worktree's `node_modules` is a junction to the main folder's. Any recursive delete (`rmSync`, `git worktree remove`, `git clean`) follows it on Windows and wipes the user's real dependencies. Always call `removeAllLinks` on the folder first, and if that walk fails, refuse to delete.

**`src/preload/index.js`** — single `contextBridge.exposeInMainWorld('electronAPI', { ... })`. All renderer→main communication goes through this surface.

**`src/renderer/`** — React app:
- `App.jsx` is the top-level state machine. Holds `workspaces[]` (each with id, name, dir, agentCount + session-only `terminals`, `agentCounter`, `focusedTerminalId`, `fontSize`, `spawned`) and `activeWorkspaceId`. When `workspaces.length === 0` it renders `Onboarding`; otherwise the running shell with `Sidebar` + grid.
- **`pty-pool.js`** is the critical piece. PTY lifecycle is decoupled from xterm mount lifecycle: a single IPC subscription per PTY fans out data to any currently-attached listener and appends to a 64KB ring per PTY. When a `TerminalPane` mounts, it `attach()`es to its PTY, gets the ring replayed, then live data. On unmount the listener detaches but the PTY keeps running. **Workspace deletion is the only path that calls `killPty`.**
- `hooks/useTerminal.js` — wires the xterm `Terminal` to the pool, manages fit/resize, debounces font-size changes (180ms) and window/splitter resizes (100ms) before sending SIGWINCH so neither a Ctrl+wheel burst nor a drag stacks TUI redraws, skips any PTY resize that doesn't change cols/rows (conpty rewraps and signals the child even on an identical size), intercepts Ctrl+V/Ctrl+Shift+C for clipboard via Electron IPC. Passes xterm `windowsPty` from `windows-pty.js` — see "Windows quirks".
- `components/TerminalPane.jsx` — pane shell. Header is the drag handle (`draggable={!editing}`); pane is the drop target; swapping is a renderer-only reorder of the active workspace's `terminals` array (same `key={t.id}` keeps xterm in place). Double-click the label to rename. "Done" notification only arms after Enter is pressed in that pane, then 4s of silence.

### Persistence model

Only `{ id, name, dir, agentCount }` is saved. Terminals are spawned lazily on first activation each session. The session resumes maximized if any workspace exists; otherwise the window stays at 1400×900 for onboarding. **Deletion saves persistence BEFORE killing PTYs** so a conpty seg-fault mid-cleanup can't leave a deleted workspace on disk.

### Grid layout

Column count: `1→1, 2→2, 3→3, 4→2×2, 5–6→3×2, 7+→4×2 max`. Both `grid-template-columns` and `grid-template-rows` are set explicitly so all rows are equal height regardless of when xterm fits. Column logic lives in `App.jsx` and the matching preview logic in `Onboarding.jsx`'s `colsFor()`.

## Design System

`src/renderer/design-tokens.css` defines all `--cs-*` custom properties and **must be imported first** in `App.jsx` before `App.css`. Current palette is "subtle bluish" — bases `#0a0b0d → #11151b`, borders `#1b1e24 → #2b3038`. Cyan accent `--cs-cyan: #67e8f9` for live counts and emphasis; green `--cs-green: #86efac` for status/done.

Fonts: **Geist Variable** (UI) and **Geist Mono Variable** (terminal/labels) — loaded via `@fontsource-variable/*`. The `theme-preview.html` at the repo root documents the palette decision.

Aesthetic: refined dark minimalism. Use opacity-tier whites for text (`--cs-text-primary` … `--cs-text-dim`). Animations are one-shot 200–500ms ease curves; **avoid infinite/looping animations** — they read as flicker on this palette.

## UI work

There is a workspace-level instruction to **invoke the `frontend-design` skill before making any UI/visual changes**. Match the existing aesthetic — never invent a new visual language for a sub-component.

Brainstorming and writing-plans skills should run for any new feature work; the production-readiness audit at `docs/superpowers/specs/2026-05-05-prod-readiness-audit.md` is the authoritative punch list of known issues.

## Windows quirks

These are environment realities, not bugs to fix:

- `conpty_console_list_agent.js: Error: AttachConsole failed` — node-pty child worker fails to attach a console. Already swallowed by `process.on('uncaughtException')` in `main/index.js`. Cosmetic.
- Multiple PTYs killed in quick succession can seg-fault main (exit 139). Mitigated by save-before-kill and the defensive try/catch in `pty-manager.js`.
- Sometimes Claude spawns visibly outside the app — same conpty fallback. Tell the user to close the orphan; the in-app pane is fine.
- `pty.spawn` for Claude uses `powershell.exe -NoLogo -NoProfile -Command 'claude ...'`. Switching to `cmd.exe /c claude` may avoid some conpty fallback paths but is untested.
- node-pty native rebuild on a fresh checkout requires Python 3.12 + setuptools + a patched `node_modules/node-pty/deps/winpty/src/winpty.gyp`. See the project memory for the exact patch.
- xterm must be told it is reading a ConPTY via the `windowsPty` option (`renderer/windows-pty.js`). Left unset, xterm pulls scrollback rows up into the viewport when the terminal grows, while ConPTY instead opens blank rows and lets the agent repaint into them — so a resize leaves duplicated lines and blank gaps in the buffer. The build number matters too: xterm only keeps reflow on for conpty >= 21376.
- The preload runs with `sandbox: true`, so it can only `require` `electron`, `events`, `timers` and `url`. Anything else throws while it loads and the renderer comes up with no `electronAPI` at all — it builds fine, so `tests/preload-sandbox.test.js` guards it. Node-side values it needs (e.g. `os.release()`) come from main over the `app:ptyHostInfo` sync channel.

## Specs and history

- `docs/superpowers/specs/2026-04-28-codespace-terminals-design.md` — original feature design.
- `docs/superpowers/specs/2026-05-05-workspaces-design.md` — workspaces (left rail) design.
- `docs/superpowers/specs/2026-05-05-prod-readiness-audit.md` — **start here** when picking up production hardening work. Items 1–5 are ship-blockers.
