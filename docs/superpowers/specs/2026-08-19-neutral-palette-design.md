# CodeSpace Neutral Palette and Sidebar Nav — Design

**Date:** 2026-08-19
**Status:** Approved, ready for implementation planning
**Branch:** continues `feat/shell-redesign` (second pass on top of the shell redesign's 15 commits)
**Predecessor spec:** `docs/superpowers/specs/2026-08-19-shell-redesign-design.md`
**Reference:** BridgeMind product screenshot supplied in chat (structure and colour inspiration only — no assets, branding, or naming copied)

## Summary

A second design pass over the shell redesign. Five changes:

1. **`sarvis-dark` is retuned to neutral**, using colours sampled directly from the reference screenshot. The blue tint goes; the lightness ladder barely moves.
2. **Accents become state-only.** Colour survives where it encodes something the user must notice; roughly sixty decorative usages become white-opacity tiers.
3. **Four semantic state tokens** replace colour-named tokens at the sites that encode state.
4. **Every divider line is removed** — seventeen of them, across eight stylesheets. Separation moves to background steps.
5. **The right toolbar is deleted**; a `Skills` nav row in the sidebar takes over its one working job.

This pass explicitly reverses the predecessor spec's "no palette changes" constraint. That constraint was correct for the structural work and is now retired.

## Sampled reference values

Colours were sampled from the screenshot programmatically (median of a 7×7 patch per point, to avoid glyph and antialias pixels) rather than estimated by eye. Every surface returned an RGB spread of zero — the reference is **pure neutral grey**, not a desaturated blue.

| Point | Sampled |
| --- | --- |
| Titlebar / canvas | `#0a0a0a` |
| Sidebar | `#151515` |
| Pane body | `#141414` |
| Pane header | `#1f1f1f` |
| Active sidebar row | `#2c2c2c` |

A horizontal scan across the sidebar/canvas boundary found a raised edge in the reference (`#151515` → `#1a1a1a` → `#212121` → `#0a0a0a`). **We are deliberately not reproducing it**, per the instruction to remove all dividers. If the boundary reads as mushy once built, this is the first thing to reinstate.

## 1. Palette retune

Ten values change in the `:root` block of `src/renderer/design-tokens.css`. The `[data-theme='bridge']` block is **not** retuned — Bridge keeps its warm plum identity.

| Token | Current | New | Role |
| --- | --- | --- | --- |
| `--cs-bg-base` | `#0a0b0d` | `#0a0a0a` | canvas, titlebar |
| `--cs-bg-surface` | `#0d0f12` | `#141414` | pane body, cards |
| `--cs-bg-elevated` | `#11151b` | `#1f1f1f` | pane header, breadcrumb, popovers |
| `--cs-bg-sidebar` | `#0a0c0f` | `#151515` | left rail |
| `--cs-bg-active` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.10)` | selected row fill |
| `--cs-border` | `#1b1e24` | `#232323` | card outlines |
| `--cs-border-mid` | `#262a32` | `#2c2c2c` | pane outline |
| `--cs-border-hover` | `#2b3038` | `#383838` | hover outline |
| `--cs-term-bg` | `#0d0f12` | `#141414` | xterm background |

### The sidebar inversion

`--cs-bg-sidebar` currently sits *darker* than `--cs-bg-base`; in the reference it is *lighter*. This is a real perceptual change, not a value tweak — the rail stops receding and starts reading as a raised panel. Implementers should expect the sidebar to look wrong at intermediate stages if only some of these values have landed.

### The seam, confirmed

The predecessor spec kept a deliberate step between the pane's chrome bands (`--cs-bg-elevated`) and the terminal body (`--cs-term-bg`), reasoning that the terminal should read as a screen inset into the card. The reference has exactly this: pane body `#141414`, pane header `#1f1f1f`. What was a judgment call is now a match. `--cs-term-bg` tracks `--cs-bg-surface` at `#141414`; the step is preserved.

## 2. Semantic state tokens

