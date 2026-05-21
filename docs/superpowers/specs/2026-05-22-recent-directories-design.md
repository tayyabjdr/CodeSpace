# Recent directories on the onboarding screen — design

**Date:** 2026-05-22
**Status:** Approved design, ready for implementation planning

## Problem

The onboarding screen (`src/renderer/components/Onboarding.jsx`) is where the user
picks a project directory for a new workspace. The only way to choose a directory
is the OS Browse dialog — every time, even for folders used repeatedly. There is no
memory of directories the user has worked in. Once a workspace is deleted its
directory is gone from the app entirely.

## Goal

Add a "Recent" section to the onboarding screen listing directories the user has
recently used, so a returning directory is one click away instead of a dialog walk.

## Decisions (from brainstorming)

- **Source — both:** a directory is remembered when it is selected via the Browse
  dialog *and* when a workspace is initialized with it.
- **Placement:** in the existing left column, directly under the Project directory
  field, as a 2-column grid of cards (brainstorming option B, refined).
- **Click action:** clicking a recent card fills the Project directory field only.
  The workspace name auto-fills from the folder via existing logic; agent count and
  isolation stay at their defaults. It is a path shortcut, not a workspace restore.
- **List size:** 6 entries, most-recently-used first. Adding a 7th drops the oldest.
- **Removal:** each card has a hover-revealed "×" to drop that entry.
- **Storage:** a dedicated main-process store + `recents.json`, mirroring the
  existing `workspaces-store.js` / `settings-store.js` pattern (approach 1).

## Architecture

Three processes, following the app's existing split:

```
main: recent-dirs-store.js  ──>  recents.json (userData)
        │  loadRecents / addRecent / removeRecent
        ▼
main: index.js  ──>  IPC: recents:get / recents:add / recents:remove
        ▼
preload: index.js  ──>  electronAPI.recents.{ get, add, remove }
        ▼
renderer: Onboarding.jsx  ──owns recents state──>  RecentDirectories.jsx
```

## Data model

`recents.json`, written to Electron's `app.getPath('userData')` directory:

```json
{
  "version": 1,
  "dirs": ["D:\\Projects\\CodeSpace", "C:\\Users\\TJ\\Desktop\\Socials"]
}
```

`dirs` is an MRU-ordered array of absolute path strings, newest first, capped at 6.

## Main process — `src/main/recent-dirs-store.js` (new)

Mirrors `workspaces-store.js`: atomic `tmp`+`rename` writes, corrupt-file
quarantine (rename to `.corrupt-<timestamp>`), empty-array fallback on any error.

Constants: `FILENAME = 'recents.json'`, `SCHEMA_VERSION = 1`, `MAX_RECENTS = 6`.

### Pure helpers (no `fs` — unit-testable)

