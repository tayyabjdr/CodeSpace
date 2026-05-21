# Full-Page Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the centered settings modal with a full-page settings view — a left nav rail of categories and a content panel centered in a 720px column.

**Architecture:** A new `SettingsPage` component renders as a fixed overlay covering the app body below the 42px title bar. The workspace grid stays mounted underneath. It owns the active-category state and renders four category panels inline, reusing the existing `Toggle` component and `settings-store`.

**Tech Stack:** React, Vitest + @testing-library/react, plain CSS with `--cs-*` design tokens.

**Spec:** `docs/superpowers/specs/2026-05-22-settings-page-design.md`

---

## File Structure

- **Create** `src/renderer/components/SettingsPage.css` — the full stylesheet for the page.
- **Create** `src/renderer/components/SettingsPage.jsx` — nav rail, active-category state, Esc/close handling, four category panels, the `Row` primitive.
- **Create** `tests/renderer/SettingsPage.test.jsx` — component tests.
- **Modify** `src/renderer/App.jsx` — swap `SettingsModal` for `SettingsPage` (1 import line + 1 render line).
- **Delete** `src/renderer/components/SettingsModal.jsx`, `src/renderer/components/SettingsModal.css`.
- **Reused unchanged:** `src/renderer/components/Toggle.jsx`, `src/renderer/settings-store.js`.

---

## Task 1: Stylesheet (`SettingsPage.css`)

**Files:**
- Create: `src/renderer/components/SettingsPage.css`

- [ ] **Step 1: Create the stylesheet**

Create `src/renderer/components/SettingsPage.css` with exactly this content:

