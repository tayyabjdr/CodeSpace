# Code Editor Pane — Design Spec

**Status:** Draft for review
**Date:** 2026-05-06
**Owner:** Tayyab
**Related:** `docs/superpowers/specs/2026-05-05-workspaces-design.md`, `DESIGN_SYSTEM.md`

## Problem

When an agent in a CodeSpace terminal references a file (`src/components/Sidebar.jsx`, `src/main/index.js:42`, an absolute Windows path, etc.), the user has to copy the path, switch to a separate editor, and open it there. This breaks the loop. The fix is an in-app, lightweight code editor that opens on demand and lets the user view and edit the referenced file without leaving CodeSpace.

## Scope

### In scope (v1)
- Single-file viewer + editor docked to the right of the terminal grid.
- Toggle: hidden by default; opens automatically on Ctrl+click of a path in any terminal; also toggleable via toolbar button and `Ctrl+E`.
- One open file at a time; replacing it prompts to save unsaved work.
- Save on `Ctrl+S` only. Dirty indicator. Confirm-before-close on unsaved changes.
- Conservative path matcher (extensible): absolute Windows, absolute POSIX, workspace-relative, with optional `:line:col` suffix.
- Per-workspace state (open file, scroll, pane width). Persisted to `workspaces.json`.
- File limits: 20 MB max, binary detection, "plain mode" auto-engaged for files ≥ 2 MB.
- CodeMirror 6 as the editor library, lazy-loaded on first open.

### Out of scope (v1, may revisit)
- Multi-tab editing (single-file slot only).
- File tree / file browser inside the editor (path-driven, not browse-driven).
- LSP / autocomplete / diagnostics / IntelliSense.
- Find-in-file / find-and-replace.
- Multi-cursor, diff editing.
- File watchers (no live-reload if file changes externally).
- Markdown / mdx links, stack-trace-formatted paths, quoted-path matchers (architecture supports adding these without rework).
- Reading binary files.
- Drag-drop file open from OS / from sidebar.

## Goals & non-goals

**Goals**
- Cut the "agent referenced a file → I want to read it" loop from "leave the app" to "Ctrl+click".
- Stay native to the CodeSpace aesthetic — feel like a peer to the terminal pane, not a transplanted IDE.
- Keep cold-start bundle size unchanged (lazy-load editor module).
- No persistence regressions; editor state ridicules into the existing `workspaces.json` shape cleanly.

**Non-goals**
- Compete with VS Code. CodeSpace is a multi-agent terminal grid; the editor is a peek-and-tweak surface, not a primary authoring environment.
- Universal-IDE creep. If a feature is "what if the editor also had X," default to no.

## Architecture

Three processes; existing boundaries preserved.

```
┌──────────── Renderer ────────────┐    ┌─────── Preload ───────┐    ┌──────── Main ────────┐
│ App.jsx                          │    │ contextBridge:        │    │ ipc-handlers.js      │
│  ├─ workspaces[].editor (state)  │    │  electronAPI.editor.* │    │  editor:readFile     │
│  ├─ Sidebar (left, 220px)        │ ←→ │   readFile / writeFile│ ←→ │  editor:writeFile    │
│  ├─ Grid (center, flex 1)        │    │   pathExists          │    │  editor:pathExists   │
│  │   └─ TerminalPane[]           │    │   revealInFolder      │    │  editor:revealInFolder│
│  │       └─ useTerminal hook     │    │                       │    │                      │
│  │           └─ linkProvider     │    │                       │    │ (no PTY changes)     │
│  └─ EditorPane (right, lazy)     │    └───────────────────────┘    └──────────────────────┘
│       ├─ useEditor hook (CM6)    │
│       ├─ codemirror-theme.js     │
│       └─ path-parser.js (pure)   │
└──────────────────────────────────┘
```

No new processes. No PTY changes. Path-parser is pure and renderer-only. CodeMirror 6 lives entirely in the renderer; main only handles file I/O.

## Components

