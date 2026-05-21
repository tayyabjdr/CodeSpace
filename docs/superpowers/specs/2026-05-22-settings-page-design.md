# Full-page settings — design

**Date:** 2026-05-22
**Status:** Approved design, ready for implementation planning

## Problem

Settings currently live in `SettingsModal.jsx` — a 540px centered modal over a
blurred backdrop, with four bordered cards (Appearance, Notifications, Updates,
Agents) stacked vertically. The modal is cramped and does not scale; a full-page
settings surface gives each group room and matches the app's shell language.

## Goal

Replace the settings modal with a **full-page settings view**: a left nav rail
of categories and a content panel showing the selected category. Same settings
as today, reorganized one-category-per-page. No new settings, no schema change.

## Decisions (from brainstorming)

- **Scope:** restyle + reorganize. The existing settings and their controls are
  unchanged; they are regrouped into per-category pages. No brand-new settings.
- **Layout:** nav rail (left) + content panel (right). Content is centered in a
  720px max-width column.
- **Title bar:** stays. Settings replaces only the body area below the 42px
  title bar, so window minimize/maximize/close and the drag region keep working.
- **Component structure:** a single `SettingsPage.jsx` owns the nav rail, the
  active-category state, and all four category panels inline (approach 1).

## Architecture

`SettingsPage` is a body-level overlay layer.

- `App.jsx` already holds `settingsOpen` state and renders the settings UI; the
  Sidebar's `onOpenSettings` callback sets `settingsOpen = true`. These are kept.
- When `settingsOpen` is true, `App.jsx` renders `<SettingsPage onClose={...} />`
  as a layer that fills everything **below the title bar**. It uses
  `position: fixed`, `top: var(--cs-toolbar-h)` (42px), `left/right/bottom: 0`,
  an opaque `--cs-bg-base` background, and a `z-index` above the workspace grid.
- The workspace grid and its `TerminalPane`s **stay mounted** underneath — they
  are covered, not unmounted. Opening/closing settings causes no PTY or xterm
  unmount/remount churn.
- The title bar (`Toolbar`) is a sibling above the overlay and is never covered,
  so window controls and the drag region keep working.

```
┌─────────────────────────────────────────────┐
│  Title bar (42px) — window controls          │  ← always visible
├──────────┬──────────────────────────────────┤
│ nav rail │  content region                  │
│ ~188px   │   close ×  (top-right)           │  ← SettingsPage overlay
│          │   ┌── 720px centered column ──┐  │
│ Settings │   │ category title            │  │
│ • Appear │   │ description               │  │
│   Notif  │   │ ┌── card ──────────────┐  │  │
│   Agents │   │ │ row · row · row      │  │  │
│   Updates│   │ └──────────────────────┘  │  │
│          │   └───────────────────────────┘  │
└──────────┴──────────────────────────────────┘
```

## Layout

### Nav rail

- Width ~188px. Background `--cs-bg-sidebar`. Right border `1px solid --cs-border`.
- A "Settings" heading at the top: 14px, weight 600, `--cs-text-primary`,
  `letter-spacing: -0.01em`. Plain text — no decorative flanking rules.
- Four nav items, each an icon + label: ~36px tall, 7px radius,
  `padding: 8px 10px`, ~2px vertical gap between items.
- Item icon: 14px, 1.6–1.7 stroke-width line SVG, `--cs-text-tertiary` at rest.
- Item label: 12.5px, `--cs-text-tertiary` at rest.
- **Hover:** background `--cs-bg-hover`.
- **Active item:** background `--cs-bg-active`; a 2px white accent bar at the
  left edge (absolutely positioned, inset ~8px top/bottom); icon and label jump
  to `--cs-text-primary`. This mirrors the workspace `Sidebar` active state
  (`DESIGN_SYSTEM.md` §4.3) — white accent, not cyan.

### Content region

- Background `--cs-bg-base`. Fills the area right of the nav rail.
- A **close ×** at the top-right (~`top: 13px; right: 13px`), 28px square, 7px
  radius, `--cs-icon-tertiary`, red-hover (`--cs-red-hover-bg` / `-fg`) —
  mirrors the onboarding `ob-close` button.
- Content is centered in a **720px max-width column** with generous top padding
  (~34–40px). The column scrolls vertically if a category ever overflows.
