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
npm test               # vitest run (jsdom; tests/ dir is currently empty but infra is configured)
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

**`src/preload/index.js`** — single `contextBridge.exposeInMainWorld('electronAPI', { ... })`. All renderer→main communication goes through this surface.

**`src/renderer/`** — React app:
- `App.jsx` is the top-level state machine. Holds `workspaces[]` (each with id, name, dir, agentCount + session-only `terminals`, `agentCounter`, `focusedTerminalId`, `fontSize`, `spawned`) and `activeWorkspaceId`. When `workspaces.length === 0` it renders `Onboarding`; otherwise the running shell with `Sidebar` + grid.
- **`pty-pool.js`** is the critical piece. PTY lifecycle is decoupled from xterm mount lifecycle: a single IPC subscription per PTY fans out data to any currently-attached listener and appends to a 64KB ring per PTY. When a `TerminalPane` mounts, it `attach()`es to its PTY, gets the ring replayed, then live data. On unmount the listener detaches but the PTY keeps running. **Workspace deletion is the only path that calls `killPty`.**
- `hooks/useTerminal.js` — wires the xterm `Terminal` to the pool, manages fit/resize, debounces font-size changes (180ms) before sending SIGWINCH so a Ctrl+wheel scroll burst doesn't stack TUI redraws, intercepts Ctrl+V/Ctrl+Shift+C for clipboard via Electron IPC.
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

## Specs and history

- `docs/superpowers/specs/2026-04-28-codespace-terminals-design.md` — original feature design.
- `docs/superpowers/specs/2026-05-05-workspaces-design.md` — workspaces (left rail) design.
- `docs/superpowers/specs/2026-05-05-prod-readiness-audit.md` — **start here** when picking up production hardening work. Items 1–5 are ship-blockers.