```css
/* Full-page settings — a fixed overlay covering the app body below the
   42px title bar. The workspace grid stays mounted underneath. */
.cs-settings-page {
  position: fixed;
  top: var(--cs-toolbar-h);
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  background: var(--cs-bg-base);
  color: var(--cs-text-primary);
  font-family: var(--cs-font-ui);
  animation: fadeIn 200ms ease;
  color-scheme: dark;
}

/* Nav rail */
.cs-settings-nav {
  width: 188px;
  flex-shrink: 0;
  background: var(--cs-bg-sidebar);
  border-right: 1px solid var(--cs-border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px 12px;
}
.cs-settings-nav-head {
  margin: 0 6px 14px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--cs-text-primary);
}
.cs-settings-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  margin-bottom: 2px;
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  position: relative;
  font-family: var(--cs-font-ui);
  font-size: 12.5px;
  color: var(--cs-text-tertiary);
  transition: background var(--cs-transition), color var(--cs-transition);
}
.cs-settings-nav-item svg {
  flex-shrink: 0;
  color: var(--cs-icon-tertiary);
  transition: color var(--cs-transition);
}
.cs-settings-nav-item:hover {
  background: var(--cs-bg-hover);
  color: var(--cs-text-secondary);
}
.cs-settings-nav-item:hover svg { color: var(--cs-icon-secondary); }
.cs-settings-nav-item.active {
  background: var(--cs-bg-active);
  color: var(--cs-text-primary);
}
.cs-settings-nav-item.active svg { color: var(--cs-icon-primary); }
.cs-settings-nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
  background: #fff;
}
.cs-settings-nav-item:focus-visible {
  outline: 1px solid var(--cs-border-focus);
  outline-offset: -1px;
}

/* Content region */
.cs-settings-content {
  flex: 1;
  position: relative;
  overflow-y: auto;
  background: var(--cs-bg-base);
}
.cs-settings-close {
  position: absolute;
  top: 13px;
  right: 13px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 7px;
  color: var(--cs-icon-tertiary);
  cursor: pointer;
  transition: background var(--cs-transition), color var(--cs-transition);
}
.cs-settings-close:hover {
  background: var(--cs-red-hover-bg);
  color: var(--cs-red-hover-fg);
}
.cs-settings-close:focus-visible {
  outline: 1px solid var(--cs-border-focus);
  outline-offset: 1px;
}

/* Centered column */
.cs-settings-col {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 32px 48px;
}
.cs-settings-panel {
  animation: slideUp 0.22s ease both;
}
.cs-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--cs-text-primary);
}
.cs-settings-desc {
  margin: 4px 0 18px;
  font-size: 12px;
  color: var(--cs-text-tertiary);
}

/* Card holding the rows */
.cs-settings-card {
  background: var(--cs-bg-surface);
  border: 1px solid var(--cs-border);
  border-radius: 12px;
  overflow: hidden;
}

/* Row */
.cs-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 15px 17px;
  min-height: 32px;
}
.cs-settings-row + .cs-settings-row {
  border-top: 1px solid var(--cs-border);
}
.cs-settings-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--cs-text-primary);
  font-size: 13px;
  min-width: 0;
}
.cs-settings-caption {
  font-size: 11.5px;
  color: var(--cs-text-muted);
  line-height: 1.5;
}
.cs-settings-caption code {
  font-family: var(--cs-font-mono);
  font-size: 11px;
  background: var(--cs-bg-elevated);
  color: var(--cs-text-primary);
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
}
.cs-settings-control {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.cs-settings-value {
  font-family: var(--cs-font-mono);
  font-size: 11px;
  color: var(--cs-text-tertiary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  min-width: 42px;
  text-align: right;
}
.cs-settings-value.error { color: var(--cs-red); }

/* Update status line — sits below the rows inside the card */
.cs-settings-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 17px;
  border-top: 1px solid var(--cs-border);
  font-size: 11.5px;
  color: var(--cs-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* Version pill — cyan glowing meta with a leading dot */
.cs-settings-version-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--cs-font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--cs-cyan);
  text-decoration: none;
  text-shadow: 0 0 12px var(--cs-cyan-glow);
  transition: color var(--cs-transition);
}
.cs-settings-version-link::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--cs-cyan);
  box-shadow: 0 0 8px var(--cs-cyan-glow);
}
.cs-settings-version-link:hover { color: #a5f3fc; }

/* Button — matches .ob-browse-btn from onboarding */
.cs-settings-btn {
  font-family: var(--cs-font-ui);
  font-size: 11.5px;
  font-weight: 500;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--cs-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.01em;
  transition: background var(--cs-transition), border-color var(--cs-transition), color var(--cs-transition);
}
.cs-settings-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  color: var(--cs-text-primary);
}
.cs-settings-btn:focus-visible {
  outline: 1px solid var(--cs-cyan);
  outline-offset: 2px;
}

/* Custom range slider — cyan track fill, glowing thumb */
.cs-settings-range {
  appearance: none;
  -webkit-appearance: none;
  width: 160px;
  height: 18px;
  background: transparent;
  cursor: pointer;
  padding: 0;
  margin: 0;
  --thumb-size: 12px;
  --track-h: 3px;
}
.cs-settings-range::-webkit-slider-runnable-track {
  height: var(--track-h);
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--cs-cyan) 0%,
    var(--cs-cyan) var(--fill, 50%),
    var(--cs-border-mid) var(--fill, 50%),
    var(--cs-border-mid) 100%
  );
}
.cs-settings-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 999px;
  background: var(--cs-bg-base);
  border: 2px solid var(--cs-cyan);
  margin-top: calc((var(--track-h) - var(--thumb-size)) / 2);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 8px var(--cs-cyan-glow);
  cursor: grab;
  transition: transform 120ms ease, box-shadow var(--cs-transition);
}
.cs-settings-range:hover::-webkit-slider-thumb { transform: scale(1.15); }
.cs-settings-range:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.2); }
.cs-settings-range:focus-visible { outline: none; }
.cs-settings-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px var(--cs-cyan-glow), 0 0 12px var(--cs-cyan-glow);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/SettingsPage.css
git commit -m "feat: add SettingsPage stylesheet"
```

---

