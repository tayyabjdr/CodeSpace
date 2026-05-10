# Settings — Tier 1

**Status:** Design approved 2026-05-10. Implementation pending.

## Goal

Add a Settings modal to CodeSpace covering the four "table-stakes" controls expected of an agentic dev environment: appearance, notifications, updates, and an agent-command toggle. Replace the redundant `+ New Workspace` button at the bottom of the sidebar with a footer row containing a gear button (opens the modal) and a clickable version label.

This is the v1 of a settings surface. Tier 2/3 controls (keybindings, default workspace behavior, terminal scrollback, telemetry) are explicitly out of scope.

## Non-goals

- Surfacing settings that belong in Claude's own config (model, API keys, MCP servers, hooks, system prompt, tool allowlist). Those live in `~/.claude/settings.json`; duplicating them creates two sources of truth.
- Themes, font choices, or anything that requires bundling additional assets — only Geist / Geist Mono are bundled today.
- Per-workspace settings overrides. All settings here are app-global.
- Live re-application to existing PTYs (e.g., re-spawning panes when the dangerous flag toggles).
- Reset-to-defaults, import/export, settings sync. Add when someone asks.

## Scope

### Sections and controls

**Appearance**
- *Default pane font size* — number stepper, integer 10–22, default `14`. Applies only to new panes; existing panes keep their per-pane size.

