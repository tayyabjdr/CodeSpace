# Bridge Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a persisted, runtime-switchable Appearance theme selector with two choices — `Sarvis Dark` (current default) and `Bridge` (warm plum/charcoal with rose accent) — covering shell chrome, terminal, editor, and all surfaces.

**Architecture:** A single document attribute (`<html data-theme="bridge">`) is the CSS boundary. Token overrides under `:root[data-theme='bridge']` in `design-tokens.css` retint everything that already consumes `--cs-*` variables. Two places that hold their own copies of colors — xterm theme in `useTerminal.js` and CodeMirror in `codemirror-theme.js` — are refactored to read from CSS tokens and reapplied on theme change without recreating the underlying session. A handful of stylesheets that hard-coded accent RGBA values are migrated to tokens during the audit.

**Tech Stack:** Electron 31, Vite, React, @xterm/xterm, CodeMirror 6 (Compartments), vitest + @testing-library/react.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/renderer/theme.js` (NEW) | Validate a theme ID and write `document.documentElement.dataset.theme`. Single source of truth for `THEME_IDS`. |
| `src/renderer/terminal-theme.js` (NEW) | `buildTerminalTheme()` — reads CSS tokens and returns an xterm `ITheme`. Reusable on construction and live updates. |
| `src/renderer/design-tokens.css` | Add `:root[data-theme='bridge']` overrides covering surfaces, borders, text, accents, status, icon shades. |
| `src/main/settings-store.js` | Add `appearance.theme` default + validator allowlist. |
| `src/renderer/settings-store.js` | Mirror the default in renderer's `DEFAULTS`. |
| `src/renderer/App.jsx` | Apply theme after `initSettings()`; subscribe to settings changes; thread the current theme into `TerminalPane`/`EditorPane`. |
| `src/renderer/components/SettingsPage.jsx` | Add the `Theme` control above `Default pane font size` in the Appearance category. |
| `src/renderer/components/SettingsPage.css` | Style the new theme picker. |
| `src/renderer/hooks/useTerminal.js` | Use `buildTerminalTheme()` at construction; live-update `term.options.theme` when active theme ID changes (no PTY restart). |
| `src/renderer/codemirror-theme.js` | Make syntax accents read from tokens. |
| `src/renderer/hooks/useEditor.js` | Wrap theme + highlight in a Compartment; reconfigure when theme ID changes. |
| Component CSS files in the audit list | Replace hard-coded `#67e8f9`/`#86efac`/`#c4b5fd`/etc. and their rgba forms with semantic tokens. |
| `src/renderer/components/AppIcon.jsx`, `Sidebar.jsx` | Inline SVG `stopColor`/`stroke` → read from CSS tokens via `getComputedStyle` (small helper) or via `currentColor`. |
| `tests/main/settings-store.test.js` | Cover `appearance.theme` defaulting + allowlist round-trip. |
| `tests/renderer/SettingsPage.test.jsx` | Cover Theme control rendering + `setSettings` call. |
| `tests/renderer/theme.test.js` (NEW) | Cover `applyTheme(id)` + invalid-id fallback. |
| `tests/renderer/terminal-theme.test.js` (NEW) | Cover `buildTerminalTheme()` reading specific CSS tokens. |

---

## Task 1: Add `appearance.theme` to the main-process settings shape

**Files:**
- Modify: `src/main/settings-store.js`
- Test: `tests/main/settings-store.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/settings-store.test.js` inside the existing `describe('settings-store', ...)` block:

```js
  it('defaults appearance.theme to sarvis-dark when missing', async () => {
    const s = await loadSettings()
    expect(s.appearance.theme).toBe('sarvis-dark')
  })

  it('round-trips a valid bridge theme', async () => {
    await saveSettings({ ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme: 'bridge' } })
    const s = await loadSettings()
    expect(s.appearance.theme).toBe('bridge')
  })

  it('falls back to sarvis-dark for an invalid theme value', async () => {
    await saveSettings({ ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme: 'nope' } })
    const s = await loadSettings()
    expect(s.appearance.theme).toBe('sarvis-dark')
  })

  it('mergeAndSave preserves theme when patching unrelated keys', async () => {
    await saveSettings({ ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme: 'bridge' } })
    const next = await mergeAndSave({ notifications: { doneSoundVolume: 20 } })
    expect(next.appearance.theme).toBe('bridge')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/settings-store.test.js`
Expected: FAIL — the four new tests fail because `appearance.theme` doesn't exist yet.

- [ ] **Step 3: Update `src/main/settings-store.js`**

At the top of the file, just below the imports, add:

```js
export const THEME_IDS = ['sarvis-dark', 'bridge']
```

Update `DEFAULTS.appearance`:

```js
  appearance: {
    theme: 'sarvis-dark',
    defaultPaneFontSize: 13
  },
```

Inside `validate(raw)`, replace the `appearance:` block with:

```js
    appearance: {
      theme: THEME_IDS.includes(a.theme) ? a.theme : DEFAULTS.appearance.theme,
      defaultPaneFontSize: clamp(a.defaultPaneFontSize, 10, 22, DEFAULTS.appearance.defaultPaneFontSize)
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/settings-store.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings-store.js tests/main/settings-store.test.js
git commit -m "feat(settings): add appearance.theme with sarvis-dark/bridge allowlist"
```

---

## Task 2: Mirror the theme default in the renderer's settings store

**Files:**
- Modify: `src/renderer/settings-store.js`

- [ ] **Step 1: Update the `DEFAULTS` constant**

In `src/renderer/settings-store.js`, replace:

```js
  appearance: { defaultPaneFontSize: 13 },
```

with:

```js
  appearance: { theme: 'sarvis-dark', defaultPaneFontSize: 13 },
```

This default is only used as the seed `state` before `initSettings()` resolves; the main process's validator is authoritative thereafter.

- [ ] **Step 2: Run the renderer settings tests**