Four tokens are added, declared in **both** theme blocks:

| Token | `:root` (sarvis-dark) | `[data-theme='bridge']` |
| --- | --- | --- |
| `--cs-state-running` | `#86efac` | `#7acb85` |
| `--cs-state-done` | `#67e8f9` | `#e15a9e` |
| `--cs-state-exited` | `#f59e0b` | `#dda04c` |
| `--cs-state-isolated` | `#67e8f9` | `#e15a9e` |

These are aliases of the existing accent values, not new colours — Bridge's appearance does not change.

Sites that encode state migrate to them: session-row dots, the workspace aggregate dot, pane status dots, the exited-pane border, the done pulse and tick, and the isolated-workspace badge gradient. Colour-named tokens (`--cs-cyan`, `--cs-green`, `--cs-amber`) survive only as the values behind these aliases and in the xterm palette.

### Exclusion: the xterm ANSI palette

`src/renderer/terminal-theme.js` reads `--cs-term-red`, `--cs-term-green`, `--cs-term-yellow` and the rest to build xterm's colour table. **These are content, not chrome** — they are the colours the user's agents print. They are excluded from accent demotion entirely. Desaturating them would make terminal output unreadable, which is the opposite of the goal.

The same applies to `src/renderer/codemirror-theme.js` syntax colours.

## 3. Accent demotion

Roughly sixty of the eighty-three `--cs-cyan*` / `--cs-green*` usages in renderer CSS are decorative rather than stateful, and move to white-opacity tiers. Categories:

- hover glows and focus fills on buttons, toggles, and the empty-state action
- tinted borders that exist for emphasis rather than meaning
- the `+` button and header-action tints
- the drag-over pane glow
- gradient fills used as decoration

The pane focus ring becomes a white rim (`rgba(255,255,255,0.22)`) rather than a cyan one.

**Rule for deciding:** if removing the colour would lose information the user cannot recover from position or text, it is stateful and keeps its colour via a `--cs-state-*` token. Otherwise it is decorative and becomes white-opacity. Implementers unsure about a specific site should treat it as decorative and note it, rather than preserving colour by default.

## 4. Divider removal

Seventeen `1px` divider rules are removed. Separation is carried by the background ladder instead: `#0a0a0a` canvas → `#141414` pane → `#151515` sidebar → `#1f1f1f` chrome.

| File | Count | What |
| --- | --- | --- |
| `Sidebar.css` | 3 | rail right edge, header underline, footer overline |
| `SkillsPanel.css` | 5 | panel left edge, header, section and row rules, footer |
| `SettingsPage.css` | 3 | nav right edge, two section rules |
| `TerminalPane.css` | 2 | pane header underline, breadcrumb underline |
| `EditorPane.css` | 2 | panel left edge, header underline |
| `Toolbar.css` | 1 | titlebar underline |
| `RightToolbar.css` | 1 | deleted with the file |

### What is not a divider

`.pane`'s own `1px` outline **stays**. It is a card edge rather than a separator between regions, and the reference's panes are visibly bounded. Likewise focus rings, the exited-pane border, and input outlines are state or affordance, not dividers.

## 5. Right toolbar removal and the Skills nav

### Removal

`src/renderer/components/RightToolbar.jsx` and `RightToolbar.css` are deleted, along with `tests/renderer/RightToolbar.test.jsx`.

The toolbar declared four buttons, of which three (`Slash commands`, `Editor`, `Search`) were `enabled: false` stubs that did nothing. Its only working behavior was toggling the Skills panel. Deleting it therefore costs one entry point, not a feature.

### The Skills nav row

The sidebar gains a nav region **above** the `Workspaces` header, containing a single `Skills` row styled as a plain text row — no icon, generous padding, dim by default, brighter when its panel is open.

It calls the existing `handleSelectPanel('skills')` in `App.jsx:617`, which is the same toggle the toolbar called. Consequently:

