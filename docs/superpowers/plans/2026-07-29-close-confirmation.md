# Close Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodeSpace ask for confirmation before closing, so a misclick on the titlebar X cannot kill every running agent.

**Architecture:** The main process intercepts `win.on('close')` and calls `preventDefault()`, then asks the renderer to prompt. The renderer draws the existing `ConfirmDialog` and only an explicit confirm sends `win:confirmClose`, which releases the guard and re-enters `win.close()`. Three escape hatches (crashed renderer, no-ack timeout, `before-quit`) make sure the guard can never trap the user in a running app.

**Tech Stack:** Electron (main + preload + renderer), React 18, Vitest with jsdom, @testing-library/react 16.

**Spec:** `docs/superpowers/specs/2026-07-29-close-confirmation-design.md`

## Global Constraints

- The confirmation is **unconditional**. No setting, no "don't ask again" checkbox, no skipping when idle.
- **Never** add or modify a setting in `src/main/settings-store.js` for this feature.
- Default focus in the close dialog is the **cancel** button. A stray Enter or Space must not close the app.
- Prose in dialog copy uses a natural human voice and contains **no em-dashes** (`—`).
- Reuse the existing `ConfirmDialog`. Do **not** use `dialog.showMessageBox` or build a second dialog component.
- No new CSS files. `ConfirmDialog.css` already styles everything, including `.cd-emphasis`.
- Existing `ConfirmDialog` call sites in `App.jsx` (3 of them) must keep their current focus behavior.
- New renderer tests go in `tests/renderer/`, main-process tests in `tests/main/`. (This supersedes the spec's `tests/components/` paths; `tests/renderer/` is the live convention, last touched 2026-05-27 vs 2026-05-10.)
- Run tests with `npm test` (vitest run). Single file: `npx vitest run <path>`.

## Deviations from the spec

Two refinements found while reading the code. Both are improvements, not scope changes:

1. **The guard lives in its own module,** `src/main/close-guard.js`, not inline in `index.js`. `index.js` is an entry point full of side effects and cannot be unit tested. A module taking `win` matches the existing `registerHandlers(win)` pattern and makes the spec's own test list achievable.
2. **`ConfirmDialog` needs more than an `initialFocus` prop.** Its Enter handler currently fires `onConfirm` whenever focus is anywhere inside the card. With cancel focused that would still close the app, defeating the whole feature. Task 2 routes Enter to whichever button actually holds focus.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/close-guard.js` | **New.** The whole guard state machine. Owns `allowClose`, the ack timer, and the three IPC/app hooks. |
| `src/main/index.js` | Calls `installCloseGuard(win)`. No logic. |
| `src/preload/index.js` | Adds `onCloseRequested`, `closePrompted`, `confirmClose` to the bridge. |
| `src/renderer/hooks/useCloseGuard.js` | **New.** Subscribes to the request, acks, exposes `{ closeRequested, cancelClose, confirmClose }`. No copy, no markup. |
| `src/renderer/components/CloseConfirm.jsx` | **New.** Turns `workspaces` into a summary and renders `ConfirmDialog`. Owns all the copy. |
| `src/renderer/components/ConfirmDialog.jsx` | Gains `initialFocus` and per-button Enter routing. |
| `src/renderer/path-resolver.js` | Gains an exported `basename`, currently duplicated as a private function in `App.jsx`. |
| `src/renderer/App.jsx` | Calls the hook, renders `<CloseConfirm>` in both render branches. |

---

### Task 1: Share `basename` from `path-resolver`

`App.jsx` has a private `basename` at line 1167. `CloseConfirm` needs the same helper, so lift it into `path-resolver.js` (which already holds `isAbsolutePath` and `resolvePath`) rather than copying it.

**Files:**
- Modify: `src/renderer/path-resolver.js`
- Modify: `src/renderer/App.jsx:1167-1171` (delete local function), plus one new import
- Test: `tests/path-resolver.test.js` (existing file, append)

**Interfaces:**
- Consumes: nothing
- Produces: `export function basename(p: string | null): string` from `src/renderer/path-resolver.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/path-resolver.test.js`. Add `basename` to the existing import from `../src/renderer/path-resolver.js`.

```js
describe('basename', () => {
  it('returns the last segment of a Windows path', () => {
    expect(basename('C:\\Users\\TJ\\project\\notes.md')).toBe('notes.md')
  })

  it('returns the last segment of a POSIX path', () => {
    expect(basename('/home/tj/project/notes.md')).toBe('notes.md')
  })

  it('returns the input unchanged when there is no separator', () => {
    expect(basename('notes.md')).toBe('notes.md')
  })

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(basename(null)).toBe('')
    expect(basename(undefined)).toBe('')
    expect(basename('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/path-resolver.test.js`
Expected: FAIL with "basename is not a function" or an import error.

- [ ] **Step 3: Add the implementation**

Append to `src/renderer/path-resolver.js`:

```js
export function basename(p) {
  if (!p) return ''
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/path-resolver.test.js`
Expected: PASS

- [ ] **Step 5: Switch App.jsx to the shared helper**

In `src/renderer/App.jsx`, add to the import block near the top (after the `editor-state.js` import):

```js
import { basename } from './path-resolver.js'
```

Then delete the private function at the bottom of the file (lines 1167-1171):

```js
function basename(p) {
  if (!p) return ''
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}
```

Leave every `basename(...)` call site in `App.jsx` untouched. They now resolve to the import.

- [ ] **Step 6: Run the full suite to verify nothing regressed**

Run: `npm test`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/path-resolver.js src/renderer/App.jsx tests/path-resolver.test.js
git commit -m "refactor(renderer): share basename from path-resolver"
```

---

### Task 2: `initialFocus` and safe Enter routing in `ConfirmDialog`

Today the dialog focuses confirm on mount, and its global Enter handler fires `onConfirm` whenever focus sits anywhere inside the card. For a misclick guard both are wrong. After this task, Enter activates *whichever button holds focus*, and `initialFocus` picks the starting button.

The three existing call sites in `App.jsx` pass no `initialFocus`, so they keep confirm-focused, Enter-confirms behavior.

**Files:**
- Modify: `src/renderer/components/ConfirmDialog.jsx`
- Test: `tests/renderer/ConfirmDialog.test.jsx` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `ConfirmDialog` accepts a new prop `initialFocus: 'confirm' | 'cancel'`, default `'confirm'`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/ConfirmDialog.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ConfirmDialog from '../../src/renderer/components/ConfirmDialog.jsx'

function setup(props = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const onExtra = vi.fn()
  render(
    <ConfirmDialog
      message="Are you sure?"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      onExtra={onExtra}
      {...props}
    />
  )
  return { onConfirm, onCancel, onExtra }
}

describe('ConfirmDialog focus', () => {
  it('focuses the confirm button by default', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
  })

  it('focuses the cancel button when initialFocus is "cancel"', () => {
    setup({ initialFocus: 'cancel' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
})

describe('ConfirmDialog keyboard', () => {
  it('confirms on Enter when confirm holds focus', () => {
    const { onConfirm, onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Enter when cancel holds focus, and never confirms', () => {
    const { onConfirm, onCancel } = setup({ initialFocus: 'cancel' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fires onExtra on Enter when the extra button holds focus', () => {
    const { onConfirm, onExtra } = setup({ extraLabel: 'Discard' })
    screen.getByRole('button', { name: 'Discard' }).focus()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onExtra).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Enter when focus is outside the dialog', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { onConfirm, onCancel } = setup()
    outside.focus()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    outside.remove()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/ConfirmDialog.test.jsx`
Expected: FAIL. The `initialFocus` tests fail because confirm is always focused; the "cancels on Enter" test fails because `onConfirm` is called instead.

- [ ] **Step 3: Add the refs and the `initialFocus` prop**

In `src/renderer/components/ConfirmDialog.jsx`, add `initialFocus = 'confirm'` to the destructured props (after `destructive = false`), and add two refs next to the existing ones:

```js
const confirmRef = useRef(null)
const cancelRef = useRef(null)
const extraRef = useRef(null)
const cardRef = useRef(null)
```

Replace the mount-focus effect:

```js
useEffect(() => {
  const target = initialFocus === 'cancel' ? cancelRef.current : confirmRef.current
  target?.focus()
}, [initialFocus])
```

Attach the refs in the JSX: `ref={cancelRef}` on the `.cd-cancel` button and `ref={extraRef}` on the `.cd-extra` button. The `.cd-confirm` button already has `ref={confirmRef}`.

- [ ] **Step 4: Route Enter to the focused button**

Replace the key handler effect body. `preventDefault()` suppresses the browser's native Enter-activates-the-focused-button behavior, so the callback fires exactly once.

```js
useEffect(() => {
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel?.()
      return
    }
    if (e.key !== 'Enter') return
    // Only act when focus is actually inside the dialog. Otherwise an Enter
    // typed elsewhere (e.g. into a terminal) would dismiss it.
    const card = cardRef.current
    const active = document.activeElement
    if (!card || (card !== active && !card.contains(active))) return
    e.preventDefault()
    // Route to whichever button holds focus. Enter must never confirm just
    // because the dialog is open; the close guard focuses cancel on purpose.
    if (active === cancelRef.current) onCancel?.()
    else if (active === extraRef.current) onExtra?.()
    else onConfirm?.()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [onCancel, onConfirm, onExtra])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/ConfirmDialog.test.jsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. Confirms the three existing `App.jsx` call sites are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/ConfirmDialog.jsx tests/renderer/ConfirmDialog.test.jsx
git commit -m "feat(dialog): add initialFocus and route Enter to the focused button"
```

---

### Task 3: The close guard module

The whole state machine, isolated so it can be unit tested. Nothing here knows about React or dialog copy.

**Files:**
- Create: `src/main/close-guard.js`
- Test: `tests/main/close-guard.test.js` (create)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const CLOSE_PROMPT_TIMEOUT_MS = 1500`
  - `export function installCloseGuard(win, options?: { timeoutMs?: number }): void`
  - Sends `win:close-requested` to `win.webContents`
  - Listens on `ipcMain` channels `win:closePrompted` and `win:confirmClose`

- [ ] **Step 1: Write the failing test**

Create `tests/main/close-guard.test.js`. The `vi.mock('electron', ...)` pattern matches `tests/ipc-handlers.test.js`.

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { on: vi.fn() }
}))

import { app, ipcMain } from 'electron'
import { installCloseGuard } from '../../src/main/close-guard.js'

function makeWin() {
  const handlers = {}
  return {
    handlers,
    on: vi.fn((event, fn) => { handlers[event] = fn }),
    close: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isCrashed: vi.fn(() => false)
    }
  }
}

// The guard registers via ipcMain.on / app.on; pull the callbacks back out.
function ipcHandler(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call?.[1]
}
function appHandler(event) {
  const call = app.on.mock.calls.find(c => c[0] === event)
  return call?.[1]
}
function fireClose(win) {
  const event = { preventDefault: vi.fn() }
  win.handlers.close(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('installCloseGuard', () => {
  it('blocks the first close and asks the renderer to prompt', () => {
    const win = makeWin()
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('win:close-requested')
    expect(win.close).not.toHaveBeenCalled()
  })

  it('restores and focuses a minimized window before prompting', () => {
    const win = makeWin()
    win.isMinimized.mockReturnValue(true)
    installCloseGuard(win)
    fireClose(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('closes for real once the renderer confirms', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:confirmClose')()
    expect(win.close).toHaveBeenCalledTimes(1)
    const second = fireClose(win)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('lets a programmatic quit through without prompting', () => {
    const win = makeWin()
    installCloseGuard(win)
    appHandler('before-quit')()
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('does not trap the user when the renderer has crashed', () => {
    const win = makeWin()
    win.webContents.isCrashed.mockReturnValue(true)
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('does not trap the user when the renderer is destroyed', () => {
    const win = makeWin()
    win.webContents.isDestroyed.mockReturnValue(true)
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('closes anyway when the renderer never acks', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    expect(win.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(win.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the window open once the renderer acks', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:closePrompted')()
    vi.advanceTimersByTime(10000)
    expect(win.close).not.toHaveBeenCalled()
  })

  it('prompts again on a later close after the user cancelled', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:closePrompted')()
    // User cancels: no IPC at all, the guard just stays armed.
    const second = fireClose(win)
    expect(second.preventDefault).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('honours a custom timeout', () => {
    const win = makeWin()
    installCloseGuard(win, { timeoutMs: 50 })
    fireClose(win)
    vi.advanceTimersByTime(50)
    expect(win.close).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/close-guard.test.js`
Expected: FAIL, cannot resolve `../../src/main/close-guard.js`.

- [ ] **Step 3: Write the implementation**

Create `src/main/close-guard.js`:

```js
import { app, ipcMain } from 'electron'

// How long we wait for the renderer to acknowledge the prompt request before
// assuming it is frozen and closing anyway. A guard that can trap the user in
// a running app is worse than no guard.
export const CLOSE_PROMPT_TIMEOUT_MS = 1500

/**
 * Intercept window close so the renderer can confirm first.
 *
 * Covers every close path at once: the titlebar X (which routes through
 * win:close), Alt+F4, taskbar right-click, and the taskbar hover-preview X.
 */
export function installCloseGuard(win, { timeoutMs = CLOSE_PROMPT_TIMEOUT_MS } = {}) {
  let allowClose = false
  let promptTimer = null

  const clearTimer = () => {
    if (promptTimer) {
      clearTimeout(promptTimer)
      promptTimer = null
    }
  }

  win.on('close', (e) => {
    if (allowClose) return
    const wc = win.webContents
    // Nothing can draw the dialog, so don't block the close.
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return

    e.preventDefault()
    if (win.isMinimized()) win.restore()
    win.focus()
    wc.send('win:close-requested')

    clearTimer()
    promptTimer = setTimeout(() => {
      promptTimer = null
      allowClose = true
      win.close()
    }, timeoutMs)
  })

  // The renderer received the request, so it is alive and pumping IPC.
  ipcMain.on('win:closePrompted', clearTimer)

  ipcMain.on('win:confirmClose', () => {
    clearTimer()
    allowClose = true
    win.close()
  })

  // Programmatic quits must not hit the dialog. Without this,
  // autoUpdater.quitAndInstall() would stall on the confirmation.
  app.on('before-quit', () => {
    clearTimer()
    allowClose = true
  })
}
```

Cancel deliberately sends no IPC. The guard simply stays armed until the next close attempt, which starts a fresh cycle.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/close-guard.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/close-guard.js tests/main/close-guard.test.js
git commit -m "feat(main): add close guard state machine"
```

---

### Task 4: Wire the guard into main and preload

Pure wiring. `ipcMain.on('win:close')` stays exactly as it is, so `Toolbar.jsx` and `Onboarding.jsx` need no edits at all: their existing `windowClose()` calls now land on the guard like every other close path.

**Files:**
- Modify: `src/main/index.js` (import + one call, near line 105)
- Modify: `src/preload/index.js` (three additions near line 30)

**Interfaces:**
- Consumes: `installCloseGuard(win)` from `src/main/close-guard.js` (Task 3)
- Produces on `window.electronAPI`:
  - `onCloseRequested(callback: () => void): () => void` — returns an unsubscribe function
  - `closePrompted(): void`
  - `confirmClose(): void`

- [ ] **Step 1: Import the guard in main**

In `src/main/index.js`, add to the imports alongside the other `./` main-process modules:

```js
import { installCloseGuard } from './close-guard.js'
```

- [ ] **Step 2: Install it**

In `createWindow()`, directly after the existing `registerHandlers(win)` line and before the `ipcMain.on('win:minimize', ...)` block:

```js
registerHandlers(win)
installCloseGuard(win)
```

Leave `ipcMain.on('win:close', () => win.close())` untouched.

- [ ] **Step 3: Extend the preload bridge**

In `src/preload/index.js`, inside the `api` object, immediately after the existing `onMaximizeChanged` entry:

```js
onCloseRequested: (callback) => {
  const handler = () => callback()
  ipcRenderer.on('win:close-requested', handler)
  return () => ipcRenderer.removeListener('win:close-requested', handler)
},
closePrompted:    () => ipcRenderer.send('win:closePrompted'),
confirmClose:     () => ipcRenderer.send('win:confirmClose'),
```

- [ ] **Step 4: Verify the build compiles all three targets**

Run: `npm run build`
Expected: exit 0, `out/main`, `out/preload`, and `out/renderer` all written with no import errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat(main): install close guard and expose close IPC to the renderer"
```

---

### Task 5: The `useCloseGuard` hook

Owns the renderer half of the handshake and nothing else. No copy, no markup.

**Files:**
- Create: `src/renderer/hooks/useCloseGuard.js`
- Test: `tests/renderer/useCloseGuard.test.js` (create)

**Interfaces:**
- Consumes: `window.electronAPI.onCloseRequested`, `.closePrompted`, `.confirmClose` (Task 4)
- Produces: `export default function useCloseGuard(): { closeRequested: boolean, cancelClose: () => void, confirmClose: () => void }`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/useCloseGuard.test.js`:

```js
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useCloseGuard from '../../src/renderer/hooks/useCloseGuard.js'

let fireCloseRequested
let api

beforeEach(() => {
  fireCloseRequested = null
  api = {
    onCloseRequested: vi.fn((cb) => {
      fireCloseRequested = cb
      return vi.fn()
    }),
    closePrompted: vi.fn(),
    confirmClose: vi.fn()
  }
  window.electronAPI = api
})

afterEach(() => {
  delete window.electronAPI
})

describe('useCloseGuard', () => {
  it('starts with no close requested', () => {
    const { result } = renderHook(() => useCloseGuard())
    expect(result.current.closeRequested).toBe(false)
    expect(api.closePrompted).not.toHaveBeenCalled()
  })

  it('flags a close request and acks main immediately', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    expect(result.current.closeRequested).toBe(true)
    expect(api.closePrompted).toHaveBeenCalledTimes(1)
  })

  it('clears the flag on cancel without telling main to close', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.cancelClose())
    expect(result.current.closeRequested).toBe(false)
    expect(api.confirmClose).not.toHaveBeenCalled()
  })

  it('tells main to close on confirm', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.confirmClose())
    expect(api.confirmClose).toHaveBeenCalledTimes(1)
    expect(result.current.closeRequested).toBe(false)
  })

  it('re-arms after a cancel', () => {
    const { result } = renderHook(() => useCloseGuard())
    act(() => fireCloseRequested())
    act(() => result.current.cancelClose())
    act(() => fireCloseRequested())
    expect(result.current.closeRequested).toBe(true)
    expect(api.closePrompted).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    api.onCloseRequested.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useCloseGuard())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does not throw when electronAPI is unavailable', () => {
    delete window.electronAPI
    expect(() => renderHook(() => useCloseGuard())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/useCloseGuard.test.js`
Expected: FAIL, cannot resolve `../../src/renderer/hooks/useCloseGuard.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/hooks/useCloseGuard.js`:

```js
import { useCallback, useEffect, useState } from 'react'

/**
 * Renderer half of the close handshake. Main blocks the close and asks us to
 * prompt; we ack so main knows we are alive, then surface closeRequested so
 * the caller can render the dialog.
 */
export default function useCloseGuard() {
  const [closeRequested, setCloseRequested] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCloseRequested) return undefined
    return api.onCloseRequested(() => {
      // Receiving this at all proves the renderer is pumping IPC, which is
      // exactly what the ack means. No reason to wait for paint.
      api.closePrompted?.()
      setCloseRequested(true)
    })
  }, [])

  const cancelClose = useCallback(() => setCloseRequested(false), [])

  const confirmClose = useCallback(() => {
    setCloseRequested(false)
    window.electronAPI?.confirmClose?.()
  }, [])

  return { closeRequested, cancelClose, confirmClose }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/useCloseGuard.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useCloseGuard.js tests/renderer/useCloseGuard.test.js
git commit -m "feat(renderer): add useCloseGuard hook"
```

---

### Task 6: The `CloseConfirm` component

Owns the summary logic and every word of the copy. Rendered in both of App.jsx's branches, which is why it is a component rather than inline JSX.

Copy rules, from the Global Constraints: natural human voice, no em-dashes, singular and plural both handled.

**Files:**
- Create: `src/renderer/components/CloseConfirm.jsx`
- Test: `tests/renderer/CloseConfirm.test.jsx` (create)

**Interfaces:**
- Consumes: `ConfirmDialog` with `initialFocus` (Task 2), `basename` from `../path-resolver.js` (Task 1)
- Produces:
  - `export function closeSummary(workspaces): { agents: number, activeWorkspaces: number, dirty: string[] }`
  - `export default function CloseConfirm({ workspaces, onCancel, onConfirm })`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/CloseConfirm.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CloseConfirm, { closeSummary } from '../../src/renderer/components/CloseConfirm.jsx'

function ws(overrides = {}) {
  return { id: 'w1', name: 'Repo', terminals: [], editor: { open: false, file: null, dirty: false }, ...overrides }
}
function term(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}` }))
}
function setup(workspaces) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<CloseConfirm workspaces={workspaces} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('closeSummary', () => {
  it('counts agents and only the workspaces that have them', () => {
    const s = closeSummary([
      ws({ id: 'a', terminals: term(3) }),
      ws({ id: 'b', terminals: term(1) }),
      ws({ id: 'c', terminals: [] })
    ])
    expect(s.agents).toBe(4)
    expect(s.activeWorkspaces).toBe(2)
  })

  it('collects dirty file names across all workspaces', () => {
    const s = closeSummary([
      ws({ id: 'a', editor: { file: 'C:\\repo\\App.jsx', dirty: true } }),
      ws({ id: 'b', editor: { file: 'C:\\repo\\clean.js', dirty: false } })
    ])
    expect(s.dirty).toEqual(['App.jsx'])
  })

  it('returns zeroes for an empty or missing list', () => {
    expect(closeSummary([])).toEqual({ agents: 0, activeWorkspaces: 0, dirty: [] })
    expect(closeSummary()).toEqual({ agents: 0, activeWorkspaces: 0, dirty: [] })
  })
})