- **`normalizePath(p)`** — returns a comparison key: lower-cased, trailing
  `\`/`/` separators stripped. Used only for matching; the original-cased string
  is what gets stored and displayed.
- **`mergeRecent(list, dir, max)`** — returns a new array: removes any entry whose
  `normalizePath` equals `dir`'s, unshifts `dir` (original casing) to the front,
  truncates to `max`. This is the dedup + MRU + cap logic in one pure function.

### Exported functions

- **`loadRecents()`** — reads and parses `recents.json`.
  - ENOENT → returns `[]`.
  - Parse error or non-conforming shape → quarantine the file, return `[]`.
  - Validates `dirs` is an array; keeps only string entries.
  - **Prunes entries whose directory no longer exists** (`fs.stat` each path). If
    any entry was pruned, rewrites the file with the pruned list.
  - Returns the (possibly pruned) array.
- **`addRecent(dir)`** — ignores empty/non-string input. Computes
  `mergeRecent(current, dir, MAX_RECENTS)`, saves, returns the new list.
- **`removeRecent(dir)`** — drops the `normalizePath`-matching entry, saves,
  returns the new list.

`saveRecents(dirs)` is the internal atomic writer used by the three above.

## IPC — `src/main/index.js`

Registered next to the existing `workspaces:load` / `workspaces:save` handlers
(inside `createWindow`, ~line 128):

| Channel | Args | Returns |
|---|---|---|
| `recents:get` | — | `string[]` |
| `recents:add` | `dir: string` | `string[]` (new list) |
| `recents:remove` | `dir: string` | `string[]` (new list) |

All three are `ipcMain.handle` (invoke/promise) so the renderer gets the updated
list back and never has to guess.

## Preload — `src/preload/index.js`

New namespace on the `electronAPI` bridge:

```js
recents: {
  get:    ()    => ipcRenderer.invoke('recents:get'),
  add:    (dir) => ipcRenderer.invoke('recents:add', dir),
  remove: (dir) => ipcRenderer.invoke('recents:remove', dir),
},
```

## Renderer — `src/renderer/components/RecentDirectories.jsx` (new)

A small presentational component. It holds no persistence logic of its own.

**Props:**
- `recents: string[]` — paths, MRU order.
- `currentDir: string` — the currently selected project directory.
- `onPick(dir)` — called when a card is clicked.
- `onRemove(dir)` — called when a card's "×" is clicked.

**Render:**
- Returns `null` when `recents` is empty — first-run users see the onboarding
  screen exactly as it is today, no empty section.
- Otherwise an `ob-field` with a "Recent" label and a 2-column card grid.
- Each card: a folder icon, the directory basename (bright text) and the full path
  (dim text) — the same visual hierarchy as the existing `ob-dir-display`.
- Clicking anywhere on a card calls `onPick(dir)`.
- A hover-revealed "×" calls `onRemove(dir)` with `stopPropagation()` so removal
  does not also trigger a pick.
- The card whose path matches `currentDir` (case-insensitive) gets an `active`
  class — a cyan border. This is the only accent-color use in the section.

## Renderer — `Onboarding.jsx` changes

`Onboarding` owns the `recents` list state; `RecentDirectories` is presentational.

- New state `const [recents, setRecents] = useState([])`.
- On mount: `window.electronAPI.recents.get().then(setRecents)` (guarded against
  unmount, matching the existing `availability` effect pattern).
- `handleBrowse` — after `selectDirectory()` returns a non-null `dir`:
  `setProjectDir(dir)`, then `recents.add(dir).then(setRecents)`.
- `handleLaunch` — when initializing, call `recents.add(projectDir)` (fire and
  forget; the fresh list is picked up on the next onboarding mount).
- `onPick` handler — `setProjectDir(dir)`. The existing folder-name auto-fill
  effect then updates the workspace name, exactly as a Browse selection does.
- `onRemove` handler — `recents.remove(path).then(setRecents)`.
- Render `<RecentDirectories recents={recents} currentDir={projectDir}
  onPick={...} onRemove={...} />` in the left column `<section>`, immediately
  after the Project directory `ob-field`.

The component is rendered the same way in standalone and embedded (sidebar
"add workspace") onboarding — it is the same `Onboarding` component in both modes.

## Behavior summary

- A directory is recorded on **Browse-dialog selection** and on **Initialize**.
- The default Desktop path that pre-fills the field on first load is **not**
  recorded — it is not a deliberate user choice. Only explicit Browse selections
  and initializations are recorded.
- Re-using a directory moves it to the front (MRU); duplicates collapse
  case-insensitively (Windows paths).
- The list is loaded once per `Onboarding` mount. Within a single mount, the
  Browse and remove paths update local state from the IPC return value; there is
  no cross-component live refresh, which is not needed.
- A recent directory deleted from disk between sessions is pruned silently on the
  next `loadRecents()`.

## Styling

New classes in `src/renderer/components/Onboarding.css`, built only from the
`--cs-*` design tokens:

- `ob-recent-grid` — `display: grid; grid-template-columns: 1fr 1fr; gap`.
- `ob-recent-card` — surface, border, radius, padding consistent with
  `ob-dir-display`; hover lift on border/background.
- `ob-recent-card.active` — cyan border (`--cs-cyan`), the section's only accent.
- `ob-recent-name` / `ob-recent-path` — bright and dim text tiers.
- `ob-recent-remove` — the "×", hidden until card hover.

Text uses opacity-tier whites throughout; cyan/green are not used anywhere except
the single `active` card border. Any hover transition is a one-shot 200–500ms
ease, consistent with the existing onboarding motion.

## Testing

`tests/recent-dirs-store.test.js` (new — first test in the currently-empty
`tests/` directory) covering the pure `mergeRecent` helper:

- adds a new directory to the front of the list;
- re-adding an existing directory moves it to the front without duplicating;
- case-insensitive / trailing-separator variants collapse to one entry;
- the list is capped at the `max` argument, dropping the oldest entry;
- an empty starting list and a single-add behave correctly.

`mergeRecent` and `normalizePath` are pure and take no `fs` dependency, so they
test without Electron or filesystem mocking.

## Out of scope

- Restoring agent count / isolation from a previous workspace (click fills the
  path only).
- Pinning or manually reordering entries.
- Searching or filtering the recent list.
- Surfacing recents anywhere other than the onboarding screen.