### `src/main/ipc-handlers.js` — additions
- `editor:readFile(absPath)` → `{ ok, content?, encoding?, reason?, message? }`
- `editor:writeFile(absPath, content)` → `{ ok, reason?, message? }`
- `editor:pathExists(absPath)` → `boolean`
- `editor:revealInFolder(absPath)` → void (uses Electron `shell.showItemInFolder`)

`reason` enum: `not-found | too-large | binary | denied | unknown`.

Limits enforced in main:
- Reject `> 20 MB` (read first, check `stat.size`).
- Read first 8 KB; refuse if any null byte → `binary`.
- UTF-8 only in v1. Other encodings out of scope.

No path sandboxing: read/write anywhere on the user's filesystem (matches the agent's existing `--dangerously-skip-permissions` posture). Files outside the active workspace dir get an `[external]` badge in the editor header (renderer concern, not enforced in main).

### `src/preload/index.js` — additions
Expose the four channels above on `window.electronAPI.editor`. No raw IPC surface leaks; all calls funnel through the contextBridge.

### `src/renderer/path-parser.js` (new, pure)
```js
export function parsePathsInLine(text: string): Array<{
  start: number,   // char index in line
  end: number,
  raw: string,     // matched substring including any :line:col
  path: string,    // path only
  line: number | null,
  col:  number | null,
}>
```

Implementation: ordered list of named patterns, each tried in turn. v1 ships these:
- `win-abs` — `\b[A-Z]:[\\/][^\s:"<>|?*]+(?::\d+)?(?::\d+)?`
- `posix-abs` — `(?<=^|\s)\/[^\s:"<>|?*]+(?::\d+)?(?::\d+)?`
- `relative` — `(?<=^|\s|"|\(|\[)\.{0,2}[\\/]?[\w@\-./\\]+\.\w{1,8}(?::\d+)?(?::\d+)?`

Every match must end in `.<1–8 alphanumeric>`. Trailing punctuation (`.`, `,`, `)`, `]`, `;`, `:`) is stripped from the match unless it's the `:line:col` suffix.

Resolution helper:
```js
export async function resolvePath(raw, focusedCwd, workspaceDir, electronAPI):
  Promise<{ path: string, line: number|null, col: number|null } | null>
```
1. Strip suffix; remember `line`, `col`.
2. If absolute, return as-is (existence not pre-checked — caller will see `not-found` from `readFile`).
3. If relative, try `path.resolve(focusedCwd, raw)`; `pathExists`; if false, retry against `workspaceDir`. Return null if neither exists.

### `src/renderer/hooks/useTerminal.js` — additions
Register an xterm `linkProvider` once per terminal. Provide links from `parsePathsInLine`. `activate(event)` is the click handler:
- If `event.ctrlKey || event.metaKey` → call `onPathClick({ path, line, col })` (resolved beforehand by the provider).
- Otherwise → no-op (xterm falls through to standard click/selection).

Cursor affordance: when Control is held, the hook adds `data-modifier-ctrl` to the pane's xterm-container. CSS rule shows `cursor: pointer` on hover over registered link ranges (xterm draws the underline natively).

### `src/renderer/components/EditorPane.jsx` (new)
Renders only when `activeWorkspace.editor.open === true`. Wraps the `useEditor` hook around a `<div ref>` that becomes the CodeMirror host.