**Notifications**
- *Done sound volume* — slider 0–100, default `50`. `0` means muted (no separate boolean, matching today's `volume-store` semantics). Mirrors what already exists in the title-bar `VolumeControl`; the modal slider and title-bar slider read/write the same value.
- *Flash taskbar on done* — toggle, default `true`. Calls `BrowserWindow.flashFrame(true)` when an inactive pane finishes; auto-clears on focus (Windows default).

**Updates**
- *Version display* — non-interactive label `vX.Y.Z` plus an "up to date" / "update available" caption. Click-through opens `https://github.com/tayyabjdr/CodeSpace/releases/tag/vX.Y.Z` in the default browser.
- *Auto-update* — toggle, default `true`. When off, sets `autoUpdater.autoDownload = false` and `autoInstallOnAppQuit = false`.
- *Check for updates* — secondary button. Calls `autoUpdater.checkForUpdates()` and replaces itself with a status line: "Up to date", "Downloading vX.Y.Z…", or "Couldn't check for updates".

**Agents**
- *Skip permission prompts* — toggle, default `true`. Caption: "Runs claude with --dangerously-skip-permissions". When off, the PTY spawn omits that flag. Affects only future spawns; live PTYs keep their original command.

### Sidebar footer change

Remove the `sb-new-btn` (`+ New Workspace`) button. The header `+` button (`sb-header-add`) already exists and is the canonical entry point. Add a thin footer row separated from the workspace list by a `--cs-border-subtle` divider:

- Left: gear icon button. Opens the settings modal.
- Right: version label in `--cs-text-dim`. Click opens the GitHub release page for the current version.

## Architecture

### Storage

All settings live in `userData/settings.json`, a sibling of `workspaces.json`. Same patterns as `workspaces-store.js`: atomic write via temp file + rename; in-memory cache; corrupt-file recovery (rename to `settings.json.corrupt-<timestamp>`, write defaults, continue); validation fills missing keys from defaults so partial files never break.

### File shape

```json
{
  "version": 1,
  "appearance": {
    "defaultPaneFontSize": 14
  },
  "notifications": {
    "doneSoundVolume": 50,
    "taskbarFlashOnDone": true
  },
  "updates": {
    "autoUpdate": true
  },
  "agents": {
    "dangerouslySkipPermissions": true
  }
}
```

`version: 1` exists so future shape migrations don't need to fall back to defaults. All defaults equal today's behavior — first-launch users see no functional change.

### Files added

- `src/main/settings-store.js` — load/save/validate `settings.json`. Mirrors `workspaces-store.js` API: `loadSettings()`, `saveSettings()`, in-memory cache, corrupt-file recovery.
- `src/main/settings-handlers.js` — registers `settings:get`, `settings:set`, `app:version`, `updates:check`, `window:flash`.
- `src/renderer/settings-store.js` — thin renderer wrapper. On boot, calls `electronAPI.getSettings()` once. Exposes `getState()`, `subscribe()`, and `setSettings(patch)`. Mirrors the existing `volume-store.js` API so consumers swap with one import change.
- `src/renderer/components/SettingsModal.jsx` + `SettingsModal.css` — the modal UI.

### Files touched

- `src/main/index.js` — call `loadSettings()` early; pass result to `auto-updater.js` init.
- `src/main/pty-manager.js` (or wherever the spawn command is built) — read `agents.dangerouslySkipPermissions` from settings at each spawn.
- `src/main/auto-updater.js` — initial `autoDownload` / `autoInstallOnAppQuit` set from settings; updated when `settings:set` patches `updates.autoUpdate`.
- `src/preload/index.js` — expose `getSettings`, `setSettings`, `getAppVersion`, `checkForUpdates`, `flashWindow`. (`openExternal` is already exposed and used for the version-link click-through.)
- `src/renderer/components/Sidebar.jsx` + `Sidebar.css` — replace `sb-new-btn` with the new footer row (gear + version).
- `src/renderer/components/VolumeControl.jsx` and `done-sound.js` — read from new settings store.
- `src/renderer/done-tracker.js` — call `electronAPI.flashWindow()` on done if the setting is on.
- `src/renderer/App.jsx` — render `<SettingsModal>` at top level; own open/closed state; new-pane spawn reads `defaultPaneFontSize` from settings.

`volume-store.js` stays in the tree but is no longer imported. Delete after migration has baked through one or two releases.

### IPC surface

```js
// preload electronAPI
getSettings:    ()      => ipcRenderer.invoke('settings:get')      // → full settings object
setSettings:    (patch) => ipcRenderer.invoke('settings:set', patch) // → full settings object after merge
getAppVersion:  ()      => ipcRenderer.invoke('app:version')       // → string
checkForUpdates:()      => ipcRenderer.invoke('updates:check')     // → { status, version?, message? }
flashWindow:    ()      => ipcRenderer.invoke('window:flash')      // → void
```

`setSettings` accepts a partial nested object (e.g., `{ notifications: { doneSoundVolume: 30 } }`). Main deep-merges over the cached settings, validates the result, writes atomically, applies side effects, and returns the new full settings. The renderer updates its cache from the return value.

`updates:check` returns `{ status: 'up-to-date' | 'downloading' | 'error', version?: string, message?: string }`. The modal renders this without subscribing to `autoUpdater` events directly.

### Side effects on `settings:set`

- `updates.autoUpdate` change → set `autoUpdater.autoDownload` and `autoInstallOnAppQuit` to match.
- `agents.dangerouslySkipPermissions` change → no-op for live PTYs; new spawns read at spawn time.
- `notifications.taskbarFlashOnDone`, `notifications.doneSoundVolume`, `appearance.defaultPaneFontSize` → no main-side effect; renderer reads on next use.

No `settings:changed` broadcast from main → renderer. The renderer is the only writer (the modal is the only place users change settings), so push-back isn't needed.

## Data flow

1. App boot → main reads `settings.json` → caches in memory.
2. Renderer boot → `electronAPI.getSettings()` → renderer cache populated → components subscribe.
3. User changes a setting → renderer cache updates immediately (UI is responsive) → IPC `settings:set` → main writes file → main applies side effects → main returns full settings → renderer reconciles cache.
4. Settings with main-side effects (auto-update, dangerous flag) take effect *next time the relevant code runs*. We don't re-spawn live PTYs.

## Settings → effect mapping

| Setting | Read by | Applied when | Affects existing state? |
|---|---|---|---|
| `appearance.defaultPaneFontSize` | Renderer (App.jsx new-pane spawn) | Next pane creation | No |
| `notifications.doneSoundVolume` | Renderer (`done-sound.js` gain node) | Next done event | N/A (per-event) |
| `notifications.taskbarFlashOnDone` | Renderer (`done-tracker.js`) → `flashWindow()` IPC → main | Next done event | N/A (per-event) |
| `updates.autoUpdate` | Main (`auto-updater.js`) | Immediately on `settings:set` | Already-downloaded update on disk still installs on next quit (electron-updater behavior; we don't try to undo it) |
| `agents.dangerouslySkipPermissions` | Main (PTY spawn site) | Next PTY spawn | No |

## UI

### Sidebar footer

```
┌────────────────────┐
│  workspaces     +  │  ← header (unchanged)
│  ┌──────────────┐  │
│  │ Agent 01   2 │  │
│  │ Agent 02   3 │  │
│  └──────────────┘  │
│                    │
│  ⚙           v1.0.2│  ← NEW footer row
└────────────────────┘
```

### Settings modal

```
┌───────────────────────────────────────────────┐
│  Settings                                  ×  │
├───────────────────────────────────────────────┤
│                                               │
│  Appearance                                   │
│   Default pane font size            [ 14 ⌄ ]  │
│                                               │
│  Notifications                                │
│   Done sound volume          ─────●──── 50%   │
│   Flash taskbar on done             [  ●  ]   │
│                                               │
│  Updates                                      │
│   Version                  v1.0.2 (up to date)│
│   Auto-update                       [  ●  ]   │
│                       [ Check for updates ]   │
│                                               │
│  Agents                                       │
│   Skip permission prompts           [  ●  ]   │
│   Runs claude with --dangerously-skip-…       │
│                                               │
└───────────────────────────────────────────────┘
```

- Centered, ~480px wide, height fits content (~520px).
- Backdrop `rgba(0,0,0,0.5)` matching existing overlay style. Click-outside dismisses; Esc dismisses; focus trapped while open.
- Section headers in `--cs-text-secondary`, small uppercase letterspacing — matches the sidebar `workspaces` label.
- Controls right-aligned; labels left-aligned. One row per setting.
- A shared `<Toggle>` component is introduced (no toggle component exists yet). Used by Flash-taskbar, Auto-update, Skip-permission-prompts.
- Font-size control: `<select>` with options 10/11/12/13/14/15/16/18/20/22.
- Volume slider visually matches the existing `VolumeControl` styling.
- "Check for updates" is a secondary button; on click, becomes a status line until dismissed or modal closes.
- The "Skip permission prompts" caption is `--cs-text-dim`, smaller than the label.

The pixel-level styling pass happens during implementation under the `frontend-design` skill. This section locks structure, not styling. Tokens only — `--cs-bg-*`, `--cs-text-*`, `--cs-border-*`, `--cs-cyan`, `--cs-green`. No infinite animations.

## Migration

On first renderer load after the update:

```js
const legacyRaw = localStorage.getItem('codespace.volume.v1')
if (legacyRaw) {
  try {
    const { volume } = JSON.parse(legacyRaw)
    if (Number.isFinite(volume)) {
      await electronAPI.setSettings({ notifications: { doneSoundVolume: volume } })
    }
  } catch {}
  localStorage.removeItem('codespace.volume.v1')
}
```

One-shot, idempotent. Corrupt legacy value falls back to the default 50.

## Error handling

- `settings.json` missing → write defaults, continue.
- `settings.json` corrupt JSON → rename to `settings.json.corrupt-<timestamp>`, write defaults, continue.
- `settings.json` valid JSON but missing keys → validation fills from defaults. Never reject partial files.
- `settings:set` IPC failure (disk full, permission) → main returns `{ ok: false, error }`; renderer keeps the optimistic UI value and shows a small inline error. We do not roll back the UI — losing the user's input mid-edit is worse than a temporarily-wrong on-disk state.
- `updates:check` failure → status line shows "Couldn't check for updates"; never throws to renderer.

## Testing

The `tests/` directory is empty today but vitest is configured (jsdom).

- `settings-store.test.js` (main) — round-trip, missing file, corrupt file, partial file, deep-merge patch behavior.
- `settings-migration.test.js` (renderer/jsdom) — legacy localStorage value gets pushed via `setSettings` and removed; absent localStorage is a no-op; corrupt legacy value is removed cleanly without throwing.

No UI tests for the modal — render snapshots are low-value here. Manual verification follows the CLAUDE.md instruction: spin up `npm run dev`, open the modal, exercise every control, verify side effects (font size on new panes, volume on a done event, flash on an inactive done event, auto-update toggle, dangerous flag on a fresh spawn).

## Out of scope (Tier 2+)

- Keybindings UI.
- Default workspace behavior (isolated-by-default toggle, default agent count, default parent dir).
- "Done" silence threshold knob.
- Terminal scrollback size, cursor style, bell behavior.
- Telemetry opt-out (only meaningful if telemetry is added).
- Settings sync, import/export, reset-to-defaults.
- Beta release channel.
- Editing the full agent command or appending extra args.

## References

- Existing patterns: `src/main/workspaces-store.js`, `src/renderer/volume-store.js`.
- Existing UI tokens: `src/renderer/design-tokens.css`.
- CLAUDE.md — design-system rules, Windows quirks, frontend-design skill instruction.
