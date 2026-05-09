# CodeSpace Design System — Portable Reference

A self-contained spec for porting CodeSpace's visual language to another app. Optimized for **Tauri** (webview, so all CSS is reusable as-is), but the tokens and component specs are framework-agnostic.

## How to use this

1. Copy `src/renderer/design-tokens.css` into your Tauri app and import it **before** any other CSS (it defines the variables everything else consumes).
2. Install fonts: `npm i @fontsource-variable/geist @fontsource-variable/geist-mono` and import them once at app entry.
3. Use this document for component sizing, spacing, structure, and rules.
4. The Electron window-config in `src/main/index.js` translates 1:1 to Tauri's `tauri.conf.json` — see [Window](#1-window) below.

---

## 1. Window

| Property | Value | Tauri config (`tauri.conf.json`) |
|---|---|---|
| Default width | `1400` | `app.windows[0].width` |
| Default height | `900` | `app.windows[0].height` |
| Frame | frameless (custom titlebar) | `decorations: false` |
| Background | `#0a0b0d` (`--cs-bg-base`) | `backgroundColor: "#0a0b0d"` |
| Min size | none enforced; design assumes ≥ 900×600 | `minWidth: 900`, `minHeight: 600` |
| Resize on first content | maximize on session resume; otherwise stay at 1400×900 | handle in Rust setup |

Frameless means **the app supplies its own titlebar** (42px). On Tauri, give the titlebar element `data-tauri-drag-region` (Electron equivalent: `-webkit-app-region: drag`).

---

## 2. Tokens

Everything in `design-tokens.css`. The categories:

### Surfaces (subtle bluish dark)
```
--cs-bg-base:     #0a0b0d   /* window background */
--cs-bg-surface:  #0d0f12   /* cards, panes */
--cs-bg-elevated: #11151b   /* popovers */
--cs-bg-sidebar:  #0a0c0f   /* sidebar + titlebar */
--cs-bg-hover:    rgba(255,255,255,0.04)
--cs-bg-active:   rgba(255,255,255,0.06)
```

### Borders
```
--cs-border:       #1b1e24
--cs-border-mid:   #262a32   /* inputs, modals */
--cs-border-hover: #2b3038
--cs-border-focus: rgba(255,255,255,0.24)
```

### Text — opacity scale on white (never use raw greys)
```
--cs-text-primary:   rgba(255,255,255,0.92)
--cs-text-secondary: rgba(255,255,255,0.78)
--cs-text-tertiary:  rgba(255,255,255,0.42)
--cs-text-muted:     rgba(255,255,255,0.28)
--cs-text-dim:       rgba(255,255,255,0.18)
```

### Accents
```
--cs-cyan:   #67e8f9   /* live counts, active sliders, focused/in-flight state */
--cs-green:  #86efac   /* done / success */
--cs-amber:  #f59e0b   /* idle / exited (process ended cleanly) */
--cs-red:    #ef4444   /* destructive only */
```
Glow pattern: `text-shadow: 0 0 12px var(--cs-cyan-glow)` on cyan numerics, `box-shadow: 0 0 6px rgba(134,239,172,0.45)` on live status dots.

### Type
```
--cs-font-ui:   "Geist Variable", system-ui, sans-serif
--cs-font-mono: "Geist Mono Variable", ui-monospace, monospace
```
- `font-feature-settings: "ss01" on, "cv11" on, "tnum" on` on `body` — gives Geist its signature alt characters and tabular numerals.
- Mono is used for: terminal output, labels (uppercase + tracked), numeric counts, kbd shortcuts, hint text.
- UI font is used for: headings, body, inputs, button labels.

### Type scale (observed in actual components)
| Use | Size | Weight | Tracking |
|---|---|---|---|
| Wordmark (onboarding) | `2.2rem` (~35px) | 600 | -0.03em |
| Section title | `13.5–14px` | 600 | -0.01em |
| Body | `12.5–13px` | 400–500 | -0.005em |
| Label (uppercase mono) | `10.5–11px` | 500–600 | 0.10–0.18em, uppercase |
| Hint / meta | `10–10.5px` mono | 500 | 0.04–0.06em |
| Kbd | `9.5px` mono | 500 | 0.04em, uppercase |