## Task 2: Component (`SettingsPage.jsx`)

**Files:**
- Create: `src/renderer/components/SettingsPage.jsx`
- Test: `tests/renderer/SettingsPage.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/SettingsPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSetSettings = vi.fn(() => Promise.resolve({}))
let mockState

vi.mock('../../src/renderer/settings-store.js', () => ({
  getSettings: () => mockState,
  setSettings: (patch) => mockSetSettings(patch),
  subscribe: () => () => {},
}))

import SettingsPage from '../../src/renderer/components/SettingsPage.jsx'

beforeEach(() => {
  mockState = {
    appearance: { defaultPaneFontSize: 13 },
    notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
    updates: { autoUpdate: true },
    agents: { dangerouslySkipPermissions: true, codexDangerouslyBypassApprovals: true },
  }
  mockSetSettings.mockClear()
  window.electronAPI = {
    getAppVersion: () => Promise.resolve('1.3.1'),
    checkForUpdates: () => Promise.resolve({ status: 'up-to-date' }),
    openExternal: vi.fn(),
  }
})

describe('SettingsPage', () => {
  it('renders the Appearance category by default', () => {
    render(<SettingsPage onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByLabelText('Default pane font size')).toBeTruthy()
  })

  it('switches category when a nav item is clicked', async () => {
    render(<SettingsPage onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /agents/i }))
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByLabelText('Skip permission prompts')).toBeTruthy()
  })

  it('calls setSettings when a toggle is changed', async () => {
    render(<SettingsPage onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await userEvent.click(screen.getByLabelText('Flash taskbar on done'))
    expect(mockSetSettings).toHaveBeenCalledWith({ notifications: { taskbarFlashOnDone: false } })
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<SettingsPage onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close settings/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/SettingsPage.test.jsx`
Expected: FAIL — cannot resolve `../../src/renderer/components/SettingsPage.jsx`.

- [ ] **Step 3: Write the component**

Create `src/renderer/components/SettingsPage.jsx` with exactly this content:

```jsx
import { useEffect, useState } from 'react'
import Toggle from './Toggle.jsx'
import { getSettings, setSettings, subscribe } from '../settings-store.js'
import './SettingsPage.css'

const FONT_MIN = 10
const FONT_MAX = 22

const RELEASES_URL = (v) => `https://github.com/tayyabjdr/CodeSpace/releases/tag/v${v}`

const AppearanceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)
const NotificationsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
)
const AgentsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </svg>
)
const UpdatesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </svg>
)
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

const CATEGORIES = [
  { id: 'appearance',    label: 'Appearance',    Icon: AppearanceIcon,    description: 'How terminal panes look.' },
  { id: 'notifications', label: 'Notifications', Icon: NotificationsIcon, description: 'Alerts when an agent finishes.' },
  { id: 'agents',        label: 'Agents',        Icon: AgentsIcon,        description: 'How agent CLIs are launched.' },
  { id: 'updates',       label: 'Updates',       Icon: UpdatesIcon,       description: 'Keep CodeSpace up to date.' },
]

