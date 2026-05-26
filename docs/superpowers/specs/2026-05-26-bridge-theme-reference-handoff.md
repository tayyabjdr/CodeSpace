# Bridge Theme and Reference-Inspired Features - Claude Handoff

**Date:** 2026-05-26  
**Input:** BridgeMind reference screenshot supplied in chat.  
**Primary request:** Make that color treatment a selectable CodeSpace theme.  
**Implementation priority:** Ship the theme selector first. Treat the functionality inventory below as a backlog, not part of the first change.

## Handoff Prompt

Implement Phase 1 of this document in the existing `CodeSpace` Electron/Vite/React app. The app already has workspaces, mixed Claude/Codex terminal panes, isolated git worktrees, automatic pane naming, task-done state, an editor, Settings, and the right-side Skills panel. Do not recreate those features.

Add an app-global, persisted Appearance theme selector with two choices:

- `Sarvis Dark` - the current appearance and default for existing/new users.
- `Bridge` - a warm charcoal/plum interface inspired by the provided BridgeMind reference: rose/magenta active highlights, soft green completed/running accents, teal/cyan secondary accents, muted warm borders and panel surfaces.

The reference is inspiration for palette and interaction hierarchy only. Do not import its branding, logo, exact product name, or assets.

The theme must apply live without restarting, persist through `settings.json`, and cover shell chrome, terminals, editor, panes, sidebar, toolbar, Settings, Skills panel, onboarding, dialogs, and notification/done states. Keep every existing behavior working and add focused tests.

## Current Code Facts

Read these before changing code:

| Concern | Existing implementation |
| --- | --- |
| Global colors/layout variables | `src/renderer/design-tokens.css`; fixed values currently live in `:root`. |
| Settings persistence/validation | `src/main/settings-store.js`; renderer facade at `src/renderer/settings-store.js`. |
| Settings UI | `src/renderer/components/SettingsPage.jsx` and `.css`; Appearance currently has only pane font size. |
| App initialization | `src/renderer/App.jsx` calls `initSettings()` during initial load. |
| Terminal palette | `src/renderer/hooks/useTerminal.js`; xterm colors are currently hard-coded in the constructor. |
| Editor palette | `src/renderer/codemirror-theme.js` reads some CSS tokens, but syntax colors include hard-coded current accent values. |
| Shell surfaces | `Toolbar`, `Sidebar`, `RightToolbar`, `TerminalPane`, `SkillsPanel`, `Onboarding`, `ConfirmDialog`, `EditorPane` CSS. |
| Tests to extend | `tests/main/settings-store.test.js`, `tests/renderer/SettingsPage.test.jsx`, plus targeted renderer tests if a theme helper is introduced. |

The working tree already contains a modification to `electron.vite.config.js`; do not overwrite or revert unrelated changes.

## Phase 1: Selectable Bridge Theme

### Product Behavior

1. Settings > Appearance shows a `Theme` control above `Default pane font size`.
2. The control exposes exactly `Sarvis Dark` and `Bridge`, using accessible buttons, radios, or a select.
3. Selecting `Bridge` repaints the running app immediately, including already-mounted terminal and editor surfaces.
4. Selecting `Sarvis Dark` returns to the existing visual behavior.
5. Relaunching the app restores the chosen theme.
6. A missing, old, or invalid setting resolves to `sarvis-dark`, with no blank or partially styled render.

### Persisted Setting

Extend the existing appearance shape:

```json
{
  "appearance": {
    "theme": "sarvis-dark",
    "defaultPaneFontSize": 13
  }
}
```

Use identifiers:

```js
const THEME_IDS = ['sarvis-dark', 'bridge']
```

- Add `theme: 'sarvis-dark'` in both settings defaults used by main and renderer.
- In `src/main/settings-store.js`, allowlist the two IDs; invalid values fall back to `DEFAULTS.appearance.theme`.
- Do not needlessly change the settings schema version: the existing validator already fills missing nested fields.

### Applying the Theme

Use a document attribute as the CSS boundary:

```html
<html data-theme="bridge">
```