describe('CloseConfirm', () => {
  it('always asks before closing', () => {
    setup([])
    expect(screen.getByText('Close CodeSpace?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument()
  })

  it('focuses Stay so a stray Enter cannot close the app', () => {
    setup([ws({ terminals: term(2) })])
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus()
  })

  it('reports plural agents across plural workspaces', () => {
    setup([ws({ id: 'a', terminals: term(3) }), ws({ id: 'b', terminals: term(1) })])
    expect(screen.getByText(/4 agents are running across 2 workspaces/)).toBeInTheDocument()
  })

  it('reports a single agent in a single workspace', () => {
    setup([ws({ terminals: term(1) })])
    expect(screen.getByText(/1 agent is running in 1 workspace/)).toBeInTheDocument()
  })

  it('names unsaved files', () => {
    setup([ws({ terminals: term(1), editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(screen.getByText('App.jsx')).toBeInTheDocument()
  })

  it('says nothing is running when no agents are spawned', () => {
    setup([ws({ terminals: [] })])
    expect(screen.getByText(/Nothing is running right now/)).toBeInTheDocument()
  })

  it('marks the confirm destructive only when agents are running', () => {
    const { unmount } = render(
      <CloseConfirm workspaces={[ws({ terminals: term(1) })]} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toHaveClass('destructive')
    unmount()
    setup([ws({ terminals: [] })])
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).not.toHaveClass('destructive')
  })

  it('uses no em-dashes in its copy', () => {
    setup([ws({ terminals: term(2), editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(document.body.textContent).not.toContain('\u2014')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/CloseConfirm.test.jsx`
Expected: FAIL, cannot resolve `../../src/renderer/components/CloseConfirm.jsx`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/CloseConfirm.jsx`:

```jsx
import ConfirmDialog from './ConfirmDialog.jsx'
import { basename } from '../path-resolver.js'

/**
 * What the user actually stands to lose. Terminals spawn lazily on first
 * workspace activation, so a persisted-but-never-opened workspace counts zero.
 */
export function closeSummary(workspaces = []) {
  let agents = 0
  let activeWorkspaces = 0
  const dirty = []

  for (const w of workspaces) {
    const count = w?.terminals?.length ?? 0
    if (count > 0) {
      agents += count
      activeWorkspaces += 1
    }
    if (w?.editor?.dirty && w.editor.file) dirty.push(basename(w.editor.file))
  }

  return { agents, activeWorkspaces, dirty }
}

export default function CloseConfirm({ workspaces, onCancel, onConfirm }) {
  const { agents, activeWorkspaces, dirty } = closeSummary(workspaces)
  const running = agents > 0

  const unsaved = dirty.length > 0 && (
    <>your unsaved edits to <strong className="cd-emphasis">{dirty.join(', ')}</strong> will be lost</>
  )

  let message
  if (running) {
    message = (
      <>
        {agents === 1 ? '1 agent is' : `${agents} agents are`} running{' '}
        {activeWorkspaces === 1 ? 'in 1 workspace' : `across ${activeWorkspaces} workspaces`}.
        {' '}Closing stops {agents === 1 ? 'it' : 'all of them'}
        {unsaved && <>, and {unsaved}</>}.
      </>
    )
  } else if (dirty.length > 0) {
    // Barely reachable, since the editor lives inside an activated workspace,
    // but cheap to get right rather than claim nothing is at stake.
    message = <>Closing now means {unsaved}.</>
  } else {
    message = <>Nothing is running right now.</>
  }

  return (
    <ConfirmDialog
      title="Close CodeSpace?"
      message={message}
      confirmLabel="Close CodeSpace"
      cancelLabel="Stay"
      initialFocus="cancel"
      destructive={running}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/CloseConfirm.test.jsx`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/CloseConfirm.jsx tests/renderer/CloseConfirm.test.jsx
git commit -m "feat(renderer): add CloseConfirm dialog"
```

---

### Task 7: Wire the dialog into App.jsx

App.jsx early-returns `<Onboarding>` at line 924, above the tree holding the other dialogs, so the close dialog has to be rendered in both branches.

**Files:**
- Modify: `src/renderer/App.jsx` (imports, one hook call, both render branches)

**Interfaces:**
- Consumes: `useCloseGuard()` (Task 5), `CloseConfirm` (Task 6)
- Produces: nothing downstream

- [ ] **Step 1: Add the imports**

In `src/renderer/App.jsx`, alongside the other component imports:

```js
import CloseConfirm from './components/CloseConfirm.jsx'
```

and with the hook imports:

```js
import useCloseGuard from './hooks/useCloseGuard.js'
```

- [ ] **Step 2: Call the hook**

Near the other top-level hook calls in the `App` component body, before the early returns:

```js
const { closeRequested, cancelClose, confirmClose } = useCloseGuard()
```

- [ ] **Step 3: Render it in the onboarding branch**

Replace the early return at line 924:

```jsx
if (workspaces.length === 0) {
  return (
    <>
      <Onboarding onLaunch={handleOnboardingLaunch} />
      {closeRequested && (
        <CloseConfirm
          workspaces={workspaces}
          onCancel={cancelClose}
          onConfirm={confirmClose}
        />
      )}
    </>
  )
}
```

Leave the `if (!loaded) return null` branch above it alone. Nothing is running that early, and main's ack timeout covers it.

- [ ] **Step 4: Render it in the main branch**

In the main `return (...)`, inside the root `<div className="app">`, immediately after the closing `)}` of the `pendingDirtyAction` block and before the final `</div>`:

```jsx
{closeRequested && (
  <CloseConfirm
    workspaces={workspaces}
    onCancel={cancelClose}
    onConfirm={confirmClose}
  />
)}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(app): confirm before closing from both render branches"
```

---

### Task 8: Manual verification

Unit tests cover the state machine and the copy, but they cannot prove Alt+F4 reaches the guard or that the dialog paints correctly. This runs the real app.

**Files:** none

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Wait for the window. Create a workspace with at least 2 agents so the dialog has something to report.

- [ ] **Step 2: Check every close path**

Each of these must show "Close CodeSpace?" rather than quitting:

- Click the titlebar X
- Press Alt+F4
- Right-click the taskbar icon and choose "Close window"
- Hover the taskbar icon and click the X on the preview thumbnail

For the last two, confirm the window comes to the front with the dialog visible, rather than prompting behind other windows.

- [ ] **Step 3: Check the dialog behaves**

- "Stay" dismisses it and the app keeps running, with agents still alive
- Escape dismisses it the same way
- The Stay button is focused on open, and pressing Enter immediately dismisses rather than closing
- The message reports the right agent and workspace counts
- Dirty an editor file, reopen the dialog, confirm the filename is named
- "Close CodeSpace" actually closes the app

- [ ] **Step 4: Check it re-arms**

Cancel the dialog, then press Alt+F4 again. The dialog must appear a second time.

- [ ] **Step 5: Check the onboarding branch**

Delete every workspace so the standalone `Onboarding` screen shows, then click its X. The dialog must appear over the onboarding screen and read "Nothing is running right now."

- [ ] **Step 6: Confirm no orphaned processes**

Close the app for real via the dialog, then check Task Manager for leftover `claude.exe`, `powershell.exe`, or `electron.exe`. The existing `will-quit` PTY cleanup should be unaffected by the guard.

- [ ] **Step 7: Commit any fixes**

If anything above needed a fix, commit it with a `fix(close):` prefix. If everything passed, nothing to commit.

---

## Done

After Task 8, the feature is complete. Run `npm test` one last time for a clean full-suite result, then use `superpowers:finishing-a-development-branch` to decide how to integrate.
