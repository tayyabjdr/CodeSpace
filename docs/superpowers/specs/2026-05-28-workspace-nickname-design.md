# Workspace Nicknames

**Status:** Approved · 2026-05-28
**Scope:** Sidebar workspace items in CodeSpace

## Problem

A workspace's `name` is set once at creation (typically derived from its directory). Once you have three or four workspaces open against similar-looking paths, the sidebar list doesn't tell you *what you're working on* — only where. Users want a second, freely editable label per workspace that captures intent ("client landing redesign", "fixing onboarding bug") without renaming the underlying workspace.

## Goal

Let each workspace carry an optional **nickname** rendered as a quiet subtitle under its name in the sidebar. Edit it inline by double-clicking the nickname slot.

## Non-goals

- Renaming the workspace `name` itself. The name remains set-at-creation; this spec adds a *second* label only.
- Showing the nickname anywhere outside the sidebar (window title, tab strip, drag preview, etc.).
- Search, filter, color-coding, or grouping by nickname.

## Data model

Each workspace gains one optional field:

```js
nickname: string | null   // trimmed, ≤ 40 chars, or null
```

Persisted in `workspaces.json` alongside existing fields. Schema version stays at `2` — the field is additive and old files load cleanly with `nickname: null`.

### Sanitization

`sanitizeNickname(v)` in `src/main/workspaces-store.js`:

- Non-string input → `null`.
- Trim whitespace.
- Empty after trim → `null`.
- Else → `v.slice(0, 40)`.

Applied symmetrically in `loadWorkspaces` (on the way in) and `saveWorkspaces` (on the way out).

## Sidebar layout

Each `.sb-item` becomes a two-line vertical text stack on the left; the right column (notify dot, isolated glyph, count, delete) is unchanged.

```
┌─ row ───────────────────────────────────────────┐
│  │ workspace-name                       • 3  ×  │
│  │ nickname text (dim, smaller)                 │
└─────────────────────────────────────────────────┘
```

### Rendering rules

| State                                  | Second line |
|----------------------------------------|-------------|
| No nickname · row not hovered          | Not rendered. Row collapses to one line (matches today's resting density). |
| No nickname · row hovered              | "add nickname" hint at `--cs-text-faint`. Double-click hint to edit. |
| Has nickname                           | Nickname always visible. Double-click to edit. |
| Edit mode                              | Borderless input replaces the slot. |

### Visual spec

- **Name row:** Geist UI, ~13px, `--cs-text-primary`. Unchanged from today.
- **Nickname row:** Geist UI, ~11px, `--cs-text-dim`. Single line. Ellipsis on overflow. Full text in `title=` tooltip.
- **Hint:** same dimensions as nickname row, color `--cs-text-faint`, content `"add nickname"`.
- **Input (edit mode):** same dimensions/color as the nickname row, borderless, transparent background, `maxLength={40}`.
- **Right column** (count, dot, iso glyph, delete) aligns to the **name row** (top), not the centerline of the two-line stack. Keeps row metadata anchored to the primary title.
- Row height grows from ~28px → ~42px **only** when the second line renders.

## Interaction

- **Activation:** `onDoubleClick` on the nickname row (or the hover hint when empty) enters edit mode. Single-click on the row anywhere else continues to select the workspace.
- **Input focus:** auto-focus on open and select all existing text so retyping replaces.
- **Commit:** `Enter` or `blur`. Trim → if empty, save `null` (clears the nickname); else clamp to 40 chars and save.
- **Cancel:** `Esc`. Discard local edits, restore prior value, exit edit mode. Does **not** blur-commit.
- **Save path:** edit mode calls `onRenameNickname(ws.id, value)` exposed by `App.jsx`. The handler updates React state and triggers the existing workspace-save side effect.
- **Selection is not affected by editing.** Entering edit mode on an inactive row does *not* activate that workspace — clicking the nickname to fix a typo should never yank focus.
- **Keyboard nav passthrough:** `Sidebar.jsx`'s `handleKeyDown` (Arrow/Home/End/Enter/Space/Delete) must bail early when the row is in edit mode so the input owns the keys.

## Files touched

- `src/main/workspaces-store.js` — add `sanitizeNickname`; include `nickname` in load/save shapes.
- `src/renderer/App.jsx` — thread `nickname` through workspace state; expose `onRenameNickname(id, value)` that updates state and persists.
- `src/renderer/components/Sidebar.jsx` — restructure item markup into name + nickname rows; add per-row edit state, double-click, commit/cancel/blur handling; bail keyboard nav while editing.
- `src/renderer/components/Sidebar.css` — add `.sb-item-text`, `.sb-item-nickname`, `.sb-item-nickname-hint`, `.sb-item-nickname-input`; adjust right-column vertical alignment.

## Testing

Vitest is configured (`tests/` is currently empty). Add:

- **`tests/workspaces-store.test.js`**
  - `sanitizeNickname` table cases: `null`, `undefined`, `""`, `"   "`, `"ok"`, `" ok "`, a 41-character string → expected outputs.
  - Round-trip: `saveWorkspaces` then `loadWorkspaces` preserves a nickname.
  - Backward compatibility: parse a workspaces JSON blob with no `nickname` key → loaded shape has `nickname: null`.

UI behavior (double-click, edit/commit/cancel, hover hint, alignment) is verified manually on first run. Matches how terminal-pane rename shipped — no RTL harness exists yet and adding one is out of scope.

## Migration

- Old `workspaces.json` files load with `nickname: null` everywhere; first save writes `"nickname": null` for each workspace.
- No schema version bump.
- Quarantine-on-corrupt path is unchanged.

## Risks / open questions

- **Row height changes on hover for empty workspaces.** Causes a small layout shift when the cursor enters/exits. Accepted: hover-only hint is the cleanest resting state, and shift is small (~14px) and local to the hovered row.
- **Double-click conflict.** Today the sidebar row has no other double-click handler; safe. If a future feature wants double-click on the *name* (e.g. workspace rename), it must land on the name span specifically and not bubble.