- Add one small renderer helper, for example `src/renderer/theme.js`, that validates a theme ID and sets `document.documentElement.dataset.theme`.
- In `App.jsx`, apply the initialized value after `initSettings()` resolves and subscribe to settings changes so selection is live.
- Keep current tokens as the default `:root` palette. Add theme overrides under `:root[data-theme='bridge']` in `design-tokens.css`.
- Do not fork component stylesheets into two themes. Components should consume semantic tokens.

### Bridge Palette Direction

The screenshot is warmer and softer than the current near-black/cyan scheme. Start with the following approximated tokens and tune visually while the reference is open:

| Token | Bridge starting value | Use |
| --- | --- | --- |
| `--cs-bg-base` | `#282630` | page/grid background |
| `--cs-bg-sidebar` | `#2c2a35` | left/right/title rails |
| `--cs-bg-surface` | `#302e39` | terminal/editor cards |
| `--cs-bg-elevated` | `#393643` | controls, selected fills |
| `--cs-border` | `#403d4a` | subtle separators |
| `--cs-border-mid` | `#514c5d` | card/header borders |
| `--cs-border-focus` | `rgba(227, 91, 166, 0.62)` | focused pane outline |
| `--cs-text-primary` | `rgba(248, 244, 250, 0.94)` | main text |
| `--cs-text-secondary` | `rgba(238, 232, 242, 0.76)` | supporting text |
| `--cs-text-tertiary` | `rgba(218, 208, 224, 0.52)` | muted labels |
| `--cs-text-muted` | `rgba(206, 195, 214, 0.35)` | least emphasis |
| `--cs-cyan` / primary interactive accent | `#e15a9e` | active tools, selection, sliders |
| `--cs-cyan-bg` | `rgba(225, 90, 158, 0.14)` | selected control fill |
| `--cs-cyan-glow` | `rgba(225, 90, 158, 0.32)` | controlled focus glow |
| `--cs-green` | `#7acb85` | done/running/healthy |
| `--cs-violet` | `#da86b9` | Codex/accent badge |
| `--cs-amber` | `#dda04c` | warning/exited |
| `--cs-red` | `#e06a72` | destructive/error |

Despite the legacy variable name `--cs-cyan`, it may represent the primary accent in this initial implementation to avoid unsafe broad renaming. If you introduce an alias such as `--cs-accent-primary`, do it consistently and keep the diff bounded.

### Token Coverage Requirement

Changing only `design-tokens.css` is not enough. Existing code includes hard-coded accent and terminal colors. Audit `src/renderer` for `#67e8f9`, `#86efac`, `#c4b5fd`, and matching accent RGBA values. Move visibly theme-sensitive uses to semantic tokens or Bridge-specific token overrides.

At minimum cover:

- Active sidebar/right toolbar indicators.
- Focus and drag-over terminal outlines.
- Done terminal header gradient and glow.
- Agent badges and isolated-workspace icon gradient.
- Toggle/range controls and link/focus colors.
- Editor active state, selection, cursor, and syntax highlight accents.
- xterm background, foreground, selection, cursor, and ANSI accent palette.

Plain white-alpha hover states may remain shared if they render correctly on both palettes.

### Mounted Terminal and Editor Handling

This is the main implementation trap:

- `useTerminal.js` creates xterm with a static, hard-coded `theme` object. Extract a `buildTerminalTheme()` helper that reads CSS tokens after `data-theme` changes. Apply it at construction and set `term.options.theme = buildTerminalTheme()` in an effect when the active theme ID changes. Do not kill or recreate PTYs to change colors.
- `codemirror-theme.js` partly reads tokens but hard-codes syntax accents. Make its palette derive from CSS variables. Ensure an already open editor updates when the theme changes, using the existing CodeMirror state/reconfiguration approach if available; otherwise introduce the smallest controlled reconfiguration, without discarding the current document or cursor/scroll state.

### Files Expected To Change

Likely edits:

- `src/main/settings-store.js`
- `src/renderer/settings-store.js`
- `src/renderer/design-tokens.css`
- `src/renderer/App.jsx`
- `src/renderer/components/SettingsPage.jsx`
- `src/renderer/components/SettingsPage.css`
- `src/renderer/hooks/useTerminal.js`
- `src/renderer/codemirror-theme.js`
- CSS/components containing hard-coded current accent values found during audit
- `tests/main/settings-store.test.js`
- `tests/renderer/SettingsPage.test.jsx`

