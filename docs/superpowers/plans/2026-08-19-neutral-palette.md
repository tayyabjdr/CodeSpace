# CodeSpace Neutral Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retune CodeSpace's default theme to the neutral greys sampled from the reference screenshot, demote decorative accents to white-opacity, strip every divider line, delete the right toolbar, and move Skills into the sidebar.

**Architecture:** One token file carries the palette change; four semantic `--cs-state-*` tokens give the surviving accents names that say what they mean. Everything downstream is CSS edits applied under a single decision rule (stateful keeps colour, decorative goes white-opacity). The right toolbar's only working behavior — toggling the Skills panel — moves to a sidebar nav row that calls the same existing handler, so the panel itself is untouched.

**Tech Stack:** Electron 31, React 18, Vitest 2 + jsdom, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-08-19-neutral-palette-design.md`

## Global Constraints

- **The `[data-theme='bridge']` block keeps its appearance.** The only change permitted there is adding the four `--cs-state-*` aliases. Bridge must look identical before and after this work.
- **The xterm ANSI palette is off limits.** `--cs-term-red`, `--cs-term-green`, `--cs-term-yellow`, `--cs-term-blue`, `--cs-term-magenta`, `--cs-term-cyan` and their `bright-` variants, plus CodeMirror syntax colours in `src/renderer/codemirror-theme.js`, are **content** — what the user's agents print. They keep their colour. Do not desaturate them.
- **Decision rule for every accent site:** if removing the colour loses information the user cannot recover from position or text, it is stateful and keeps colour via a `--cs-state-*` token. Otherwise it is decorative and becomes a white-opacity tier. When unsure, treat it as decorative and note it in your report.
- `.pane`'s own `1px` outline is a card edge, not a divider. It stays. So do focus rings, the exited-pane border, and input outlines.
- No changes to the theme selector, settings schema, persistence, PTY lifecycle, or worktree behavior.
- No BridgeMind assets, branding, imagery, or naming anywhere in code, comments, or copy.
- Run `npm test` before every commit. The suite stands at **310 passing across 31 files** entering this plan.
- **If a test fails on a colour assertion, report it — do not update the test.** It means a component was asserting appearance instead of behavior, which is a finding.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/renderer/design-tokens.css` | modify | 10 retuned `:root` values; 4 `--cs-state-*` in both theme blocks |
| `tests/renderer/design-tokens.test.js` | create | Guards both theme blocks declare the state tokens, and that the surface ramp is neutral |
| `src/renderer/components/Sidebar.css` | modify | State tokens; 3 dividers; Skills nav row styles; accent demotion |
| `src/renderer/components/TerminalPane.css` | modify | State tokens; 2 dividers; radius; accent demotion |
| `src/renderer/components/WorkspaceRow.jsx` | modify | Isolated badge gradient stops |
| `src/renderer/components/Sidebar.jsx` | modify | Skills nav row above the Workspaces header |
| `src/renderer/App.jsx` | modify | Drop RightToolbar; pass the Skills toggle to Sidebar |
| `src/renderer/components/RightToolbar.jsx` / `.css` | delete | — |
| `tests/renderer/RightToolbar.test.jsx` | delete | 4 tests |
| `tests/renderer/Sidebar.test.jsx` | modify | Skills nav row coverage |
| 11 other renderer stylesheets | modify | Dividers and accent demotion |

**Dependencies:** Task 1 is foundational — every later task consumes its tokens. Task 2 depends on Task 1. Tasks 3, 4 and 5 depend on Task 1 but not on each other. Task 6 touches `Sidebar.css`, so it runs after Task 3.

---

## Task 1: Palette retune and state tokens

**Files:**
- Modify: `src/renderer/design-tokens.css`
- Create: `tests/renderer/design-tokens.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `--cs-state-running`, `--cs-state-done`, `--cs-state-exited`, `--cs-state-isolated` — declared in both `:root` and `:root[data-theme='bridge']`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/design-tokens.test.js`:

```js
import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'

const css = readFileSync(new URL('../../src/renderer/design-tokens.css', import.meta.url), 'utf8')

// Grab one selector's declaration body. Both blocks in this file close with
// a `}` at column 0, so the first `\n}` after the opening brace ends it.
function block(selector) {
  const i = css.indexOf(selector)
  if (i === -1) return ''
  const open = css.indexOf('{', i)
  const close = css.indexOf('\n}', open)
  return css.slice(open, close)
}

const STATE_TOKENS = [
  '--cs-state-running',
  '--cs-state-done',
  '--cs-state-exited',
  '--cs-state-isolated'
]

const SURFACES = ['--cs-bg-base', '--cs-bg-surface', '--cs-bg-elevated', '--cs-bg-sidebar']

describe('design tokens', () => {
  it('declares every state token in the default theme', () => {
    const root = block(':root {')
    for (const t of STATE_TOKENS) expect(root).toContain(t)
  })

  it('declares every state token in the bridge theme', () => {
    // Easy to forget, and silent when wrong: a token missing from the bridge
    // block just inherits the default theme's colour, so Bridge would show
    // cyan "done" dots instead of rose ones and nothing would error.
    const bridge = block(":root[data-theme='bridge']")
    for (const t of STATE_TOKENS) expect(bridge).toContain(t)
  })

  it('keeps the default surface ramp pure neutral grey', () => {
    // The reference screenshot sampled at an RGB spread of zero on every
    // surface. This guards against the bluish tint creeping back in.
    const root = block(':root {')
    for (const name of SURFACES) {
      const m = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
      expect(m, `${name} should be declared as a 6-digit hex`).toBeTruthy()
      const [r, g, b] = [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${name} (${m[1]}) should be neutral`).toBe(0)
    }
  })

  it('leaves the bridge surface ramp warm', () => {
    // Bridge must NOT be neutralised — this is the guard on "bridge is unchanged".
    const bridge = block(":root[data-theme='bridge']")
    const m = bridge.match(/--cs-bg-base:\s*(#[0-9a-fA-F]{6})/)
    expect(m).toBeTruthy()
    const [r, g, b] = [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16))
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/design-tokens.test.js`
Expected: FAIL — the state tokens are not declared, and `--cs-bg-base` is `#0a0b0d` (spread 3, not 0)

- [ ] **Step 3: Retune the nine `:root` values**

In `src/renderer/design-tokens.css`, inside the `:root` block only, change these declarations. Leave every other token alone:

```css
  --cs-bg-base:      #0a0a0a;   /* was #0a0b0d */
  --cs-bg-surface:   #141414;   /* was #0d0f12 */
  --cs-bg-elevated:  #1f1f1f;   /* was #11151b */
  --cs-bg-sidebar:   #151515;   /* was #0a0c0f — now LIGHTER than base */
  --cs-bg-active:    rgba(255, 255, 255, 0.10);  /* was 0.06; resolves to #2c2c2c over the sidebar */

  --cs-border:       #232323;   /* was #1b1e24 */
  --cs-border-mid:   #2c2c2c;   /* was #262a32 */
  --cs-border-hover: #383838;   /* was #2b3038 */
```

Then find `--cs-term-bg` (further down, in the terminal block) and set it to `#141414` so the terminal body tracks the pane surface:

```css
  --cs-term-bg: #141414;   /* was #0d0f12 */
```

**Note on the sidebar:** `--cs-bg-sidebar` was darker than `--cs-bg-base` and is now lighter. This is intentional — in the reference the rail reads as a raised panel rather than a recess. Expect the sidebar to look wrong until all of these values have landed together.

- [ ] **Step 4: Add the state tokens to `:root`**

Immediately after the accents section in `:root`, add:

```css
  /* Semantic state — the only accents that survive as colour. Everything
     else in the chrome uses white-opacity tiers. These are aliases of the
     accent values above, so changing a theme's accent moves its states too. */
  --cs-state-running:  #86efac;
  --cs-state-done:     #67e8f9;
  --cs-state-exited:   #f59e0b;
  --cs-state-isolated: #67e8f9;
```

- [ ] **Step 5: Add the state tokens to the bridge block**

Inside `:root[data-theme='bridge']`, add the same four names with Bridge's own values:

```css
  --cs-state-running:  #7acb85;
  --cs-state-done:     #e15a9e;
  --cs-state-exited:   #dda04c;
  --cs-state-isolated: #e15a9e;
```

Do not change any other value in this block.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/renderer/design-tokens.test.js`
Expected: PASS, 4 tests

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests (310 + 4 new)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/design-tokens.css tests/renderer/design-tokens.test.js
git commit -m "feat(tokens): retune the default theme to neutral and add state tokens"
```

---

## Task 2: Migrate stateful sites to the state tokens

**Files:**
- Modify: `src/renderer/components/Sidebar.css`
- Modify: `src/renderer/components/TerminalPane.css`
- Modify: `src/renderer/components/WorkspaceRow.jsx`

**Interfaces:**
- Consumes: `--cs-state-running` / `--cs-state-done` / `--cs-state-exited` / `--cs-state-isolated` (Task 1)
- Produces: nothing consumed by later tasks

This task moves only the sites that **encode state**. Decorative accents are Tasks 4 and 5 — leave them alone here.

- [ ] **Step 1: Migrate the session and aggregate dots**

In `src/renderer/components/Sidebar.css`, in the session-row rules added by the previous plan:

```css
.sb-session-dot.running { background: var(--cs-state-running); }
.sb-session-dot.done    { background: var(--cs-state-done); box-shadow: 0 0 5px var(--cs-cyan-glow); }
.sb-session-dot.exited  { background: var(--cs-text-dim); }
```

The `.exited` dot deliberately stays a dim white rather than amber: in the tree it sits beside running and done dots, where "absent of life" reads better as dim than as a warning colour. The amber is reserved for the pane border, where it is the only exit signal present.

Then the aggregate dot on collapsed workspace rows:

```css
.sb-item-dot {
  /* …existing geometry… */
  background: var(--cs-state-done);
}
```

- [ ] **Step 2: Migrate the pane status dots and exited border**

In `src/renderer/components/TerminalPane.css`:

```css
.status-dot.status-running { background: var(--cs-state-running); }
.status-dot.status-exited  { background: var(--cs-state-exited); }
.pane.exited               { border-color: var(--cs-state-exited); }
```

- [ ] **Step 3: Migrate the done pulse and tick**

Still in `TerminalPane.css`, set the done tick's colour to the state token:

```css
.done-tick { color: var(--cs-state-done); }
```

Leave the two `--cs-done-grad-start` / `--cs-done-grad-end` tokens and the `.pane-done-pulse` rules that consume them exactly as they are. They are already a named pair meaning "the done gradient", so re-pointing them adds churn without adding meaning.

- [ ] **Step 4: Migrate the isolated badge gradient**

In `src/renderer/components/WorkspaceRow.jsx`, the `IsolatedGlyph` gradient stops:

```jsx
        <stop offset="0%" stopColor="var(--cs-state-isolated)" />
        <stop offset="100%" stopColor="var(--cs-state-running)" />
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests, unchanged

If any test fails here, it is asserting a colour. Report it rather than updating it.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Sidebar.css src/renderer/components/TerminalPane.css src/renderer/components/WorkspaceRow.jsx
git commit -m "refactor(tokens): name the stateful accents by what they mean"
```

---

## Task 3: Remove every divider, bump the pane radius

**Files:**
- Modify: `src/renderer/components/Sidebar.css:7,19,344`
- Modify: `src/renderer/components/TerminalPane.css:136,390`
- Modify: `src/renderer/components/SkillsPanel.css:7,21,57,99,263`
- Modify: `src/renderer/components/SettingsPage.css:23,152,199`
- Modify: `src/renderer/components/EditorPane.css:5,19`
- Modify: `src/renderer/components/Toolbar.css:7`

Sixteen divider rules. The seventeenth lives in `RightToolbar.css`, which Task 6 deletes outright.

There are no unit tests for pure styling; this task is verified by the suite still passing, a clean build, and the human pass at the end of the plan.

- [ ] **Step 1: Delete the divider declarations**

Remove the `border-right` / `border-bottom` / `border-top` / `border-left` declaration on each line listed above. Delete the whole declaration — do not set it to `none` or `0`, which leaves dead code behind.

Line-by-line, what each one is:

| File | Line | Declaration |
|---|---|---|
| `Sidebar.css` | 7 | `border-right` on `.sidebar` — the rail's edge against the canvas |
| `Sidebar.css` | 19 | `border-bottom` on `.sb-header` |
| `Sidebar.css` | 344 | `border-top` on `.sb-footer` |
| `TerminalPane.css` | 136 | `border-bottom` on `.pane-header` |
| `TerminalPane.css` | 390 | `border-bottom` on `.pane-subheader` |
| `SkillsPanel.css` | 7 | `border-left` on the panel |
| `SkillsPanel.css` | 21 | `border-bottom` on its header |
| `SkillsPanel.css` | 57 | `border-bottom` — section rule |
| `SkillsPanel.css` | 99 | `border-bottom` — row rule |
| `SkillsPanel.css` | 263 | `border-top` — footer |
| `SettingsPage.css` | 23 | `border-right` on the settings nav |
| `SettingsPage.css` | 152 | `border-top` — section rule |
| `SettingsPage.css` | 199 | `border-top` — section rule |
| `EditorPane.css` | 5 | `border-left` on the editor panel |
| `EditorPane.css` | 19 | `border-bottom` on its header |
| `Toolbar.css` | 7 | `border-bottom` on the titlebar |

Separation is now carried by the background ladder — `#0a0a0a` canvas, `#141414` pane, `#151515` sidebar, `#1f1f1f` chrome — which Task 1 put in place.

- [ ] **Step 2: Bump the pane radius**

In `TerminalPane.css`, in the `.pane` rule, change `border-radius: 8px` to `border-radius: 10px`.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests, unchanged

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/*.css
git commit -m "style: remove every divider line; separation comes from the surface ramp"
```

---

## Task 4: Accent demotion — shell chrome

**Files:**
- Modify: `src/renderer/App.css` (6 sites)
- Modify: `src/renderer/components/Sidebar.css` (8 sites)
- Modify: `src/renderer/components/TerminalPane.css` (10 sites)
- Modify: `src/renderer/components/Toolbar.css` (4 sites)
- Modify: `src/renderer/components/AppIcon.jsx:10` (1 site)

Roughly twenty-nine `var(--cs-cyan*)` / `var(--cs-green*)` usages across the always-visible chrome. Apply the decision rule from Global Constraints to each.

**The per-file counts above were measured before Task 2 ran**, and Task 2 already converted the stateful sites in `Sidebar.css` and `TerminalPane.css` to `--cs-state-*`. Expect fewer hits than the counts suggest, and do not touch anything already pointing at a `--cs-state-*` token. Step 1's grep is the authoritative list, not the counts.

- [ ] **Step 1: Find every remaining site in these files**

Run:

```bash
grep -n "var(--cs-cyan\|var(--cs-green" src/renderer/App.css src/renderer/components/Sidebar.css src/renderer/components/TerminalPane.css src/renderer/components/Toolbar.css src/renderer/components/AppIcon.jsx
```

Work the list top to bottom. For each, decide stateful or decorative.

- [ ] **Step 2: Replace decorative accents with white-opacity**

Use this ladder, which matches the existing text tiers:

| Was | Becomes |
|---|---|
| `var(--cs-cyan)` as an icon or text tint | `var(--cs-text-secondary)` |
| `var(--cs-cyan-border)` / `--cs-cyan-border-strong` | `rgba(255, 255, 255, 0.22)` |
| `var(--cs-cyan-bg)` / `--cs-cyan-fill-weak` | `rgba(255, 255, 255, 0.05)` |
| `var(--cs-cyan-focus)` | `rgba(255, 255, 255, 0.10)` |
| `var(--cs-cyan-glow)` / `--cs-cyan-glow-soft` / `--cs-cyan-glow-mid` | drop the glow entirely, or `rgba(255, 255, 255, 0.14)` where it carries a focus affordance |

The pane focus ring specifically becomes a white rim:

```css
.pane.focused {
  border-color: rgba(255, 255, 255, 0.22);
}
```

`AppIcon.jsx:10` currently hardcodes `style={{ color: 'var(--cs-cyan)' }}`. The app icon is branding, not state — change it to `var(--cs-text-primary)`.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests, unchanged. A colour assertion failure is a finding to report, not a test to edit.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.css src/renderer/components/Sidebar.css src/renderer/components/TerminalPane.css src/renderer/components/Toolbar.css src/renderer/components/AppIcon.jsx
git commit -m "style(chrome): demote decorative accents to white-opacity tiers"
```

---

## Task 5: Accent demotion — panels and dialogs

**Files:**
- Modify: `src/renderer/components/Onboarding.css` (15 sites)
- Modify: `src/renderer/components/SettingsPage.css` (11 sites)
- Modify: `src/renderer/components/EditorPane.css` (9 sites)
- Modify: `src/renderer/components/SkillsPanel.css` (7 sites)
- Modify: `src/renderer/components/UpdateToast.css` (6 sites)
- Modify: `src/renderer/components/Toggle.css` (4 sites)
- Modify: `src/renderer/components/VolumeControl.css` (1 site)
- Modify: `src/renderer/components/SkillsPanelResizer.css` (1 site)
- Modify: `src/renderer/components/EditorResizer.css` (1 site)

Fifty-five usages across the surfaces you reach rather than live in. Same decision rule, same replacement ladder as Task 4 — repeated here so you do not need to read that task:

| Was | Becomes |
|---|---|
| `var(--cs-cyan)` as an icon or text tint | `var(--cs-text-secondary)` |
| `var(--cs-cyan-border)` / `--cs-cyan-border-strong` | `rgba(255, 255, 255, 0.22)` |
| `var(--cs-cyan-bg)` / `--cs-cyan-fill-weak` | `rgba(255, 255, 255, 0.05)` |
| `var(--cs-cyan-focus)` | `rgba(255, 255, 255, 0.10)` |
| `var(--cs-cyan-glow*)` | drop, or `rgba(255, 255, 255, 0.14)` for a focus affordance |

- [ ] **Step 1: Find every site**

```bash
grep -n "var(--cs-cyan\|var(--cs-green" src/renderer/components/Onboarding.css src/renderer/components/SettingsPage.css src/renderer/components/EditorPane.css src/renderer/components/SkillsPanel.css src/renderer/components/UpdateToast.css src/renderer/components/Toggle.css src/renderer/components/VolumeControl.css src/renderer/components/SkillsPanelResizer.css src/renderer/components/EditorResizer.css
```

- [ ] **Step 2: Apply the ladder**

Three judgment calls worth naming, because each is a place where colour is doing real work:

- **`Toggle.css`** — the "on" state of a toggle. Position already encodes it (knob left vs right), so it is decorative by the rule. Use `rgba(255, 255, 255, 0.22)` for the on-track.
- **`UpdateToast.css`** — "an update is ready" is genuinely stateful, but it is not one of the four agent states. Use `var(--cs-text-primary)` for its emphasis rather than inventing a fifth state token.
- **`SettingsPage.css`** — the selected nav item and the checked theme radio. Both are already carried by fill and position; demote them.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests, unchanged

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/*.css
git commit -m "style(panels): demote decorative accents to white-opacity tiers"
```

---

## Task 6: Delete the right toolbar, add the Skills nav row

**Files:**
- Delete: `src/renderer/components/RightToolbar.jsx`
- Delete: `src/renderer/components/RightToolbar.css`
- Delete: `tests/renderer/RightToolbar.test.jsx`
- Modify: `src/renderer/App.jsx`
- Modify: `src/renderer/components/Sidebar.jsx`
- Modify: `src/renderer/components/Sidebar.css`
- Modify: `tests/renderer/Sidebar.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `<Sidebar … skillsOpen={boolean} onToggleSkills={() => void} />` — two new props

The toolbar declared four buttons; three (`Slash commands`, `Editor`, `Search`) were `enabled: false` stubs. Its only working behavior was toggling the Skills panel, which is why this is a move rather than a deletion.

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/Sidebar.test.jsx`, inside the existing `describe`:

```jsx
  it('renders a Skills nav row above the workspaces header', () => {
    const { container } = render(<Sidebar {...base} skillsOpen={false} onToggleSkills={() => {}} />)
    const nav = container.querySelector('.sb-nav-item')
    expect(nav).toBeTruthy()
    expect(nav.textContent).toBe('Skills')

    // Order matters: the nav sits above the Workspaces header, not below it.
    const header = container.querySelector('.sb-header')
    expect(nav.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls onToggleSkills when the Skills row is clicked', async () => {
    const onToggleSkills = vi.fn()
    render(<Sidebar {...base} skillsOpen={false} onToggleSkills={onToggleSkills} />)
    await userEvent.click(screen.getByText('Skills'))
    expect(onToggleSkills).toHaveBeenCalledTimes(1)
  })

  it('reports the panel open state to assistive tech', () => {
    const { container, rerender } = render(
      <Sidebar {...base} skillsOpen={false} onToggleSkills={() => {}} />
    )
    expect(container.querySelector('.sb-nav-item').getAttribute('aria-pressed')).toBe('false')

    rerender(<Sidebar {...base} skillsOpen onToggleSkills={() => {}} />)
    expect(container.querySelector('.sb-nav-item').getAttribute('aria-pressed')).toBe('true')
  })

  it('marks the Skills row active when its panel is open', () => {
    const { container } = render(<Sidebar {...base} skillsOpen onToggleSkills={() => {}} />)
    expect(container.querySelector('.sb-nav-item').className).toContain('is-open')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/Sidebar.test.jsx`
Expected: FAIL — no `.sb-nav-item` exists

- [ ] **Step 3: Add the nav row to Sidebar.jsx**

Extend the signature with the two new props, then insert the nav region immediately inside `<aside className="sidebar">`, **above** the existing `sb-header` div:

```jsx
export default function Sidebar({
  workspaces, activeId, expandedIds, doneTermIds, exitedPtyIds, focusedTerminalId,
  skillsOpen, onToggleSkills,
  onSelect, onToggleExpand, onSelectSession, onCreate, onDelete, onOpenSettings, onRenameNickname
}) {
```

```jsx
    <aside className="sidebar">
      <nav className="sb-nav" aria-label="Tools">
        <button
          type="button"
          className={`sb-nav-item${skillsOpen ? ' is-open' : ''}`}
          aria-pressed={skillsOpen}
          onClick={onToggleSkills}
        >
          Skills
        </button>
      </nav>

      <div className="sb-header">
```

- [ ] **Step 4: Add the nav styles**

Append to `src/renderer/components/Sidebar.css`:

```css
/* ── Tools nav (above Workspaces) ────────────────────────────── */

.sb-nav {
  display: flex;
  flex-direction: column;
  padding: 10px 6px 2px;
  flex-shrink: 0;
}

.sb-nav-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  font-family: var(--cs-font-ui);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--cs-text-tertiary);
  transition: background var(--cs-transition), color var(--cs-transition);
}

.sb-nav-item:hover {
  background: var(--cs-bg-hover);
  color: var(--cs-text-secondary);
}

.sb-nav-item.is-open {
  background: var(--cs-bg-active);
  color: var(--cs-text-primary);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/renderer/Sidebar.test.jsx`
Expected: PASS — the file's existing tests plus 4 new

- [ ] **Step 6: Delete the toolbar**

```bash
git rm src/renderer/components/RightToolbar.jsx src/renderer/components/RightToolbar.css tests/renderer/RightToolbar.test.jsx
```

- [ ] **Step 7: Rewire App.jsx**

Remove the import at `src/renderer/App.jsx:13`:

```js
import RightToolbar from './components/RightToolbar.jsx'
```

Remove the render block near the end of `.app-body` — the whole element:

```jsx
        <RightToolbar
          activePanel={activePanel}
          onSelectPanel={handleSelectPanel}
        />
```

Then pass the two new props at the `<Sidebar>` call site, alongside the existing thirteen:

```jsx
          skillsOpen={activePanel === 'skills'}
          onToggleSkills={() => handleSelectPanel('skills')}
```

`handleSelectPanel` already toggles (`setActivePanel(prev => prev === panelId ? null : panelId)` at `App.jsx:617`), so clicking Skills a second time closes the panel with no extra logic. Leave `activePanel`, `SkillsPanel`, `SkillsPanelResizer`, and the width-persistence code untouched.

- [ ] **Step 8: Confirm nothing still references the toolbar**

Run: `grep -rn "RightToolbar" src/ tests/`
Expected: no output

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, 314 tests (314 − 4 RightToolbar + 4 Sidebar)

- [ ] **Step 10: Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 11: Commit**

```bash
git add -A src/renderer tests/renderer
git commit -m "feat(sidebar): move Skills into the sidebar and delete the right toolbar"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: PASS, **314 tests across 31 files**. Baseline was 310; this plan adds 4 token tests and 4 sidebar-nav tests, and removes 4 RightToolbar tests.

- [ ] **Build**

Run: `npm run build`
Expected: succeeds

- [ ] **Confirm no accent leaked back into the chrome**

```bash
grep -rn "var(--cs-cyan\|var(--cs-green" src/renderer --include=*.css --include=*.jsx
```

Every surviving hit should be either a `--cs-state-*` alias definition in `design-tokens.css`, a `--cs-done-grad-*` reference, or a deliberate exception noted in the implementer's report.

- [ ] **Human visual pass — `npm run dev`**

Automated tests cannot confirm a palette. Check in **both** themes:

- the sidebar reads as a raised panel rather than a recess
- no divider lines anywhere in the chrome
- the pane header / terminal seam still reads as an inset screen
- running, done, exited and isolated remain distinguishable at a glance
- **terminal output and editor syntax highlighting are still fully coloured** — this is the one regression that would make the app unusable
- Bridge looks exactly as it did before this work
- the Skills row opens and closes the panel, and the panel still sits flush against the window edge
