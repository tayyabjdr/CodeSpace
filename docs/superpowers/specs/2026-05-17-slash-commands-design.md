# Slash Commands — Design Spec

**Status:** In progress — design decisions captured, implementation not started yet.

## Overview

A right-side floating pill gives quick access to a `/commands` panel in CodeSpace. Users drag slash command cards from the panel onto any terminal pane; the command's prompt text is injected into that PTY. Commands are stored as markdown files in `~/.claude/commands/` — the same directory Claude CLI uses for custom slash commands — so they work across any workspace or directory.

## UI Layout

### Floating right-side pill

- Positioned at **vertical center, right edge** of the app window (inside the terminal grid area)
- Height is auto — sized to its icons only, not full-height
- Contains two icon buttons stacked vertically:
  - **`/`** — opens the slash commands popover (monospace `/`, cyan when active)
  - **file icon** — toggles the existing editor pane
- Background: `#161b22`, border: `1px solid #2b3038`, `border-radius: 12px`, subtle drop shadow
- Active icon: `rgba(103,232,249,0.08)` fill, `1px solid #67e8f9` border
- Inactive icon: transparent, `#4b5563` stroke

### Commands popover

- Opens **anchored left of the pill**, vertically centered — no layout shift, overlays the terminal grid
- Arrow pointing right toward the pill
- Width: ~200px, max-height scrollable
- Header: `/commands` label + `+ new` button + `✕` close
- Footer: dim hint showing `from ~/.claude/commands/`
- Closes on `✕`, Escape, or click-outside

### Command cards

Each card in the popover shows:
- `/name` in cyan monospace (derived from filename, e.g. `refactor.md` → `/refactor`)
- One-line description (first line of the markdown body, or frontmatter `description` field if present)
- Drag handle glyph on the right
- `cursor: grab`

A `+ new command` dashed card at the bottom opens the create form.

### Drag and drop

- Drag source MIME type: `application/x-codespace-command`
- Drop target: any `TerminalPane` (extends existing drop handler alongside `application/x-codespace-terminal` and `Files`)
- On drop: reads the full markdown file body and calls `ptyPool.writePty(ptyId, body)` — same mechanism as OS file path drops
- Drop feedback: dashed cyan border on the target pane while dragging over (same pattern as existing `drag-over` class)

### Create form

Inline in the popover (replaces the list, or expands below):
- Text input: command name (no leading slash — added automatically, filename-safe)
- Textarea: prompt body
- Save → writes `~/.claude/commands/<name>.md`, file watcher triggers reload
- Cancel → returns to list

## Data / Storage

- **Source directory:** `~/.claude/commands/` (global, same as Claude CLI)
- **File format:** plain markdown — filename = command name, file content = prompt injected on drop
  - Optional frontmatter `description:` field for the subtitle shown in the card
- **File watcher:** `chokidar` (already a transitive dep via electron-vite) watches the directory; on `add`/`change`/`unlink` sends `commands:updated` IPC event to renderer with the fresh list
- **IPC channels:**
  - `commands:list` — renderer requests initial list on mount; main reads directory and returns array of `{ name, description, filePath }`
  - `commands:create` — renderer sends `{ name, body }`; main writes file
  - `commands:updated` — main pushes to renderer when watcher fires
  - `commands:read` — renderer requests full body of a command by `filePath` (used on drop to get inject text)

## Open questions (deferred)

- Should project-level `.claude/commands/` also be surfaced, grouped separately from global?
- Edit and delete commands from within the popover (not in scope for v1)?
- Icon for the pill's slash commands button — plain `/` or a more custom glyph?
- Exact vertical position of the pill — true center, or slightly above center?

## Decisions log

| Decision | Choice | Reason |
|---|---|---|
| Panel location | Right-side floating pill | User preference; keeps left sidebar focused on workspaces |
| Pill position | Vertical center, right edge | Feels detached/palette-like; doesn't compete with toolbar or footer |
| Panel open style | Floating popover (no layout shift) | Terminals stay full-size; overlay is less disruptive |
| Storage format | `~/.claude/commands/*.md` | Reuses Claude CLI convention; portable, version-controllable, editor-agnostic |
| Apply mechanism | Text injection via `writePty` | Simplest; consistent with existing file-drop code; transparent to user |
| Scope | Global only (v1) | Available in any workspace/directory |