- Each category page renders:
  1. **Category title** — 18px, weight 600, `--cs-text-primary`.
  2. **One-line description** — 12px, `--cs-text-tertiary`.
  3. **One card** — `--cs-bg-surface`, `1px solid --cs-border`, 12px radius —
     holding that category's setting rows. Rows are separated by `1px solid
     --cs-border` hairline dividers (internal row dividers, not flanking rules).

### Setting row

The `Row` primitive (moved from the deleted `SettingsModal.jsx` into
`SettingsPage.jsx`): a flex row, label block on the left, control on the right,
`padding: 15px 17px`.

- Label: 13px, `--cs-text-primary`.
- Optional caption beneath the label: 11.5px, `--cs-text-muted`; inline `code`
  in `--cs-font-mono` with the `--cs-bg-elevated` chip treatment.
- Control area: right-aligned, holds a `Toggle`, a range slider, a button, or a
  value readout.

## Categories

Four categories, in nav order. Default selected on open: **Appearance**.

### 1. Appearance
- **Default pane font size** — range slider, 10–22px, step 1. Caption: "Applied
  to new terminal panes." Value readout in mono (e.g. `13px`).
- Description: "How terminal panes look."

### 2. Notifications
- **Done sound volume** — range slider, 0–100%. Value readout `NN%`.
- **Flash taskbar on done** — `Toggle`.
- Description: "Alerts when an agent finishes."

### 3. Agents
- **Skip permission prompts** — `Toggle`. Caption: runs `claude` with
  `--dangerously-skip-permissions`.
- **Codex — bypass approvals and sandbox** — `Toggle`. Caption: runs `codex`
  with `--dangerously-bypass-approvals-and-sandbox`.
- Description: "How agent CLIs are launched."

### 4. Updates
- **Version** — the cyan-glow version pill (leading dot + `vX.Y.Z`, mono,
  `--cs-cyan`, `text-shadow` glow) linking to the GitHub release notes; a
  "Check" button beside it. Inline status line below: `checking` /
  `downloading vX.Y.Z` / `up to date` / `couldn't check for updates` (error in
  `--cs-red`).
- **Auto-update** — `Toggle`.
- Description: "Keep CodeSpace up to date."

Each nav item has a simple 1.6–1.7 stroke line icon (concentric/aperture for
Appearance, bell for Notifications, terminal for Agents, download for Updates).

## Styling — design system application

From `DESIGN_SYSTEM.md` and the project's standing rules:

- **Surfaces:** nav rail `--cs-bg-sidebar`, content `--cs-bg-base`, cards
  `--cs-bg-surface`, code chips `--cs-bg-elevated`.
- **Borders:** `1px solid --cs-border` default; inputs `--cs-border-mid`; never
  heavier than 2px, including focus.
- **Text:** opacity-tier whites only (`--cs-text-primary` … `--cs-text-dim`).
  Never raw greys.
- **Accent restraint:** cyan (`--cs-cyan`) is used only for the range slider
  fill + glowing thumb, the version pill glow, and focus rings. The active nav
  item is **white**. Green and amber are not used on this page.
- **No flanking rules:** the "Settings" heading and category titles are plain
  text — no `— label —` decorative rules.
- **Type:** UI font for headings, labels, body; mono for the version pill,
  numeric value readouts, and caption `code`.
- **Radius:** 12px cards, 8px inputs, 6–7px nav items and buttons.
- **Motion:** the page fades/slides in on open as a one-shot ~200–300ms ease;
  switching categories does a one-shot content fade. No looping animations.

Reused styling, migrated from `SettingsModal.css` into `SettingsPage.css`
(adapted, not reinvented): the custom range slider (cyan fill via a `--fill`
CSS variable, glowing thumb), the version pill, and the bordered-button style.

## Behavior

- **Open:** the existing `Sidebar` settings trigger → `settingsOpen = true`.
- **Close:** the close × or the Escape key → `onClose()` → `settingsOpen = false`.
  The workspace grid underneath is revealed unchanged (it was never unmounted).
- **Category navigation:** clicking a nav item sets the active category — local
  `useState` in `SettingsPage`, default `'appearance'`.
- **Persistence:** unchanged. Every control reads via `getSettings()` and writes
  via `setSettings(patch)` from `settings-store.js`. `SettingsPage` calls
  `subscribe()` on mount so external setting changes stay reflected. No new
  persistence and no settings-schema change.
- **Updates:** reuses `window.electronAPI.getAppVersion()` and
  `window.electronAPI.checkForUpdates()`, with the same status states the modal
  used (`checking` / `downloading` / `up-to-date` / `error`). The version link
  uses `window.electronAPI.openExternal()`.

## Files

- **Create:** `src/renderer/components/SettingsPage.jsx` — the nav rail, the
  active-category state, the close/Esc handling, and the four category panels
  inline. Contains the `Row` primitive.
- **Create:** `src/renderer/components/SettingsPage.css`.
- **Delete:** `src/renderer/components/SettingsModal.jsx`,
  `src/renderer/components/SettingsModal.css`.
- **Modify:** `src/renderer/App.jsx` — replace the `import` and the
  `<SettingsModal open={settingsOpen} onClose={…} />` render with
  `<SettingsPage onClose={…} />`, rendered only when `settingsOpen` is true, as
  the body-covering layer.
- **Reused unchanged:** `src/renderer/components/Toggle.jsx`,
  `src/renderer/settings-store.js`.

## Testing

`tests/renderer/SettingsPage.test.jsx` (jsdom; mock `window.electronAPI` and
`settings-store`):

- Renders with the **Appearance** category active by default.
- Clicking a nav item (e.g. "Agents") switches the visible category.
- Toggling a control calls `setSettings` with the correct patch shape.
- Pressing Escape and clicking the close × each call `onClose`.

## Out of scope

- Any new settings or changes to the settings schema in `settings-store.js`.
- Unifying the toolbar `VolumeControl` with the Notifications volume setting.
- Search/filter across settings.
- Reachability of settings from anywhere other than the existing Sidebar trigger.