Run: `npx vitest run tests/renderer/settings-migration.test.js`
Expected: PASS — existing tests still pass (the new field is additive).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings-store.js
git commit -m "feat(settings): seed renderer DEFAULTS with appearance.theme"
```

---

## Task 3: Create the theme application helper

**Files:**
- Create: `src/renderer/theme.js`
- Create: `tests/renderer/theme.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/renderer/theme.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { applyTheme, THEME_IDS, DEFAULT_THEME } from '../../src/renderer/theme.js'

beforeEach(() => {
  delete document.documentElement.dataset.theme
})

describe('theme', () => {
  it('exposes the two theme IDs', () => {
    expect(THEME_IDS).toEqual(['sarvis-dark', 'bridge'])
    expect(DEFAULT_THEME).toBe('sarvis-dark')
  })

  it('sets data-theme to bridge', () => {
    applyTheme('bridge')
    expect(document.documentElement.dataset.theme).toBe('bridge')
  })

  it('sets data-theme to sarvis-dark', () => {
    applyTheme('sarvis-dark')
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })

  it('falls back to sarvis-dark for an invalid id', () => {
    applyTheme('not-a-theme')
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })

  it('falls back to sarvis-dark for undefined', () => {
    applyTheme(undefined)
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/theme.test.js`
Expected: FAIL — `src/renderer/theme.js` doesn't exist.

- [ ] **Step 3: Implement `src/renderer/theme.js`**

```js
export const THEME_IDS = ['sarvis-dark', 'bridge']
export const DEFAULT_THEME = 'sarvis-dark'

export function applyTheme(id) {
  const safe = THEME_IDS.includes(id) ? id : DEFAULT_THEME
  document.documentElement.dataset.theme = safe
  return safe
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/theme.test.js`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/theme.js tests/renderer/theme.test.js
git commit -m "feat(theme): add applyTheme helper and theme ID constants"
```

---

## Task 4: Apply the theme at boot and on settings changes

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Import the helper and the subscription**

In `src/renderer/App.jsx`, change the `settings-store` import to include `subscribe`:

```js
import { initSettings, getSettings, subscribe as subscribeSettings } from './settings-store.js'
import { applyTheme, DEFAULT_THEME } from './theme.js'
```

- [ ] **Step 2: Apply the theme before `initSettings()` resolves**

Right above the `Promise.all([...])` block that already calls `initSettings()`, add a synchronous default so the first paint isn't an un-themed flash:

```js
    applyTheme(DEFAULT_THEME)
```

Then, in the `.then(([state, desktop]) => { ... })` callback (after `if (cancelled) return`), add:

```js
      applyTheme(getSettings().appearance?.theme)
```

- [ ] **Step 3: Subscribe to settings changes**

Add a new `useEffect` near the existing top-level effects (e.g. just below the one that does `autoNamer.subscribe(...)`). Pick a stable location:

```js
  // Live-repaint when the user switches themes in Settings.
  useEffect(() => {
    return subscribeSettings((s) => applyTheme(s.appearance?.theme))
  }, [])
```

- [ ] **Step 4: Smoke test the boot flow**

Run: `npm test`
Expected: PASS — existing tests still green.

Run: `npm run dev`
Open the app. Confirm `<html>` has `data-theme="sarvis-dark"`. No visible regression.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(theme): apply persisted theme at boot and on changes"
```

---

## Task 5: Add the Bridge palette overrides

**Files:**
- Modify: `src/renderer/design-tokens.css`

- [ ] **Step 1: Append the override block**

At the bottom of `src/renderer/design-tokens.css`, **after** the existing `:root { ... }` and animation keyframes, append:

```css
:root[data-theme='bridge'] {
  /* Surfaces — warm plum/charcoal */
  --cs-bg-base:      #282630;
  --cs-bg-surface:   #302e39;
  --cs-bg-elevated:  #393643;
  --cs-bg-sidebar:   #2c2a35;
  --cs-bg-hover:     rgba(255, 255, 255, 0.05);
  --cs-bg-active:    rgba(255, 255, 255, 0.08);

  /* Borders */
  --cs-border:       #403d4a;
  --cs-border-mid:   #514c5d;
  --cs-border-hover: #5f5a6d;
  --cs-border-focus: rgba(227, 91, 166, 0.62);

  /* Text — warm whites */
  --cs-text-primary:   rgba(248, 244, 250, 0.94);
  --cs-text-secondary: rgba(238, 232, 242, 0.76);
  --cs-text-tertiary:  rgba(218, 208, 224, 0.52);
  --cs-text-muted:     rgba(206, 195, 214, 0.35);
  --cs-text-dim:       rgba(206, 195, 214, 0.22);

  /* Icon tones — solid greys composited from text alpha over #2c2a35 */
  --cs-icon-muted:     #4b4751;
  --cs-icon-tertiary:  #6f6a76;
  --cs-icon-secondary: #b6b1bc;
  --cs-icon-primary:   #ebe7ed;

  /* Accents — note: --cs-cyan is the legacy variable name; under Bridge it is the rose/magenta primary */
  --cs-cyan:         #e15a9e;
  --cs-cyan-bg:      rgba(225, 90, 158, 0.14);
  --cs-cyan-glow:    rgba(225, 90, 158, 0.32);

  --cs-green:        #7acb85;
  --cs-green-bg:     rgba(122, 203, 133, 0.10);
  --cs-green-border: rgba(122, 203, 133, 0.24);

  --cs-amber:        #dda04c;
  --cs-violet:       #da86b9;
  --cs-red:          #e06a72;
  --cs-red-hover-bg: rgba(224, 106, 114, 0.16);
  --cs-red-hover-fg: rgba(238, 152, 158, 0.95);

  /* Status dots */
  --cs-status-live:  #7acb85;
  --cs-status-idle:  #6b6577;
  --cs-status-amber: #dda04c;
}
```

- [ ] **Step 2: Manually verify the Bridge tint loads**

Run: `npm run dev`
In DevTools, run: `document.documentElement.dataset.theme = 'bridge'`
Expected: window background warms to plum/charcoal; sidebar follows; existing components that consume `--cs-*` tokens repaint. Some surfaces (terminal, certain pane elements) will still show stale cyan/green accents — that's the audit work in Task 7.

Reset: `document.documentElement.dataset.theme = 'sarvis-dark'`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/design-tokens.css
git commit -m "feat(theme): add bridge palette token overrides"
```

---

## Task 6: Add the Theme picker to Settings → Appearance

**Files:**
- Modify: `src/renderer/components/SettingsPage.jsx`
- Modify: `src/renderer/components/SettingsPage.css`
- Test: `tests/renderer/SettingsPage.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/SettingsPage.test.jsx`:

```jsx
  it('renders a theme control with both options in the Appearance category', async () => {
    mockState.appearance.theme = 'sarvis-dark'
    render(<SettingsPage onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: /sarvis dark/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /bridge/i })).toBeTruthy()
  })

  it('marks the currently selected theme as checked', async () => {
    mockState.appearance.theme = 'bridge'
    render(<SettingsPage onClose={() => {}} />)
    const bridge = screen.getByRole('radio', { name: /bridge/i })
    expect(bridge.getAttribute('aria-checked')).toBe('true')
  })

  it('calls setSettings when a different theme is selected', async () => {
    mockState.appearance.theme = 'sarvis-dark'
    render(<SettingsPage onClose={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: /bridge/i }))
    expect(mockSetSettings).toHaveBeenCalledWith({ appearance: { theme: 'bridge' } })
  })
```

Also update the `beforeEach` fixture so it includes the new field:

```js
  mockState = {
    appearance: { theme: 'sarvis-dark', defaultPaneFontSize: 13 },
    notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
    updates: { autoUpdate: true },
    agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true },
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/SettingsPage.test.jsx`
Expected: FAIL — the theme radios don't exist yet.

- [ ] **Step 3: Add the Theme control in `SettingsPage.jsx`**

Just above the existing `appearance === 'appearance'` block in the `cs-settings-card`, replace the current single `Row` for font size with the following two rows (font size row is unchanged; theme row is new and ordered first):

```jsx
              {active === 'appearance' && (
                <>
                  <Row label="Theme" caption="Switches the whole app palette.">
                    <div className="cs-settings-theme-group" role="radiogroup" aria-label="Theme">
                      {[
                        { id: 'sarvis-dark', label: 'Sarvis Dark' },
                        { id: 'bridge',      label: 'Bridge'      },
                      ].map(t => {
                        const selected = s.appearance.theme === t.id
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`cs-settings-theme-option${selected ? ' selected' : ''}`}
                            onClick={() => update({ appearance: { theme: t.id } })}
                          >
                            <span className={`cs-settings-theme-swatch swatch-${t.id}`} aria-hidden />
                            <span>{t.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </Row>
                  <Row label="Default pane font size" caption="Applied to new terminal panes">
                    <input
                      type="range"
                      className="cs-settings-range"
                      style={{ '--fill': `${((s.appearance.defaultPaneFontSize - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%` }}
                      min={FONT_MIN}
                      max={FONT_MAX}
                      step={1}
                      value={s.appearance.defaultPaneFontSize}
                      onChange={(e) => update({ appearance: { defaultPaneFontSize: Number(e.target.value) } })}
                      aria-label="Default pane font size"
                    />
                    <span className="cs-settings-value">{s.appearance.defaultPaneFontSize}px</span>
                  </Row>
                </>
              )}
```

- [ ] **Step 4: Style the theme picker in `SettingsPage.css`**

Append to `src/renderer/components/SettingsPage.css`:

```css
.cs-settings-theme-group {
  display: flex;
  gap: 8px;
}

.cs-settings-theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 8px;
  background: transparent;
  border: 1px solid var(--cs-border-mid);
  border-radius: 8px;
  color: var(--cs-text-secondary);
  font: 500 12.5px var(--cs-font-ui);
  letter-spacing: -0.005em;
  cursor: pointer;
  transition: background var(--cs-transition), border-color var(--cs-transition), color var(--cs-transition);
}

.cs-settings-theme-option:hover {
  background: var(--cs-bg-hover);
  color: var(--cs-text-primary);
}

.cs-settings-theme-option.selected {
  border-color: var(--cs-border-focus);
  background: var(--cs-cyan-bg);
  color: var(--cs-text-primary);
}

.cs-settings-theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--cs-border);
  background: linear-gradient(135deg, var(--swatch-from) 0%, var(--swatch-from) 50%, var(--swatch-accent) 50%, var(--swatch-accent) 100%);
}

.cs-settings-theme-swatch.swatch-sarvis-dark {
  --swatch-from: #0d0f12;
  --swatch-accent: #67e8f9;
}

.cs-settings-theme-swatch.swatch-bridge {
  --swatch-from: #302e39;
  --swatch-accent: #e15a9e;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/SettingsPage.test.jsx`
Expected: PASS — all tests green.

- [ ] **Step 6: Manually verify the toggle**

Run: `npm run dev`
Open Settings → Appearance. Confirm: two theme buttons render side by side. Clicking `Bridge` flips the app to plum surfaces; clicking `Sarvis Dark` flips back. The choice persists across an app restart.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SettingsPage.jsx src/renderer/components/SettingsPage.css tests/renderer/SettingsPage.test.jsx
git commit -m "feat(settings): add Theme picker to Appearance"
```

---

## Task 7: Migrate hard-coded accent colors in component CSS to tokens

**Files:**
- Modify: each file listed below

This task replaces fixed `rgba(103, 232, 249, …)`, `rgba(134, 239, 172, …)`, `rgba(196, 181, 253, …)`, `rgba(239, 68, 68, …)`, and corresponding hex values that currently bleed Sarvis-Dark cyan/green/violet/red into components that should retint under `data-theme='bridge'`. Each substitution preserves the visual alpha as closely as possible by introducing per-alpha derived tokens where existing tokens don't match.

- [ ] **Step 1: Add the missing derived tokens to `design-tokens.css`**

In `src/renderer/design-tokens.css` `:root { ... }` block, after the existing accent tokens, add:

```css
  --cs-cyan-glow-soft:   rgba(103, 232, 249, 0.14);
  --cs-cyan-border:      rgba(103, 232, 249, 0.35);
  --cs-cyan-border-strong: rgba(103, 232, 249, 0.7);
  --cs-cyan-fill-weak:   rgba(103, 232, 249, 0.06);
  --cs-violet-border:    rgba(196, 181, 253, 0.35);
  --cs-violet-fill-weak: rgba(196, 181, 253, 0.06);
  --cs-green-strong:     rgba(134, 239, 172, 0.65);
  --cs-green-border-strong: rgba(134, 239, 172, 0.55);
  --cs-red-border:       rgba(239, 68, 68, 0.3);
  --cs-done-grad-start:  rgba(103, 232, 249, 0.62);
  --cs-done-grad-end:    rgba(134, 239, 172, 0.62);
```

In the new `:root[data-theme='bridge']` block, add Bridge-specific values for the same names:

```css
  --cs-cyan-glow-soft:     rgba(225, 90, 158, 0.10);
  --cs-cyan-border:        rgba(225, 90, 158, 0.34);
  --cs-cyan-border-strong: rgba(225, 90, 158, 0.6);
  --cs-cyan-fill-weak:     rgba(225, 90, 158, 0.06);
  --cs-violet-border:      rgba(218, 134, 185, 0.35);
  --cs-violet-fill-weak:   rgba(218, 134, 185, 0.06);
  --cs-green-strong:       rgba(122, 203, 133, 0.55);
  --cs-green-border-strong: rgba(122, 203, 133, 0.5);
  --cs-red-border:         rgba(224, 106, 114, 0.32);
  --cs-done-grad-start:    rgba(225, 90, 158, 0.55);
  --cs-done-grad-end:      rgba(122, 203, 133, 0.55);
```

- [ ] **Step 2: Replace hard-coded values across components**

For each file/line, swap the raw rgba/hex for the token. Use Find/Replace exactly as specified — every replacement is a literal substitution.

**`src/renderer/App.css`**

| Find | Replace with |
| --- | --- |
| `rgba(103,232,249,0)` | `transparent` |
| `rgba(103,232,249,0.32)` (line ~137, border-color) | `var(--cs-cyan-border)` |
| `rgba(103,232,249,0.06)` (line ~142) | `var(--cs-cyan-fill-weak)` |
| `rgba(103,232,249,0.28)` (line ~143) | `var(--cs-cyan-glow)` |
| `rgba(103,232,249,0.45)` (line ~152, border-color) | `var(--cs-cyan-glow)` |
| `rgba(103,232,249,0.16)` (line ~155) | `var(--cs-cyan-bg)` |

**`src/renderer/components/TerminalPane.css`**

| Find | Replace with |
| --- | --- |
| `rgba(103, 232, 249, 0.62) 0%,` | `var(--cs-done-grad-start) 0%,` |
| `rgba(134, 239, 172, 0.62) 100%` | `var(--cs-done-grad-end) 100%` |
| `border-bottom-color: rgba(134, 239, 172, 0.55);` | `border-bottom-color: var(--cs-green-border-strong);` |
| `border-color: rgba(103, 232, 249, 0.7);` (line ~110) | `border-color: var(--cs-cyan-border-strong);` |
| `box-shadow: 0 0 18px rgba(103, 232, 249, 0.14);` | `box-shadow: 0 0 18px var(--cs-cyan-glow-soft);` |
| `background: rgba(103, 232, 249, 0.55);` (line ~296) | `background: var(--cs-cyan-glow);` |
| `border-color: rgba(103, 232, 249, 0.35);` (line ~395) | `border-color: var(--cs-cyan-border);` |
| `background: rgba(103, 232, 249, 0.06);` (line ~396) | `background: var(--cs-cyan-fill-weak);` |
| `border-color: rgba(196, 181, 253, 0.35);` (line ~400) | `border-color: var(--cs-violet-border);` |
| `background: rgba(196, 181, 253, 0.06);` (line ~401) | `background: var(--cs-violet-fill-weak);` |

**`src/renderer/components/Onboarding.css`**

| Find | Replace with |
| --- | --- |
| `drop-shadow(0 6px 18px rgba(103, 232, 249, 0.18))` (line ~96) | `drop-shadow(0 6px 18px var(--cs-cyan-glow))` |
| `rgba(103, 232, 249, 0.55)` (line 408) | `var(--cs-cyan-border-strong)` |
| `rgba(103, 232, 249, 0.85)` (line 408) | `var(--cs-cyan)` |
| `rgba(103, 232, 249, 0.45)` (line 408) | `var(--cs-cyan-glow)` |
| `rgba(134, 239, 172, 0.4)` (line 409) | `var(--cs-green-border)` |
| `rgba(134, 239, 172, 0.7)` (line 409) | `var(--cs-green-border-strong)` |
| `rgba(134, 239, 172, 0.25)` (line 409) | `var(--cs-green-bg)` |
| `rgba(103, 232, 249, 0.12)` (line ~427) | `var(--cs-cyan-bg)` |
| `rgba(103, 232, 249, 0.4)` (line ~432) | `var(--cs-cyan-border)` |

Keep the inline `var(--cs-cyan, #67e8f9)` fallback patterns on lines 463/464/480/482/524/583/584 — those already consume tokens; the fallback hex remains as-is so the file stays valid when scanned standalone.

**`src/renderer/components/Sidebar.css`**

| Find | Replace with |
| --- | --- |
| `box-shadow: 0 0 6px rgba(134, 239, 172, 0.45);` | `box-shadow: 0 0 6px var(--cs-cyan-glow);` (use cyan-glow here so the active-workspace dot also retints under Bridge; the green token would keep it green) |
| `box-shadow: 0 0 4px rgba(134, 239, 172, 0.30);` | `box-shadow: 0 0 4px var(--cs-green-border);` |
| `box-shadow: 0 0 11px rgba(134, 239, 172, 0.65);` | `box-shadow: 0 0 11px var(--cs-green-strong);` |
| `color: #ef4444;` | `color: var(--cs-red);` |
| `drop-shadow(0 0 3px rgba(103, 232, 249, 0.25))` | `drop-shadow(0 0 3px var(--cs-cyan-glow))` |
| `drop-shadow(0 0 5px rgba(134, 239, 172, 0.4))` | `drop-shadow(0 0 5px var(--cs-green-border))` |

**`src/renderer/components/Toggle.css`**

| Find | Replace with |
| --- | --- |
| `background: rgba(103, 232, 249, 0.14);` | `background: var(--cs-cyan-bg);` |
| `border-color: rgba(103, 232, 249, 0.5);` | `border-color: var(--cs-cyan-glow);` |

**`src/renderer/components/Toolbar.css`**

| Find | Replace with |
| --- | --- |
| `background: rgba(103, 232, 249, 0.14);` | `background: var(--cs-cyan-bg);` |

**`src/renderer/components/UpdateToast.css`**

| Find | Replace with |
| --- | --- |
| `background: rgba(103, 232, 249, 0.10);` | `background: var(--cs-cyan-bg);` |
| `background: rgba(103, 232, 249, 0.18);` | `background: var(--cs-cyan-glow);` |

**`src/renderer/components/EditorResizer.css`**

| Find | Replace with |
| --- | --- |
| `background: rgba(103, 232, 249, 0.45);` | `background: var(--cs-cyan-glow);` |

**`src/renderer/components/SkillsPanelResizer.css`**

| Find | Replace with |
| --- | --- |
| `background: rgba(103, 232, 249, 0.45);` | `background: var(--cs-cyan-glow);` |

**`src/renderer/components/SkillsPanel.css`**

| Find | Replace with |
| --- | --- |
| `0 0 0 1px rgba(103, 232, 249, 0.04)` (line ~11) | `0 0 0 1px var(--cs-cyan-fill-weak)` |
| `border: 1px solid rgba(239, 68, 68, 0.3);` | `border: 1px solid var(--cs-red-border);` |

**`src/renderer/components/ConfirmDialog.css`** — these are the destructive-confirm button states. They should stay red in both themes. Migrate to existing tokens to keep them retintable in the future:

| Find | Replace with |
| --- | --- |
| `background: rgba(239, 68, 68, 0.12);` | `background: var(--cs-red-hover-bg);` |
| `border-color: rgba(239, 68, 68, 0.28);` | `border-color: var(--cs-red-border);` |
| `background: rgba(239, 68, 68, 0.18);` | `background: var(--cs-red-hover-bg);` |
| `border-color: rgba(239, 68, 68, 0.45);` | `border-color: var(--cs-red);` |
| `border-color: rgba(239, 68, 68, 0.6);` | `border-color: var(--cs-red);` |

- [ ] **Step 3: Convert inline-SVG accents to read from tokens**

`src/renderer/components/AppIcon.jsx` currently hard-codes `#67e8f9` in three `<stop>` elements and a `stroke`. Convert it to a small inline-CSS approach using `currentColor`:

Replace the four occurrences (lines ~19, 20, 21, 46) of `stopColor="#67e8f9"` and `stroke="#67e8f9"` with `stopColor="currentColor"` and `stroke="currentColor"` respectively. Then in the wrapping element, set `color: var(--cs-cyan)`. Confirm the file's wrapper has a `style` or className that sets color; if not, add:

```jsx
<svg ... style={{ color: 'var(--cs-cyan)' }}>
```

at the root `<svg>` tag.

`src/renderer/components/Sidebar.jsx` (line 87/88 — gradient stops):

```jsx
<stop offset="0%" stopColor="#67e8f9" />
<stop offset="100%" stopColor="#86efac" />
```

Replace with:

```jsx
<stop offset="0%" stopColor="var(--cs-cyan)" />
<stop offset="100%" stopColor="var(--cs-green)" />
```

Note: SVG `<stop>` elements accept `var(...)` via CSS, but for safety inside a JSX attribute string, both Chromium and Electron 31 evaluate `var()` in `stopColor`. If the gradient renders blank in dev, fall back to converting these two stops to a `<style>` block scoped by an id (`#sidebar-icon-grad stop:first-child { stop-color: var(--cs-cyan); }`).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 5: Manually verify in both themes**

Run: `npm run dev`. Toggle the theme in Settings → Appearance and walk through:
- Onboarding screen (active card pulse, launch sheen)
- Sidebar (active workspace marker, status dot, delete-hover)
- Pane grid (focused border, drag-over glow, done gradient, exited state)
- Editor (resizer hover line)
- Skills panel (focus shadow, error border)
- Confirm dialog (destructive button)
- Toolbar new-workspace pill, Update toast
- AppIcon and Sidebar gradient icon

In **Sarvis Dark**, every surface should look identical to before this PR. In **Bridge**, accents should be rose/magenta with green and amber retained for status — no leftover cyan should appear anywhere.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/design-tokens.css src/renderer/App.css src/renderer/components/*.css src/renderer/components/*.jsx
git commit -m "feat(theme): migrate hard-coded accents to semantic tokens"
```

---

## Task 8: Read xterm colors from CSS tokens and live-update on theme change

**Files:**
- Create: `src/renderer/terminal-theme.js`
- Create: `tests/renderer/terminal-theme.test.js`
- Modify: `src/renderer/hooks/useTerminal.js`
- Modify: `src/renderer/design-tokens.css` (add Bridge-specific xterm ANSI overrides)
- Modify: `src/renderer/App.jsx` (thread `themeId` into `TerminalPane`)
- Modify: `src/renderer/components/TerminalPane.jsx` (forward `themeId` to `useTerminal`)

- [ ] **Step 1: Add xterm-only tokens to the token sheet**

xterm `ITheme` needs solid hex values, not rgba (some xterm color paths choke on alpha). Add to `:root` in `design-tokens.css`:

```css
  /* xterm — solid hex values; alpha lives on the layer above */
  --cs-term-bg:        #0d0f12;
  --cs-term-fg:        #d9d9da;
  --cs-term-cursor:    #d9d9da;
  --cs-term-selection: rgba(255, 255, 255, 0.12);
  --cs-term-black:     #0a0a0a;
  --cs-term-bright-black: #3f3f3f;
  --cs-term-red:       #f87171;
  --cs-term-bright-red: #fca5a5;
  --cs-term-green:     #86efac;
  --cs-term-bright-green: #bbf7d0;
  --cs-term-yellow:    #fcd34d;
  --cs-term-bright-yellow: #fde68a;
  --cs-term-blue:      #93c5fd;
  --cs-term-bright-blue: #bfdbfe;
  --cs-term-magenta:   #c4b5fd;
  --cs-term-bright-magenta: #ddd6fe;
  --cs-term-cyan:      #67e8f9;
  --cs-term-bright-cyan: #a5f3fc;
  --cs-term-white:     #c6c7c8;
  --cs-term-bright-white: #ebebec;
```

Add to `:root[data-theme='bridge']`:

```css
  --cs-term-bg:        #302e39;
  --cs-term-fg:        #ebe7ed;
  --cs-term-cursor:    #ebe7ed;
  --cs-term-selection: rgba(225, 90, 158, 0.20);
  --cs-term-black:     #1a1822;
  --cs-term-bright-black: #524d5d;
  --cs-term-red:       #e06a72;
  --cs-term-bright-red: #ee989e;
  --cs-term-green:     #7acb85;
  --cs-term-bright-green: #a3dca9;
  --cs-term-yellow:    #dda04c;
  --cs-term-bright-yellow: #eac178;
  --cs-term-blue:      #9ec5f4;
  --cs-term-bright-blue: #bcd9f8;
  --cs-term-magenta:   #da86b9;
  --cs-term-bright-magenta: #ecb1d2;
  --cs-term-cyan:      #82d2c1;
  --cs-term-bright-cyan: #b1e2d6;
  --cs-term-white:     #b6b1bc;
  --cs-term-bright-white: #ebe7ed;
```

- [ ] **Step 2: Write the failing tests for `terminal-theme.js`**

```js
// tests/renderer/terminal-theme.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTerminalTheme } from '../../src/renderer/terminal-theme.js'

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: (name) => {
      switch (name) {
        case '--cs-term-bg':         return ' #111213 '
        case '--cs-term-fg':         return ' #abcdef '
        case '--cs-term-cursor':     return ' #fedcba '
        case '--cs-term-selection':  return ' rgba(1,2,3,0.4) '
        case '--cs-term-black':      return ' #000001 '
        case '--cs-term-bright-black': return ' #000002 '
        case '--cs-term-red':        return ' #111111 '
        case '--cs-term-bright-red': return ' #222222 '
        case '--cs-term-green':      return ' #333333 '
        case '--cs-term-bright-green': return ' #444444 '
        case '--cs-term-yellow':     return ' #555555 '
        case '--cs-term-bright-yellow': return ' #666666 '
        case '--cs-term-blue':       return ' #777777 '
        case '--cs-term-bright-blue': return ' #888888 '
        case '--cs-term-magenta':    return ' #999999 '
        case '--cs-term-bright-magenta': return ' #aaaaaa '
        case '--cs-term-cyan':       return ' #bbbbbb '
        case '--cs-term-bright-cyan': return ' #cccccc '
        case '--cs-term-white':      return ' #dddddd '
        case '--cs-term-bright-white': return ' #eeeeee '
        default:                     return ''
      }
    }
  }))
})

describe('buildTerminalTheme', () => {
  it('reads xterm tokens from the document root and trims them', () => {
    const t = buildTerminalTheme()
    expect(t.background).toBe('#111213')
    expect(t.foreground).toBe('#abcdef')
    expect(t.cursor).toBe('#fedcba')
    expect(t.cursorAccent).toBe('#111213') // matches background
    expect(t.selectionBackground).toBe('rgba(1,2,3,0.4)')
    expect(t.green).toBe('#333333')
    expect(t.brightCyan).toBe('#cccccc')
  })

  it('falls back to the Sarvis-Dark default when a token is empty', () => {
    // mockImplementation (not Once) — buildTerminalTheme calls getComputedStyle
    // once per token, so every call needs the empty getter.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: () => ''
    }))
    const t = buildTerminalTheme()
    expect(t.background).toBe('#0d0f12')
    expect(t.cyan).toBe('#67e8f9')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/terminal-theme.test.js`
Expected: FAIL — `src/renderer/terminal-theme.js` doesn't exist.

- [ ] **Step 4: Implement `src/renderer/terminal-theme.js`**

```js
function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTerminalTheme() {
  const bg = readToken('--cs-term-bg', '#0d0f12')
  return {
    background: bg,
    foreground: readToken('--cs-term-fg', 'rgba(255,255,255,0.85)'),
    cursor: readToken('--cs-term-cursor', 'rgba(255,255,255,0.8)'),
    cursorAccent: bg,
    selectionBackground: readToken('--cs-term-selection', 'rgba(255,255,255,0.12)'),
    black:         readToken('--cs-term-black',         '#0a0a0a'),
    brightBlack:   readToken('--cs-term-bright-black',  '#3f3f3f'),
    red:           readToken('--cs-term-red',           '#f87171'),
    brightRed:     readToken('--cs-term-bright-red',    '#fca5a5'),
    green:         readToken('--cs-term-green',         '#86efac'),
    brightGreen:   readToken('--cs-term-bright-green',  '#bbf7d0'),
    yellow:        readToken('--cs-term-yellow',        '#fcd34d'),
    brightYellow:  readToken('--cs-term-bright-yellow', '#fde68a'),
    blue:          readToken('--cs-term-blue',          '#93c5fd'),
    brightBlue:    readToken('--cs-term-bright-blue',   '#bfdbfe'),
    magenta:       readToken('--cs-term-magenta',       '#c4b5fd'),
    brightMagenta: readToken('--cs-term-bright-magenta','#ddd6fe'),
    cyan:          readToken('--cs-term-cyan',          '#67e8f9'),
    brightCyan:    readToken('--cs-term-bright-cyan',   '#a5f3fc'),
    white:         readToken('--cs-term-white',         'rgba(255,255,255,0.78)'),
    brightWhite:   readToken('--cs-term-bright-white',  'rgba(255,255,255,0.92)'),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/terminal-theme.test.js`
Expected: PASS — both tests green.

- [ ] **Step 6: Wire `buildTerminalTheme()` into `useTerminal.js`**

In `src/renderer/hooks/useTerminal.js`:

1. Add an import at the top:

```js
import { buildTerminalTheme } from '../terminal-theme.js'
```

2. Add `themeId` as a parameter of the hook signature (last positional argument):

```js
export default function useTerminal(termId, ptyId, shell, cwd, containerRef, onActivity, onUserInput, onPtyReady, fontSize, onFontSizeChange, linkOpts, themeId) {
```

3. Replace the inline `theme: { ... }` object inside `new Terminal({ ... })` with:

```js
        theme: buildTerminalTheme()
```

(delete the whole inline color block — lines 67–89 in the current file).

4. Add a new effect, just below the existing `useEffect` that handles `fontSize` changes:

```js
  // When the app theme changes, repaint the xterm palette in-place — no PTY
  // restart, no buffer loss. Tokens are read fresh from CSS.
  useEffect(() => {
    if (!themeId || !termRef.current) return
    termRef.current.options.theme = buildTerminalTheme()
  }, [themeId])
```

- [ ] **Step 7: Thread `themeId` into `TerminalPane`**

In `src/renderer/components/TerminalPane.jsx`, find the `useTerminal(...)` invocation and add `themeId` as the trailing argument. The pane already accepts a `themeId` prop in this step — declare it in the destructured props:

```jsx
export default function TerminalPane({ ..., themeId, ... }) {
  ...
  const { error, exitCode } = useTerminal(
    termId, ptyId, shell, cwd, containerRef,
    onActivity, onUserInput, onPtyReady,
    fontSize, onFontSizeChange, linkOpts,
    themeId,
  )
```

In `src/renderer/App.jsx`, derive the current theme from settings and pass it down to every `TerminalPane`:

```jsx
  const themeId = useSyncExternalStore(
    subscribeSettings,
    () => getSettings().appearance?.theme || DEFAULT_THEME
  )

  // ... wherever <TerminalPane ... /> is rendered:
  <TerminalPane
    ...existing props
    themeId={themeId}
  />
```

(Use the existing `useSyncExternalStore` import already present in App.jsx.)

- [ ] **Step 8: Manually verify the live xterm repaint**

Run: `npm run dev`. Spawn at least one workspace with running Claude agents. Switch theme in Settings.
Expected: xterm background, foreground, and ANSI colors flip immediately; running output continues uninterrupted; no scrollback is lost.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/terminal-theme.js tests/renderer/terminal-theme.test.js src/renderer/hooks/useTerminal.js src/renderer/components/TerminalPane.jsx src/renderer/App.jsx src/renderer/design-tokens.css
git commit -m "feat(theme): live-repaint xterm palette from CSS tokens"
```

---

## Task 9: Move CodeMirror syntax colors to tokens and reconfigure on theme change

**Files:**
- Modify: `src/renderer/codemirror-theme.js`
- Modify: `src/renderer/hooks/useEditor.js`
- Modify: `src/renderer/components/EditorPane.jsx` (forward `themeId` to `useEditor`)
- Modify: `src/renderer/design-tokens.css` (add CodeMirror syntax tokens)

- [ ] **Step 1: Add CodeMirror syntax tokens**

In `:root` of `design-tokens.css`:

```css
  /* CodeMirror syntax */
  --cs-cm-keyword:    #67e8f9;
  --cs-cm-string:     #86efac;
  --cs-cm-number:     #f59e0b;
  --cs-cm-type:       #67e8f9;
  --cs-cm-tag:        #67e8f9;
  --cs-cm-attribute:  #86efac;
  --cs-cm-comment:    rgba(255,255,255,0.28);
  --cs-cm-selection:  rgba(103, 232, 249, 0.18);
```

In `:root[data-theme='bridge']`:

```css
  --cs-cm-keyword:    #da86b9;
  --cs-cm-string:     #7acb85;
  --cs-cm-number:     #dda04c;
  --cs-cm-type:       #da86b9;
  --cs-cm-tag:        #e15a9e;
  --cs-cm-attribute:  #7acb85;
  --cs-cm-comment:    rgba(206, 195, 214, 0.35);
  --cs-cm-selection:  rgba(225, 90, 158, 0.20);
```

- [ ] **Step 2: Update `codemirror-theme.js` to read from tokens**

Replace the entire body of `src/renderer/codemirror-theme.js` with:

```js
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTheme() {
  const bg        = readToken('--cs-bg-surface',   '#0d0f12')
  const sidebarBg = readToken('--cs-bg-sidebar',   '#0a0c0f')
  const border    = readToken('--cs-border',       '#1b1e24')
  const cyan      = readToken('--cs-cyan',         '#67e8f9')
  const muted     = readToken('--cs-text-muted',   'rgba(255,255,255,0.28)')
  const primary   = readToken('--cs-text-primary', 'rgba(255,255,255,0.92)')
  const selection = readToken('--cs-cm-selection', 'rgba(103, 232, 249, 0.18)')
  const fontMono  = readToken('--cs-font-mono',    'ui-monospace, monospace')

  return EditorView.theme({
    '&': {
      backgroundColor: bg,
      color: primary,
      fontFamily: fontMono,
      height: '100%',
    },
    '.cm-content':       { caretColor: cyan, padding: '8px 0' },
    '.cm-cursor':        { borderLeftColor: cyan, borderLeftWidth: '1.5px' },
    '.cm-selectionBackground, ::selection': { backgroundColor: selection },
    '.cm-activeLine':       { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: sidebarBg,
      color: muted,
      borderRight: `1px solid ${border}`,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: fontMono,
      fontVariantNumeric: 'tabular-nums',
      padding: '0 8px',
    },
    '&.cm-focused':         { outline: 'none' },
    '.cm-scroller':         { fontFamily: fontMono, lineHeight: '1.55' },
  }, { dark: true })
}

export function buildHighlightStyle() {
  const keyword   = readToken('--cs-cm-keyword',   '#67e8f9')
  const string    = readToken('--cs-cm-string',    '#86efac')
  const number    = readToken('--cs-cm-number',    '#f59e0b')
  const type      = readToken('--cs-cm-type',      '#67e8f9')
  const tag       = readToken('--cs-cm-tag',       '#67e8f9')
  const attribute = readToken('--cs-cm-attribute', '#86efac')
  const comment   = readToken('--cs-cm-comment',   'rgba(255,255,255,0.28)')
  const primary   = readToken('--cs-text-primary', 'rgba(255,255,255,0.92)')
  const secondary = readToken('--cs-text-secondary','rgba(255,255,255,0.78)')
  const tertiary  = readToken('--cs-text-tertiary','rgba(255,255,255,0.42)')

  return syntaxHighlighting(HighlightStyle.define([
    { tag: t.keyword,                       color: keyword },
    { tag: [t.string, t.special(t.string)], color: string },
    { tag: t.comment,                       color: comment, fontStyle: 'italic' },
    { tag: [t.number, t.bool, t.null],      color: number },
    { tag: t.variableName,                  color: primary },
    { tag: t.function(t.variableName),      color: primary },
    { tag: t.typeName,                      color: type },
    { tag: t.propertyName,                  color: secondary },
    { tag: t.operator,                      color: tertiary },
    { tag: t.punctuation,                   color: tertiary },
    { tag: t.tagName,                       color: tag },
    { tag: t.attributeName,                 color: attribute },
  ]))
}
```

- [ ] **Step 3: Add a theme Compartment to `useEditor.js`**

In `src/renderer/hooks/useEditor.js`:

1. Add a new ref for the theme compartment alongside `fontCompartmentRef`:

```js
  const themeCompartmentRef = useRef(new Compartment())
```

2. Add `themeId` to the hook's parameter destructuring:

```js
export default function useEditor({ hostRef, file, content, isPlain, fontSize, themeId, onSave, onDirtyChange, onChange, onScroll }) {
```

3. Inside the `extensions: [ ... ]` array, replace:

```js
          buildTheme(),
          buildHighlightStyle(),
```

with:

```js
          themeCompartmentRef.current.of([buildTheme(), buildHighlightStyle()]),
```

4. Add a new effect just below the font-size effect:

```js
  // Reconfigure the editor theme + highlight style when the app theme changes,
  // without rebuilding the view (preserves doc, selection, scroll position).
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({
      effects: themeCompartmentRef.current.reconfigure([buildTheme(), buildHighlightStyle()])
    })
  }, [themeId])
```

- [ ] **Step 4: Thread `themeId` into `EditorPane`**

In `src/renderer/components/EditorPane.jsx`, accept a `themeId` prop and forward it to `useEditor({ ... })`. In `src/renderer/App.jsx`, pass `themeId={themeId}` to the `<EditorPane>` render alongside the existing props.

- [ ] **Step 5: Manually verify the editor repaint**

Run: `npm run dev`. Open a `.jsx` or `.json` file in the editor. Switch theme. Expected: gutter, background, syntax colors, cursor, and selection all flip; cursor position and scroll are preserved; undo history is preserved.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing and new tests green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/codemirror-theme.js src/renderer/hooks/useEditor.js src/renderer/components/EditorPane.jsx src/renderer/App.jsx src/renderer/design-tokens.css
git commit -m "feat(theme): live-repaint CodeMirror via Compartment reconfiguration"
```

---

## Task 10: Final verification and build

**Files:** none (verification only)

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: 0 failures.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build with no warnings about missing tokens or invalid references.

- [ ] **Step 3: Manual acceptance pass**

Launch `npm run dev`. Verify every acceptance criterion in the spec:

- Default install opens in **Sarvis Dark**. (Confirm with a fresh user-data folder if possible; otherwise verify by deleting `appearance.theme` from `settings.json` and relaunching.)
- Settings → Appearance shows the **Theme** picker with two options, in that order.
- Selecting **Bridge** repaints the running app immediately — including any open xterm sessions and any open editor file.
- Selecting **Sarvis Dark** flips back.
- Relaunching the app preserves the choice.
- Walk through onboarding, the populated workspace grid (focused/done/exited panes), open editor, open Skills panel, open Settings, open ConfirmDialog — every surface is in the chosen theme with no leftover cyan in Bridge.

- [ ] **Step 4: Commit any trailing fixes if needed, otherwise tag the branch**

If the manual pass surfaced a stray hard-coded color, fix it as a follow-up commit. Otherwise:

```bash
git log --oneline -10
```

and confirm the feature commits are present.

---

## Self-Review Notes (for the implementer)

- **Spec coverage check:** Every acceptance criterion maps to at least one task. Settings shape → Task 1+2; selector UI → Task 6; live repaint → Tasks 4, 8, 9; default fallback → Tasks 1, 3, 4; token coverage → Tasks 5, 7, 8, 9; non-goals (no new layouts/features) → respected by scope.
- **Naming inconsistency that is intentional:** `--cs-cyan` retains its name under Bridge even though the color is rose/magenta. The spec acknowledges this and rejects a broad rename in this PR to keep the diff bounded. A future cleanup can introduce `--cs-accent-primary` as an alias.
- **SVG token consumption:** SVG attributes can consume `var(--cs-cyan)` in current Chromium. If Electron's renderer rejects it for any element, fall back to `currentColor` + setting `color: var(--cs-cyan)` on the wrapping element (already noted in Task 7 Step 3).
- **Why no PTY restart:** xterm exposes `term.options.theme` as a mutable property — assigning a new theme object triggers a repaint of the existing buffer without touching the underlying stream. CodeMirror uses Compartments for the same reason — `dispatch({ effects: ... })` reconfigures without destroying state.
