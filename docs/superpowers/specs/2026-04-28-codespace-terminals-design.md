# CodeSpace — Vibecoding Terminal App Design

**Date:** 2026-04-28  
**Status:** Approved

---

## Overview

CodeSpace is a standalone Electron desktop app for Windows that opens a flexible grid of real terminal sessions. Designed for vibecoding workflows where multiple shells (Claude CLI, dev server, git, tests) need to be visible simultaneously.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron |
| UI | React + Vite |
| Terminal renderer | xterm.js (WebGL addon) |
| Shell process | node-pty |
| Native rebuild | electron-rebuild |
| Packaging | electron-builder |

---

## Architecture

```
CodeSpace/
├── main/
│   ├── index.js           # app bootstrap, BrowserWindow creation
│   ├── pty-manager.js     # node-pty: spawn/kill/resize shell sessions
│   └── ipc-handlers.js    # IPC bridge between main ↔ renderer
├── renderer/
│   ├── main.jsx           # React root
│   ├── App.jsx            # grid state, terminal list
│   ├── components/
│   │   ├── Toolbar.jsx    # + button, shell picker, keyboard hints
│   │   └── TerminalPane.jsx  # mounts one xterm.js instance
│   └── hooks/
│       └── useTerminal.js # xterm init, IPC wiring, resize observer
├── vite.config.js
└── package.json
```

### Data Flow

1. User adds a terminal → renderer sends `pty:create` IPC with shell choice
2. Main spawns node-pty session, returns a unique `ptyId`
3. Renderer creates an xterm.js instance, subscribes to `pty:data:{ptyId}` events
4. User types → xterm sends `pty:write` IPC → node-pty writes to shell stdin
5. Shell outputs → node-pty emits `pty:data` → xterm renders it
6. Window/pane resized → renderer sends `pty:resize` with new cols/rows

---

## Grid Layout

Fixed 4-column CSS Grid. Terminals fill left-to-right, top-to-bottom. All panes share equal space automatically.

| Terminal count | Grid shape |
|---------------|-----------|
| 1 | 1 col × 1 row (full window) |
| 2 | 2 col × 1 row |
| 3 | 3 col × 1 row |
| 4 | 4 col × 1 row |
| 5–8 | 4 col × 2 rows |
| 9–12 | 4 col × 3 rows |

No manual pane resizing in the base — equal distribution only.

---

## Shell Management

- **Supported shells:** PowerShell, cmd.exe
- **Default:** PowerShell
- **Selection:** Per-pane dropdown shown before the terminal spawns; cannot be changed after spawn (base scope)
- **Auto-path:** Shell executables resolved from PATH at runtime

---

## Toolbar & Keyboard Shortcuts

Slim toolbar fixed at the top of the window:

| Action | Button | Shortcut |
|--------|--------|----------|
| Add terminal | `+` button | `Ctrl+T` |
| Close focused terminal | `×` on pane header | `Ctrl+W` |

Active/focused pane is determined by last mouse click or last keyboard interaction inside a pane.

---

## IPC Contract

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `pty:create` | renderer → main | `{ shell: 'powershell' \| 'cmd' }` | `{ ptyId: string }` |
| `pty:write` | renderer → main | `{ ptyId, data: string }` | — |
| `pty:resize` | renderer → main | `{ ptyId, cols, rows }` | — |
| `pty:kill` | renderer → main | `{ ptyId }` | — |
| `pty:data` | main → renderer | `{ ptyId, data: string }` | — |

---

## Error Handling

- Shell spawn failure → pane shows inline error message with a "Retry" button
- node-pty process exit → pane header turns red, shows exit code, offers "Reopen"
- IPC timeout (>5s no response) → treated as spawn failure

---

## Out of Scope (Base)

- Saved/named workspaces
- Pane drag & drop or manual resizing
- OSC 133 shell integration (Blocks)
- Tabs or multiple windows
- Themes / font customization
- WSL / Git Bash support