export default function SettingsPage({ onClose }) {
  const [s, setS] = useState(getSettings())
  const [active, setActive] = useState('appearance')
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)

  useEffect(() => subscribe(setS), [])

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = (patch) => {
    setSettings(patch).catch((err) => console.warn('[settings] save failed:', err))
  }

  const onCheckUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    const res = await window.electronAPI?.checkForUpdates?.()
    setUpdateStatus(res ?? { status: 'error', message: 'No response' })
  }

  const activeCategory = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]

  return (
    <div className="cs-settings-page">
      <nav className="cs-settings-nav">
        <div className="cs-settings-nav-head">Settings</div>
        {CATEGORIES.map((cat) => {
          const { Icon } = cat
          return (
            <button
              key={cat.id}
              type="button"
              className={`cs-settings-nav-item${active === cat.id ? ' active' : ''}`}
              aria-current={active === cat.id ? 'page' : undefined}
              onClick={() => setActive(cat.id)}
            >
              <Icon />
              <span>{cat.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="cs-settings-content">
        <button
          type="button"
          className="cs-settings-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="cs-settings-col">
          <div className="cs-settings-panel" key={active}>
            <h1 className="cs-settings-title">{activeCategory.label}</h1>
            <p className="cs-settings-desc">{activeCategory.description}</p>
            <div className="cs-settings-card">
              {active === 'appearance' && (
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
              )}

              {active === 'notifications' && (
                <>
                  <Row label="Done sound volume">
                    <input
                      type="range"
                      className="cs-settings-range"
                      style={{ '--fill': `${s.notifications.doneSoundVolume}%` }}
                      min={0}
                      max={100}
                      value={s.notifications.doneSoundVolume}
                      onChange={(e) => update({ notifications: { doneSoundVolume: Number(e.target.value) } })}
                      aria-label="Done sound volume"
                    />
                    <span className="cs-settings-value">{s.notifications.doneSoundVolume}%</span>
                  </Row>
                  <Row label="Flash taskbar on done">
                    <Toggle
                      checked={s.notifications.taskbarFlashOnDone}
                      onChange={(v) => update({ notifications: { taskbarFlashOnDone: v } })}
                      ariaLabel="Flash taskbar on done"
                    />
                  </Row>
                </>
              )}

              {active === 'agents' && (
                <>
                  <Row
                    label="Skip permission prompts"
                    caption={<>Runs <code>claude</code> with <code>--dangerously-skip-permissions</code></>}
                  >
                    <Toggle
                      checked={s.agents.dangerouslySkipPermissions}
                      onChange={(v) => update({ agents: { dangerouslySkipPermissions: v } })}
                      ariaLabel="Skip permission prompts"
                    />
                  </Row>
                  <Row
                    label="Codex — bypass approvals and sandbox"
                    caption={<>Runs <code>codex</code> with <code>--dangerously-bypass-approvals-and-sandbox</code></>}
                  >
                    <Toggle
                      checked={s.agents.codexDangerouslyBypassApprovals}
                      onChange={(v) => update({ agents: { codexDangerouslyBypassApprovals: v } })}
                      ariaLabel="Codex bypass approvals and sandbox"
                    />
                  </Row>
                </>
              )}

              {active === 'updates' && (
                <>
                  <Row label="Version">
                    <div className="cs-settings-control">
                      {version ? (
                        <a
                          href="#"
                          className="cs-settings-version-link"
                          onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.(RELEASES_URL(version)) }}
                        >v{version}</a>
                      ) : <span className="cs-settings-value">—</span>}
                      <button type="button" className="cs-settings-btn" onClick={onCheckUpdates}>
                        Check
                      </button>
                    </div>
                  </Row>
                  <Row label="Auto-update">
                    <Toggle
                      checked={s.updates.autoUpdate}
                      onChange={(v) => update({ updates: { autoUpdate: v } })}
                      ariaLabel="Auto-update"
                    />
                  </Row>
                  {updateStatus && (
                    <div className="cs-settings-status">
                      {updateStatus.status === 'checking' && <span>Checking…</span>}
                      {updateStatus.status === 'downloading' && <span>Downloading v{updateStatus.version}…</span>}
                      {updateStatus.status === 'up-to-date' && <span>Up to date</span>}
                      {updateStatus.status === 'error' && <span className="cs-settings-value error">Couldn't check for updates</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, caption, children }) {
  return (
    <div className="cs-settings-row">
      <div className="cs-settings-label">
        <span>{label}</span>
        {caption && <span className="cs-settings-caption">{caption}</span>}
      </div>
      <div className="cs-settings-control">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/SettingsPage.test.jsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsPage.jsx tests/renderer/SettingsPage.test.jsx
git commit -m "feat: add full-page SettingsPage component"
```

---

## Task 3: Integrate into `App.jsx`, delete the old modal

**Files:**
- Modify: `src/renderer/App.jsx`
- Delete: `src/renderer/components/SettingsModal.jsx`, `src/renderer/components/SettingsModal.css`

- [ ] **Step 1: Confirm `SettingsModal` is referenced only by `App.jsx`**

Run a search for `SettingsModal` across `src/` and `tests/`.
Expected: matches only in `src/renderer/App.jsx` and the two `SettingsModal.*` files themselves. If anything else references it, stop and report — the plan assumed only `App.jsx` imports it.

- [ ] **Step 2: Update the import in `App.jsx`**

In `src/renderer/App.jsx`, find this line (around line 9):

```js
import SettingsModal from './components/SettingsModal.jsx'
```

Replace it with:

```js
import SettingsPage from './components/SettingsPage.jsx'
```

- [ ] **Step 3: Update the render in `App.jsx`**

In `src/renderer/App.jsx`, find this line (around line 1052):

```jsx
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

Replace it with:

```jsx
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
```

- [ ] **Step 4: Delete the old modal files**

```bash
git rm src/renderer/components/SettingsModal.jsx src/renderer/components/SettingsModal.css
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: Build completes with no errors for all three targets.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat: replace settings modal with full-page settings"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — all suites green, including the new `tests/renderer/SettingsPage.test.jsx` (5 tests). No previously-passing test regresses. There must be no remaining test referencing `SettingsModal`.

- [ ] **Step 2: Manual check — open and navigate**

Run `npm run dev`. With at least one workspace present, click the settings control in the left sidebar.

Verify:
- The settings view fills the whole body below the 42px title bar; the title bar and its window controls stay visible and usable.
- The left nav rail shows "Settings" and four items — Appearance, Notifications, Agents, Updates — with Appearance active (white accent bar at its left edge).
- Clicking each nav item switches the content; the active item moves; content is centered in a column that does not exceed 720px wide.
- The close × is at the top-right of the content area.

- [ ] **Step 3: Manual check — controls and close**

- Appearance: drag the font-size slider — the value readout updates and the cyan fill tracks.
- Notifications: the volume slider and the "Flash taskbar on done" toggle both work.
- Agents: both toggles flip.
- Updates: the version pill shows `vX.Y.Z` and the "Check" button produces a status line.
- Press Esc — settings closes and the workspace grid is revealed unchanged (terminals still running). Reopen, then click the close × — it closes the same way.

- [ ] **Step 4: Commit (only if Steps 1–3 surfaced fixes)**

If any step required a code change, commit it:

```bash
git add -A
git commit -m "fix: address settings page verification findings"
```

If no fixes were needed, skip this step.

---

## Self-Review Notes

- **Spec coverage:** architecture as a fixed overlay below the title bar with the grid mounted underneath (Task 2 component + Task 3 render gate + Task 1 `position: fixed; top: var(--cs-toolbar-h)`); nav rail with white active accent (Tasks 1–2); content centered at 720px (Task 1 `.cs-settings-col`); close × + Esc (Task 2); the four categories with their exact controls (Task 2); design-token styling, accent restraint, no flanking rules (Task 1); behavior — open via existing Sidebar trigger, persistence via `settings-store`, updates check (Tasks 2–3); deletion of the old modal (Task 3); tests (Task 2).
- **Reused primitives:** `Toggle.jsx` and `settings-store.js` are imported unchanged; the range-slider / version-pill / button CSS is migrated into `SettingsPage.css`.
- **Naming consistency:** the component is `SettingsPage` and the prop is `onClose` in the spec, the component, the test, and the `App.jsx` render. CSS classes are all `cs-settings-*`. The category ids (`appearance`, `notifications`, `agents`, `updates`) match between `CATEGORIES`, the `active` state default, and the panel conditionals.
- **No automated test for `App.jsx`:** the one-import + one-line render swap is covered by the Task 3 build check and the Task 4 manual run, consistent with how `App.jsx` is treated elsewhere in this codebase.