### Layout
```
--cs-radius:     10px      /* default; modals use 12px, inputs 8px, small btns 6–7px */
--cs-toolbar-h:  42px      /* custom titlebar height */
--cs-header-h:   30px      /* terminal pane header */
--cs-transition: 0.15s ease /* default for color/bg/border on hover */
```

### Animations
Defined keyframes: `fadeIn`, `fadeOut`, `slideUp` (10px translate), `scaleIn` (0.97 → 1). Durations 180–500ms, ease curves. **No infinite/looping animations** in the base UI — they read as flicker on this palette. Exceptions: the cyan launching sheen, status pulses on the active onboarding card during boot, the volume slider thumb scale on hover.

---

## 3. App shell layout

```
┌─────────────────────────────────────────────────┐
│  Titlebar (42px, drag region)                   │  ← --cs-bg-sidebar
├──────────┬──────────────────────────────────────┤
│          │                                      │
│ Sidebar  │   Grid (gap 4px, padding 4px)        │  ← --cs-bg-base
│  220px   │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

CSS skeleton:
```css
.app      { display: flex; flex-direction: column; height: 100vh; width: 100vw; background: var(--cs-bg-base); }
.app-body { flex: 1; display: flex; min-height: 0; }
.grid     { flex: 1; display: grid; gap: 4px; padding: 4px; min-height: 0; }
```

### Pane grid breakpoints
The grid columns are decided by pane count, not by viewport width. Both columns AND rows are explicit so all rows are equal height:

| Panes | Columns × Rows |
|---|---|
| 1 | 1×1 |
| 2 | 2×1 |
| 3 | 3×1 |
| 4 | 2×2 |
| 5–6 | 3×2 |
| 7+ | 4×2 (max 8 visible) |

---

## 4. Components

### 4.1 Titlebar (`Toolbar.css`)
- Height: `42px` (`--cs-toolbar-h`).
- Padding: `0 10px 0 14px`.
- Background: `--cs-bg-sidebar`. Bottom border: `1px solid --cs-border-mid`.
- Whole bar is the drag region; left identity, center actions, right window controls all opt out (`-webkit-app-region: no-drag` / Tauri: don't add `data-tauri-drag-region` to children).
- **Identity (left):** decorative bar marks (3 vertical pills, 2px wide, 50% white) + wordmark in 11.5px mono, 0.06em tracking, secondary text color.
- **New-workspace pill:** 24px tall, `padding: 0 7px 0 9px`, background `rgba(255,255,255,0.03)`, border `rgba(255,255,255,0.07)`. Contains a `+` glyph + a `<kbd>` chip (9.5px mono, slightly thicker bottom border for keycap effect).
- **Window controls:** 28×28px square buttons, 6px radius, transparent background. Hover: `rgba(255,255,255,0.06)`. Close button hovers red (`--cs-red-hover-bg/fg`).

### 4.2 Onboarding (`Onboarding.css`)
The empty-state launch screen. Shown when no workspace exists.
- Full-viewport overlay, centered, `z-index: 100`, drag region.
- **Shell:** `max-width: 760px`, `padding: 48px 40px`, `gap: 32px` between brand / grid / footer.
- **Brand:** wordmark 2.2rem 600 weight, `letter-spacing: -0.03em`. Tagline 13px tertiary.
- **Body grid:** `1fr 1fr`, `gap: 28px`. Each column is a card: `padding: 22px`, `--cs-bg-surface`, `1px solid --cs-border`, `border-radius: 12px`.
- **Inputs:** 13px, `padding: 10px 12px`, `border-radius: 8px`, `hsl(0 0% 6%)` background, `--cs-border-mid` border. Focus deepens border to `--cs-border-focus`.
- **Agent count cards:** `repeat(4, 1fr)` grid, `aspect-ratio: 1`, 9px radius. Each shows a *mini-grid preview* of N panes (literally a sub-grid of `.ob-preview-cell`s mirroring the main grid breakpoints). Active card: `border: rgba(255,255,255,0.32)`, layered inset + 6px/20 drop shadow, cells pulse cyan.
- **Launch button:** 13px, `padding: 10px 42px`, 8px radius. During launch: cyan-tinted gradient sheen (`100deg`, animated background-position over 1.4s).
- Animations stagger by 0–200ms: brand → grid → footer.

### 4.3 Sidebar (`Sidebar.css`)
- Width: `220px` fixed, `flex-shrink: 0`.
- Background: `--cs-bg-sidebar`. Right border: `1px solid --cs-border`.
- **Header:** `padding: 14px 16px 12px`, mono uppercase label (10.5px, 0.18em tracking), trailing 22×22 add button.
- **List items:** min-height 36px, `padding: 10px 14px 10px 16px`, 7px radius. Layout is `grid-template-columns: 1fr auto` (name + status). Hover swaps the status block for an absolutely-positioned 20×20 delete button.
- **Active state:** 2px white accent bar at left (absolute, `top:8px bottom:8px`), background `--cs-bg-active`, name color jumps from tertiary → primary.
- **Status:** 5px green dot with `box-shadow: 0 0 6px rgba(134,239,172,0.45)`, count in 10px mono tabular.
- **"New workspace" footer button:** 32px tall, dashed border `rgba(255,255,255,0.1)`, mono 11px text, 0.06em tracking.
- New items animate in with `sbItemIn` (fade + 2px slide).

### 4.4 Terminal pane (`TerminalPane.css`)
- Container: `--cs-bg-surface`, `1px solid --cs-border`, no border-radius (sits flush in grid).
- States via border color: default → hover/focused = `--cs-border-focus`, exited = `--cs-border-mid`, **done** = `rgba(134,239,172,0.45)`, **drag-over** = `rgba(103,232,249,0.7)` + cyan outer glow `0 0 18px rgba(103,232,249,0.14)`.
- **Header:** `30px` (`--cs-header-h`), `padding: 0 10px`, 8px gap, `cursor: grab`. Drag handle for the whole pane.
- **Status dot:** 6px round. Live = `--cs-status-live` (green), exited = `--cs-status-amber`.
- **Label:** 11px mono, 0.04em tracking, muted text — jumps to secondary on focus. Editable on double-click → swap to a 18px-tall pill input with 4px radius.
- **Header buttons:** 26×22 cells, 5px radius. Close button hovers red.
- **Content:** `padding: 4px` around the terminal/content area, `flex: 1`.
- **Error state:** centered column, 12px gap, `padding: 24px 32px`. Title 13.5px primary, body 12.5px tertiary, retry button bordered transparent.

### 4.5 Modal: NewWorkspaceModal (`NewWorkspaceModal.css`)
- **Backdrop:** `rgba(0,0,0,0.55)`, `backdrop-filter: blur(6px)`, `z-index: 200`.
- **Card:** `max-width: 420px`, `padding: 24px 24px 20px`, 12px radius, `border: 1px solid --cs-border-mid`, drop shadow `0 30px 80px rgba(0,0,0,0.6)`.
- **Sections:** vertical, 18px between groups, 8px label→input.
- **Agent count grid:** `repeat(8, 1fr)`, 5px gap, square cells, 7px radius. Active card has `--cs-border-focus` border + inset white shadow.
- **Actions:** flex row, right-aligned, 8px gap.
- **Cancel button:** ghost (transparent border, muted text). **Submit button:** `rgba(255,255,255,0.07)` bg, `rgba(255,255,255,0.14)` border, primary text. Disabled at 35% opacity.
- Enter scaleIn 0.22s, backdrop fadeIn 0.18s.

### 4.6 Modal: ConfirmDialog (`ConfirmDialog.css`)
Same backdrop + card pattern as NewWorkspaceModal but tighter: `max-width: 380px`, `padding: 20px 22px 18px`, 14px gap. Title 13.5px 600. Message 12.5px tertiary, line-height 1.55. Destructive variant tints the confirm button red:
```
background: rgba(239,68,68,0.12)
border:     rgba(239,68,68,0.28)
color:      rgba(252,165,165,0.95)
```

### 4.7 Volume control popover (`VolumeControl.css`)
A pattern worth copying for any toolbar popover.
- **Trigger:** 28×28 to match titlebar buttons exactly.
- **Popover:** absolutely positioned, `top: calc(100% + 6px)`, right-anchored, **220px wide**, `padding: 12px 14px`, 8px radius. Background: `--cs-bg-elevated`. Border: `--cs-border-hover`.
- **Slider:** custom-styled. 2px track (`linear-gradient` with cyan fill via `var(--vol-fill, 50%)` set inline as a CSS variable). 11px round thumb, white background, 1.15× scale on hover. Muted variant dims the fill to `--cs-text-muted`.
- Enter animation: `vol-pop-in` 140ms (4px slide + fade).

---

## 5. Interaction patterns to preserve

These aren't visual but they're part of "feeling like CodeSpace":

1. **Hover swap** — sidebar status indicator vanishes (`opacity: 0`) to reveal a delete button at the same position. Don't add separate icons; reuse the slot.
2. **Drag handles are headers, not corners.** Pane header is `cursor: grab` and is the entire `draggable` source.
3. **Double-click to rename.** Labels swap inline to a small input; `caret-color: var(--cs-cyan)`.
4. **Custom kbd hints** — paired `<kbd>` chips inside buttons (e.g. "+ Cmd N"), styled with thicker bottom border for keycap depth.
5. **Frameless window** + custom drag region on the titlebar. Inner interactive elements opt out via `-webkit-app-region: no-drag` (Electron) / by not having `data-tauri-drag-region` (Tauri).
6. **State via border, not background.** Panes communicate focused/exited/done/drag-over by changing only the 1px border (and sometimes adding a soft outer glow). The fill stays consistent.

---

## 6. Aesthetic rules

These are the "do/don't" the project actually follows:

- **Use opacity-tier whites for text**, never raw greys. Always one of `--cs-text-primary/secondary/tertiary/muted/dim`.
- **One accent per state.** Cyan = live/in-flight/focus. Green = done/success. Amber = idle/exited. Red = destructive only.
- **Borders are thin and dark.** `1px solid --cs-border` (`#1b1e24`) is the default; never go heavier than 2px even on focus.
- **Animations are one-shot 180–500ms.** Reserve infinite loops for explicit "in progress" indicators (launch sheen, status pulse on active card, volume thumb hover). Avoid them everywhere else.
- **Radius scales with element size:** 6–7px for chips/small buttons, 8px for inputs, 10–12px for cards/modals, 0 for full-bleed grid panes.
- **Cyan numerics glow.** Counts, live values, status meta get `text-shadow: 0 0 12px var(--cs-cyan-glow)`. Static text never glows.
- **Tabular nums on counts.** `font-variant-numeric: tabular-nums` so digits don't shift.

---

## 7. Porting checklist for a new Tauri app

- [ ] Copy `design-tokens.css` to `src/styles/` (or wherever) and import first in your app entry.
- [ ] Install `@fontsource-variable/geist` + `@fontsource-variable/geist-mono`; import both at entry.
- [ ] Set `body` font-feature-settings: `"ss01" on, "cv11" on, "tnum" on`.
- [ ] In `tauri.conf.json` set `width: 1400, height: 900, decorations: false, backgroundColor: "#0a0b0d"`.
- [ ] Build a 42px titlebar with `data-tauri-drag-region`.
- [ ] If you have a sidebar, fix it at 220px and use `--cs-bg-sidebar`.
- [ ] All custom scrollbars: 6px wide, `rgba(255,255,255,0.06)` thumb.
- [ ] Build modals on the backdrop pattern from §4.5 (blur + scaleIn card).

That's the entire visual language. If a future component doesn't fit cleanly into these rules, the rules win — adjust the component, not the system.