Possible small additions:

- `src/renderer/theme.js`
- `src/renderer/terminal-theme.js`
- narrowly scoped unit tests for those helpers

### Acceptance Criteria

- Default install and old settings files visually remain `Sarvis Dark`.
- Settings Appearance exposes and persists the two themes.
- Theme switch is immediate while terminals are running.
- Existing open xterm panes and an open CodeMirror editor adopt the selected theme without losing session state.
- `Bridge` resembles the screenshot's warm plum/charcoal base with rose selection and green completion cues, rather than the current near-black/cyan design.
- No BridgeMind assets or branding are copied.
- All existing tests pass; new settings/theme tests pass.
- Run `npm test` and `npm run build`.

## Functionality Available From The Reference

### Already Present In CodeSpace

Do not pitch or rebuild these as new work:

| Reference element | Existing CodeSpace equivalent |
| --- | --- |
| Workspace list and active workspace | `Sidebar` and persisted workspace state |
| Grid of live agent panes | `TerminalPane` grid |
| Completion cues | done tracker, sound/taskbar notification, done pane visuals |
| Multiple agent sessions | Claude and Codex pane picker |
| Per-agent isolation hint | git worktree branches and isolated badge |
| Tool rail | `RightToolbar` with functional Skills panel |
| Pane maximize/close/reorder | fullscreen, close, drag-to-swap |
| Settings access | full-page Settings surface |

### High-Value Next Builds

These are meaningfully inspired by the screenshot and are not currently delivered as full features:

| Priority | Feature | What to build | Why it fits |
| --- | --- | --- | --- |
| P1 | Workspace status badges | Derive per-workspace counts for running, done-awaiting-review, and exited/error panes; render compact colored badges in `Sidebar`. | The reference communicates workload at a glance; current sidebar only shows total count and a done dot. |
| P1 | Agent inspector panel | Clicking a pane opens a right panel with agent type, cwd/branch, status, last completion time, copy branch, reveal folder, focus pane, close pane. | Converts the reference's right-side detail area into useful CodeSpace controls without replacing terminals. |
| P2 | Task inbox | Collect done/error events into a small review queue with actions to focus the pane and mark reviewed; badge the panel icon. | Makes background agent completion actionable across many workspaces. |
| P2 | Panelize slash commands | Enable the currently stubbed `commands` entry in `RightToolbar`, sharing the proven drag-to-terminal interaction used by Skills. | Already anticipated by existing code and docs; reference validates a richer right utility rail. |
| P3 | Branch review actions | For isolated agents, show changed-file/commit summary and controlled merge or cherry-pick flow into the base workspace. | Builds on existing worktree isolation; highest complexity and risk. |
| P3 | Workspace ordering/pinning | Drag/reorder and pin frequently used workspaces; keep status badges visible. | Useful once the sidebar carries many concurrent workspaces. |

### Recommended Sequencing

1. Implement the selectable `Bridge` theme only.
2. Add workspace status badges, using existing done/exit tracking without new process orchestration.
3. Add an agent inspector panel on the existing right rail.
4. Build a task inbox only after the inspector establishes a stable event/status model.
5. Consider git review/merge actions separately; they alter repository state and need their own design review.

## Explicit Non-Goals For Phase 1

- No layout rewrite to exactly match the screenshot.
- No right-side agent avatar/voice assistant panel.
- No task inbox, badge counting, or branch merge UI.
- No copying external logos, imagery, names, or proprietary artwork.
- No change to terminal lifecycle, PTY spawning, agent command behavior, or worktree behavior.

## Verification Notes For Claude

Test additions should cover:

- main settings validator defaults `appearance.theme` for old/invalid input and round-trips `bridge`;
- Settings Appearance renders theme choices and calls `setSettings({ appearance: { theme: 'bridge' } })`;
- theme application sets `document.documentElement.dataset.theme` and reacts to subscribed settings changes, if separated into a testable helper;
- a manually open terminal and editor repaint on theme toggles while their contents/session remain intact.

Perform a visual manual pass in `npm run dev` with both themes: onboarding, populated workspace grid, focused/done/exited panes, editor open, Skills panel open, Settings open, and confirmation dialog.