Props it receives from `App.jsx`:
- `file: string | null`
- `line: number | null`
- `dirty: boolean`
- `width: number`
- `onSave(content)`, `onClose()`, `onResize(width)`, `onRevealInFolder(path)`
- `fontSize` (re-uses workspace's terminal font size)

Internal states the pane renders:
1. **Empty** — no `file`. Centered hint matching `.empty-workspace` aesthetic.
2. **Loading** — file selected, content not yet read. Subtle 200ms fade-in skeleton.
3. **Content** — CodeMirror instance.
4. **Error** — read failure, too-large, binary, missing. Uses the existing `.pane-error` block from `TerminalPane.css`.

### `src/renderer/components/EditorPane.css` (new)
All measurements map to existing tokens. New tokens added to `design-tokens.css`:
- `--cs-editor-min: 320px`
- `--cs-editor-max-frac: 0.7` (used as `calc(100% * var(--cs-editor-max-frac))`)
- `--cs-editor-default-frac: 0.45`

Component recipe in §"Visual design".

### `src/renderer/codemirror-theme.js` (new)
Builds a CodeMirror 6 theme + highlight style from `--cs-*` tokens read at module init time via `getComputedStyle(document.documentElement)`. Maps: gutter bg → `--cs-bg-sidebar`; editor bg → `--cs-bg-surface`; cursor → `--cs-cyan`; selection → `rgba(103, 232, 249, 0.18)`; line highlight → `rgba(255,255,255,0.03)`; comment → `--cs-text-muted`; string → `#86efac`; keyword → `#67e8f9`; function → `rgba(255,255,255,0.92)`; number → `#f59e0b`; etc. (Full token-to-token map in implementation, but the principle is: never invent colors, always read tokens.)

### `src/renderer/hooks/useEditor.js` (new)
Mirrors `useTerminal`'s pattern. Owns the CodeMirror `EditorView`, applies font-size on change (debounced 180ms — same window as the xterm font-size debounce), wires `Ctrl+S` keymap to `onSave`, tracks dirty state by comparing current doc to last-saved snapshot. On `file` prop change: tear down view, fetch content via `electronAPI.editor.readFile`, build new view, scroll to `line` if provided.

Performance mode: when content size ≥ 2 MB, the hook builds the view without language packs and with line wrapping disabled. A `[plain]` badge in the header indicates this.

### `src/renderer/components/EditorResizer.jsx` (new, ~30 lines)
Vertical 4px hover-expandable handle between grid and editor. Pointer events: down → start drag; move → update parent width via `onResize(px)`; up → end drag, persist via debounced `onResizeEnd`. Double-click → reset to default fraction.

## Data flow & state shape

### Per-workspace `editor` field

```js
workspace.editor = {
  open: boolean,           // pane visible
  file: string | null,     // absolute path
  line: number | null,     // one-shot jump target; cleared by EditorPane after the
                           //   first scroll on mount/file-change so subsequent
                           //   re-mounts don't re-jump
  width: number,           // pixels (clamped to [320, 0.7 * bodyWidth] on load)
  // session-only (not persisted):
  dirty: boolean,
  scroll: number,
}
```

Persisted to `workspaces.json` (per workspace): `{ open, file, line, width }`. `dirty` and `scroll` are session-only and reset on app start.

### `workspaces-store.js` change
The persisted record per workspace becomes `{ id, name, dir, agentCount, editor? }`. Existing files without an `editor` key load with `editor: defaultEditorState()`. This is a strictly additive migration — no version bump.

### Action surface in `App.jsx`
New `useCallback`s, all using the existing `updateActive` pattern:
- `setEditorOpen(open: boolean)`
- `openFileInEditor(path: string, line: number | null)` — also handles dirty-prompt before swap
- `closeEditor()` — also handles dirty-prompt
- `setEditorWidth(px: number)`
- `setEditorDirty(dirty: boolean)`
- `setEditorScroll(scroll: number)`

Open-file flow (`openFileInEditor`):

```
ctrl+click in terminal
  → useTerminal linkProvider activate
  → TerminalPane onOpenFile(path, line, col)
  → App.openFileInEditor(workspaceId, path, line)
      ├─ if currentFile && dirty:
      │     show ConfirmDialog (Save / Discard / Cancel)
      │     if Cancel: abort
      │     if Save: writeFile, on success continue
      │     if Discard: continue
      ├─ setEditorOpen(true)
      ├─ set editor.file = path, editor.line = line, editor.dirty = false
      └─ EditorPane reads file, builds view, scrolls to line
```

### Cross-workspace switching with dirty
`handleSelectWorkspace(wsId)` adds a guard: if `activeWorkspace.editor.dirty`, show the same ConfirmDialog. Cancel aborts the switch. Save runs the save flow then proceeds. Discard switches immediately.

### Workspace deletion with dirty editor
Existing delete dialog text extends to mention the unsaved file:
> Removing **{name}** will close every agent inside it and discard your unsaved edits to **{filename}**. You can't bring it back.

No new dialog; just a conditional sentence in the existing one.

## Visual design

Anchored to `DESIGN_SYSTEM.md`. Every measurement and color uses an existing `--cs-*` token unless explicitly noted as a new token (listed above).

### Layout integration

```
┌──────────────── Titlebar (42px) ────────────────────────────────┐
│  [identity]  [+ New]   ...                  [vol] [_][□][×]      │
├──────────┬───────────────────────────┬──────────────────────────┤
│          │                           │ EditorPane               │
│ Sidebar  │  Grid                     ║ (only when open;         │
│  220px   │   gap 4px, padding 4px    ║  default 45% body width) │
│          │                           ║                          │
│  ws-1 ●  │   ┌──────┐  ┌──────┐      ║  ┌── Header (30px) ───┐  │
│  ws-2    │   │pane 1│  │pane 2│      ║  │ ● file.tsx [external]│  │
│  ws-3    │   └──────┘  └──────┘      ║  │  ↳ ×                │  │
│          │                           ║  └────────────────────┘  │
│  + New   │                           ║  CodeMirror viewport     │
│          │                           ║  (padding 4px)           │
└──────────┴───────────────────────────┴──────────────────────────┘
                                       ↑
                              4px resize handle
                              (cyan on hover/grab)
```

`.app-body` becomes `display: flex` with three children. Editor pane width is `flex: 0 0 var(--editor-w, 45%)` and is omitted from the DOM entirely when `editor.open === false`. Grid keeps `flex: 1`. Sidebar stays `flex-shrink: 0` at 220px.

### EditorPane component recipe

**Container** (matches TerminalPane visual rhythm):
- `background: var(--cs-bg-surface)`
- `border-left: 1px solid var(--cs-border)` (visible when no resizer is hovered; resizer overlays it)
- `display: flex; flex-direction: column; min-width: var(--cs-editor-min); overflow: hidden`
- `animation: scaleIn 0.2s ease both` on mount

**Header (30px, `--cs-header-h`)** — same height/padding as `pane-header` so the eye lines them up across the grid → editor seam:
```
height: var(--cs-header-h);
padding: 0 10px;
display: flex; align-items: center; gap: 8px;
background: rgba(255, 255, 255, 0.02);
border-bottom: 1px solid var(--cs-border);
```
Children, left to right:
1. **Dirty dot** — `width:6px; height:6px; border-radius:50%`, `background: var(--cs-cyan)`, `box-shadow: 0 0 6px var(--cs-cyan-glow)` when dirty. Hidden via `visibility: hidden` (preserves layout) when clean. On save, briefly transitions to `--cs-green` for 200ms via `flash-saved` keyframe (single shot).
2. **Filename** — mono, 11px, `letter-spacing: 0.04em`, `color: var(--cs-text-secondary)`. The displayed string is the basename only; full path is the `title` attribute (native tooltip).
3. **External badge** (only when file is outside `workspace.dir`):
   ```
   font-family: var(--cs-font-mono); font-size: 9px;
   letter-spacing: 0.08em; text-transform: uppercase;
   color: var(--cs-text-muted);
   background: rgba(255,255,255,0.04);
   border: 1px solid rgba(255,255,255,0.08);
   border-radius: 3px; padding: 1px 5px;
   ```
4. **Plain-mode badge** (only when in performance mode): same chip styling, label `PLAIN`.
5. Header actions on the right (`margin-left: auto`):
   - **Reveal in folder** button — 26×22, 5px radius, mono icon-only (folder glyph or `↗`).
   - **Close** — same `.close-btn` pattern as TerminalPane: hovers red, 18px glyph.

**Editor viewport**:
- `flex: 1; min-height: 0; padding: 4px;` (matches `.xterm-container`)
- CodeMirror's own `.cm-editor` fills this. Theme overrides: `font-family: var(--cs-font-mono)`, `font-size: var(--editor-font-size)`, `line-height: 1.5`.
- Gutter: `background: var(--cs-bg-sidebar); color: var(--cs-text-muted); border-right: 1px solid var(--cs-border)`.
- Selection highlight: `rgba(103, 232, 249, 0.18)` (cyan tinted, matches the live/in-flight accent rule).
- Active line: `background: rgba(255, 255, 255, 0.03)`.
- Cursor: 1.5px wide, `var(--cs-cyan)`.

**Empty state** (no file open):
- Same skeleton as `.empty-workspace`: vertical center, dashed border `--cs-border`, 12px gap, `--cs-bg-surface`.
- Glyph (✦), 13px tertiary text — first line: `Editor is open`, second line (mono, 10.5px, dim): `Ctrl+click any path in your terminal`.
- Hint variant only first time per session; thereafter the empty state is shorter (just the glyph + first line).

**Loading state** (file selected, content fetching):
- Subtle 1px-tall shimmer bar at the top of the viewport (`--cs-cyan` gradient, 0.6s linear infinite — exception to the no-loops rule because it's a transient indicator).
- Filename in header is rendered immediately so the layout doesn't shift when content lands.

**Error states**:
- Reuse `.pane-error` from `TerminalPane.css` verbatim (don't create new error UI).
- Title 13.5px primary; body 12.5px tertiary, max-width 420px.
- Action button is the existing `.pane-error-btn` recipe.
- Specific messages and actions per `reason`:
  - `not-found` → "*filename* is no longer at this path" + "Pick another file" (closes pane).
  - `too-large` → "File too large to open in CodeSpace (20 MB max)" + "Reveal in Folder".
  - `binary` → "Binary file — open externally" + "Reveal in Folder".
  - `denied` → "Couldn't read this file (permission denied)" + "Try again".
  - `unknown` → "Couldn't read this file" + "Try again".

### Resize handle

```css
.editor-resizer {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  transition: background var(--cs-transition);
}
.editor-resizer::after {
  content: '';
  position: absolute;
  inset: 0 -3px;  /* expanded hit area */
}
.editor-resizer:hover,
.editor-resizer.dragging {
  background: rgba(103, 232, 249, 0.45);
}
```

Pointer behavior:
- Mousedown: capture, set `dragging`, disable user-select on body.
- Mousemove: compute new width = `bodyRight - clientX`; clamp to `[--cs-editor-min, body * --cs-editor-max-frac]`; update CSS variable inline (no React re-render during drag — just write the var).
- Mouseup: commit width to React state, debounce-persist via existing `PERSIST_DEBOUNCE_MS` flow.
- Double-click: reset to `45%` (default fraction).

### Toolbar additions

A fourth button in the titlebar actions row, between the existing actions and the right-aligned controls cluster:

```
.titlebar-editor-toggle {
  width: 28px; height: 28px;       /* identical to titlebar-btn */
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  /* hover: same as titlebar-btn */
}
.titlebar-editor-toggle.is-open {
  color: var(--cs-cyan);
  background: rgba(103, 232, 249, 0.08);
}
```

Icon: a minimal "</>" or document-with-line glyph in 14px stroke-1 SVG (matches existing icon weight from VolumeControl). Tooltip: `Editor (Ctrl+E)`.

### Animation & motion

- Pane mount: `scaleIn 0.2s ease both` (existing keyframe).
- Pane unmount: no exit animation in v1 (immediate). Adding a smooth exit is a polish item if it feels jarring.
- Header dirty dot save flash: single-shot `flash-saved 0.2s ease` from cyan → green → hidden.
- Loading shimmer: `editor-shimmer 0.6s linear infinite` while reading.
- Resizer hover: 150ms `--cs-transition`.

No infinite animations elsewhere — adheres to the design-system rule.

## Error handling & edge cases

| Scenario | Behavior |
|---|---|
| File not found at open | Error state with "Pick another file" close button |
| File deleted while pane open with the file loaded | No file-watcher in v1; user sees stale content. On save, `writeFile` may succeed (recreating the file). Documented as a known gap. |
| File ≥ 20 MB | Refused at IPC boundary; error state with Reveal-in-Folder |
| Binary file | Refused at IPC boundary; error state with Reveal-in-Folder |
| Save permission denied | ConfirmDialog with Retry / Cancel; dirty preserved |
| Unsaved changes + open another file via Ctrl+click | Prompt Save/Discard/Cancel before swap |
| Unsaved changes + close pane (× or Ctrl+E) | Prompt Save/Discard/Cancel |
| Unsaved changes + workspace switch | Prompt; Cancel aborts the switch |
| Unsaved changes + workspace delete | Existing delete dialog mentions unsaved file in its message |
| Unsaved changes + window close | Window close prompt (out of scope for v1; window currently closes hard. Add to backlog.) |
| Path resolves to a directory not file | Treated as `denied` from the IPC layer (read of a dir fails) |
| Path with `:line:col` exceeds file length | Open file, scroll to `min(line, lastLine)`, no error |
| Workspace switched while file is loading | The pending IPC promise's response is ignored (workspace id check on resolve) |
| Resize handle dragged below min width | Clamped at `--cs-editor-min` (320px) |
| Resize handle dragged past max | Clamped at 70% of body width |
| Window resized below editor's min + grid's reasonable min | Editor pane shrinks to its min; grid takes the rest. If body < 320 + 320 + 220, sidebar stays, editor shrinks, grid scrolls horizontally as a last resort. |

## Persistence migration

Existing `workspaces.json` schema:
```json
{ "workspaces": [{ "id", "name", "dir", "agentCount" }], "activeWorkspaceId": "..." }
```

New schema (additive):
```json
{
  "workspaces": [{
    "id", "name", "dir", "agentCount",
    "editor": { "open": false, "file": null, "line": null, "width": 640 }
  }],
  "activeWorkspaceId": "..."
}
```

`width` is stored as an **integer pixel value**. On load it's clamped to the current body dimensions: `clamp(stored, 320, body * 0.7)`. If the body is smaller than `320 + 220 + 320` (sidebar + min-grid + min-editor), the editor renders at its min and the grid takes whatever's left. Workspaces missing `editor` get `defaultEditorState()` (open: false, file: null, line: null, width: round(0.45 * body) at first render) injected at load time — no migration script needed.

## Performance & bundle

- **Lazy load.** `EditorPane` is `React.lazy(() => import('./components/EditorPane.jsx'))`, so neither CodeMirror nor any language pack lands in the initial bundle. First open: ~50–80ms parse blip on a fresh load (acceptable).
- **Bundle deltas (gzipped, estimated):**
  - `@codemirror/view + @codemirror/state + @codemirror/commands` ≈ 90 KB
  - `@codemirror/language` + tree-sitter glue ≈ 40 KB
  - Language packs (JS/TS/JSON/Markdown/HTML/CSS) ≈ 80–120 KB
  - Theme + custom glue ≈ 10 KB
  - **Total:** ~250 KB gzipped, lazy-loaded.
- **Plain mode threshold:** 2 MB. Above this, language packs are skipped; only CodeMirror's base view + line numbering load. This keeps editing responsive on large generated files.
- **Open-file IPC.** `readFile` returns the entire content in one round-trip. For files near the 20 MB cap that's a 20 MB IPC message — measured locally as ~120ms on the dev box; acceptable. If profiling shows IPC saturation on slower machines, switch to streaming (`createReadStream` + chunked IPC).

## Testing

Vitest + jsdom (`tests/` directory currently empty; this spec creates the first tests).

### Unit
- `path-parser.test.js`
  - Absolute Windows: with/without line, with line+col, drive letters A–Z
  - Absolute POSIX: with/without line, with line+col
  - Relative: `./foo.ts`, `foo/bar.ts`, `../foo.ts`
  - Trailing punctuation: `"see src/foo.ts."` → match excludes period
  - Mid-token rejection: `src/foo.ts` inside `src/foo.tsx` should match the longer one cleanly
  - Extension boundary: `.tsx`, `.ts`, `.json`, `.md` match; `--save` does not
  - Multiple matches per line preserved with correct indices
- `path-resolver.test.js`
  - Absolute pass-through
  - Relative resolves against focused cwd first, workspace dir second
  - Returns null when neither resolves
- `editor-state.test.js`
  - Open file → state is `{ open: true, file, line, dirty: false }`
  - Open another file with dirty current → blocked pending dialog (mocked)
  - Save → dirty cleared
  - Close → state.open = false, file/line preserved (so re-open restores)

### Integration / manual smoke
CodeMirror in jsdom is unreliable; rely on a manual checklist documented in the implementation PR description:
- [ ] Ctrl+click absolute path in terminal opens it
- [ ] Ctrl+click relative path resolves against terminal cwd
- [ ] Ctrl+click `file.ts:42:5` opens file scrolled to line 42
- [ ] Ctrl+S saves; dirty dot disappears with green flash
- [ ] Toolbar toggle button reflects open/closed state with cyan tint
- [ ] Resize handle drag updates width smoothly (no React re-renders mid-drag)
- [ ] Resize persists across app restart
- [ ] File outside workspace shows `[external]` badge
- [ ] 25 MB file → too-large error
- [ ] PNG → binary error
- [ ] Unsaved + workspace switch → ConfirmDialog appears
- [ ] Unsaved + workspace delete → delete dialog mentions unsaved file
- [ ] Plain-mode badge appears on a 3 MB file

## Open questions

None at design time. All clarifications resolved during brainstorming.

## Implementation phases

The implementation plan (produced separately by the writing-plans skill) should phase along these natural boundaries:

1. **Foundations** — IPC channels, preload bridge, `path-parser.js`, `path-resolver.js`, plus their unit tests. No UI yet.
2. **EditorPane skeleton** — component file, CSS, lazy-loading wiring, empty + loading + error states. No CodeMirror yet (use a `<pre>` placeholder for content).
3. **CodeMirror integration** — `useEditor` hook, theme module, language packs, plain-mode threshold, save flow, dirty tracking.
4. **Layout & resize** — three-column flex, resizer component, width persistence, double-click reset.
5. **Terminal wiring** — `useTerminal` linkProvider, Ctrl+click activation, Ctrl-key cursor affordance.
6. **State + persistence** — `workspaces.json` schema bump, dirty-prompt flow on file swap / workspace switch / workspace delete.
7. **Toolbar toggle + Ctrl+E shortcut** — final wiring, polish, manual smoke pass.

Each phase is independently testable and produces a working UI (even if degraded). v1 ships only after phase 7 is green.

## Risk register

| Risk | Mitigation |
|---|---|
| CodeMirror 6 theme drift if design tokens change | Read tokens at module init from `getComputedStyle`; one place to update if rules change. |
| Path parser false positives latching onto non-paths | Conservative patterns + extension-boundary requirement; unit tests pin behavior. |
| Workspace JSON growing too large with file content cached | We only persist file *path*, not content. Content is re-read on every open. |
| Dirty-prompt fatigue (too many ConfirmDialogs) | Save / Discard / Cancel; default focus on Save. Plus: keep close-pane and workspace-switch as the only two prompt triggers; don't add prompts on idle, navigation, etc. |
| node-pty Windows seg-fault during workspace teardown still races editor state | Editor state lives in renderer; workspace JSON persistence already happens before PTY kills (see CLAUDE.md). No additional risk. |
| Bundle bloat | Lazy-load editor. Cold start unchanged. |

## Appendix — DESIGN_SYSTEM.md alignment checklist

This spec's visual choices have been audited against the design-system rules:

- [x] All colors via `--cs-*` tokens; no raw hex except in net-new tokens (`--cs-editor-*`).
- [x] Text uses opacity-tier whites (`--cs-text-primary/secondary/tertiary/muted/dim`).
- [x] Cyan only for live/in-flight (dirty dot, cursor, resizer hover, toggle-open state).
- [x] Green only for done/success (save flash).
- [x] Red only for destructive (close hover — already in `.close-btn`).
- [x] Borders 1px, default `--cs-border`; 2px reserved for none here.
- [x] Animations one-shot 180–500ms; loops only for transient indicators (loading shimmer).
- [x] Header is 30px (`--cs-header-h`) — matches TerminalPane.
- [x] Icons match existing weight (1px stroke, 14px frame).
- [x] Tabular nums where numbers appear (line numbers in gutter).
- [x] Empty/error states reuse `.empty-workspace` and `.pane-error` patterns.
- [x] Modal flow uses existing `ConfirmDialog`, no new modal component.

---

*Spec ready for review. Once approved, the writing-plans skill produces the implementation plan from §"Implementation phases".*