- `activePanel` state is unchanged
- `SkillsPanel`, `SkillsPanelResizer`, panel width persistence, and the drag-to-terminal behavior are all untouched
- the panel still opens on the right

The row reflects panel state (`aria-pressed`, and a brighter text colour when open).

### Layout after removal

```
┌──────────┬────────────────────────┬─────────┐
│ Skills   │                        │ Skills  │
│          │      pane grid         │ panel   │
│ WORKSPCS+│                        │ (right) │
│ ▾ ws     │                        │         │
│   ● sess │                        │         │
└──────────┴────────────────────────┴─────────┘
```

The vertical icon rail that previously occupied the far right is gone; the Skills panel now sits flush against the window edge.

## 6. Radius

Pane cards move from `8px` to `10px`, matching the reference. Sidebar rows stay at `7px`. No other radius changes.

## Files changed

| File | Change | Detail |
| --- | --- | --- |
| `src/renderer/design-tokens.css` | modify | Retune 10 `:root` values; add 4 `--cs-state-*` to both theme blocks |
| `src/renderer/components/Sidebar.jsx` | modify | Skills nav row above the Workspaces header |
| `src/renderer/components/Sidebar.css` | modify | Nav row styles; remove 3 dividers; state tokens |
| `src/renderer/components/RightToolbar.jsx` | delete | — |
| `src/renderer/components/RightToolbar.css` | delete | — |
| `src/renderer/App.jsx` | modify | Drop the `RightToolbar` import and render; pass the Skills toggle to `Sidebar` |
| `src/renderer/components/TerminalPane.css` | modify | 2 dividers; state tokens; radius `8px → 10px`; focus ring to white |
| `src/renderer/components/WorkspaceRow.jsx` | modify | Isolated badge gradient stops to `--cs-state-isolated` (inline in the SVG, so the JSX changes) |
| `src/renderer/components/SkillsPanel.css` | modify | 5 dividers; accent demotion |
| `src/renderer/components/SettingsPage.css` | modify | 3 dividers; accent demotion |
| `src/renderer/components/EditorPane.css` | modify | 2 dividers |
| `src/renderer/components/Toolbar.css` | modify | 1 divider |
| `src/renderer/components/ConfirmDialog.css`, `Toggle.css`, `Onboarding.css`, `AgentTypePicker.css`, `UpdateToast.css`, `VolumeControl.css`, `EditorResizer.css`, `SkillsPanelResizer.css` | modify | Accent demotion only |
| `tests/renderer/RightToolbar.test.jsx` | delete | 4 tests |
| `tests/renderer/Sidebar.test.jsx` | modify | Skills nav row coverage |

## Testing

- `Sidebar.test.jsx` gains: the Skills row renders; clicking it calls the toggle; it reflects open state for assistive tech.
- Existing component tests assert markup and class names, not colours, so the palette change should not touch them. **If a test fails on a colour assertion, that is a finding to report, not a test to update** — it means a component was asserting appearance rather than behavior.
- Net test count: roughly `310 → 312` (four `RightToolbar` tests removed, ~six sidebar nav tests added).
- `npm run build` must succeed.

## Verification

Automated tests cannot confirm a palette. After implementation, a human pass in `npm run dev` must check, in **both** themes:

- the sidebar reads as a raised panel rather than a recess
- no divider lines remain anywhere in the chrome
- the pane header / terminal seam still reads as an inset screen
- running, done, exited and isolated remain distinguishable at a glance
- terminal output and editor syntax highlighting are still fully coloured
- Bridge is visually unchanged from before this pass

## Non-goals

- No change to `[data-theme='bridge']`'s appearance beyond adding the state-token aliases.
- No change to the xterm ANSI palette or CodeMirror syntax colours.
- No removal of the Skills panel, its resizer, or its backend.
- No change to the theme selector, settings schema, or persistence.
- No structural change to the sidebar tree, panes, or breadcrumb built in the predecessor spec.
- No titlebar mode switcher, app-drawn composer, or account footer.
- No BridgeMind assets, branding, imagery, or naming.
