# Close Confirmation — Design Spec

**Date:** 2026-07-29
**Status:** Approved (verbal sign-off, "A" → "yes" → "continue")

## Problem

The titlebar X calls `windowClose()` → `win:close` → `win.close()` with no guard. One misclick kills every running agent across every workspace, plus any unsaved editor changes. The X sits a few pixels from the maximize button in a frameless titlebar, so this is easy to do by accident.

Alt+F4, taskbar right-click → Close, and the taskbar hover-preview X bypass the renderer entirely, so a guard on the button alone would only be half a fix.

## Solution

Main process intercepts `win.on('close')` and asks the renderer to prompt. The renderer draws the existing `ConfirmDialog`. Only an explicit confirm re-enters `win.close()` with the guard released.

## Decisions (locked)

| Question | Decision |
|---|---|
| When it prompts | Always. Not conditional on running agents or dirty state. |
| Opt-out | None. No setting, no "don't ask again" checkbox. |
| Where the guard lives | Main process, so every close path is covered by one check. |
| Dialog | Existing `ConfirmDialog`, not a native `dialog.showMessageBox`. |
| Default focus | Cancel, not confirm. A stray Enter must not close the app. |
| Message | Adapts to what is actually at stake (agent count, dirty file). |
| Destructive styling | When agents are running, or when there are unsaved editor changes. |

## Architecture

### Main — `src/main/index.js`

```js
let allowClose = false
let promptTimer = null

win.on('close', (e) => {
  if (allowClose) return
  const wc = win.webContents
  if (wc.isDestroyed() || wc.isCrashed()) return   // can't prompt → don't trap
  e.preventDefault()
  if (win.isMinimized()) win.restore()
  win.focus()
  wc.send('win:close-requested')
  clearTimeout(promptTimer)
  promptTimer = setTimeout(() => { allowClose = true; win.close() }, 1500)
})

ipcMain.on('win:closePrompted', () => { clearTimeout(promptTimer); promptTimer = null })
ipcMain.on('win:confirmClose',  () => { allowClose = true; win.close() })

app.on('before-quit', () => { allowClose = true })
```

Three safety valves, because a guard that can trap the user in a running app is worse than no guard:

1. **Crashed or destroyed renderer** — nothing can draw the dialog, so the close passes straight through.
2. **Frozen renderer** — the renderer acks with `win:closePrompted`. No ack within 1500ms means it is not processing IPC, and main closes anyway.
3. **Programmatic quit** — `before-quit` releases the guard. Without this, `autoUpdater.quitAndInstall()` (`src/main/auto-updater.js:52`) would trip the confirm dialog during an update install.

Cancel needs no IPC. Main stays in its `preventDefault` state until the next close attempt, which starts a fresh cycle.

### Preload — `src/preload/index.js`

Three additions next to the existing `windowClose`:

```js
onCloseRequested: (cb) => { /* subscribe + return unsubscribe, matching onMaximizeChanged */ },
closePrompted:    () => ipcRenderer.send('win:closePrompted'),
confirmClose:     () => ipcRenderer.send('win:confirmClose'),
```

### Renderer

**`src/renderer/hooks/useCloseGuard.js`** (new) — subscribes to `onCloseRequested`, sends the ack from the handler itself (receiving the message is proof the renderer is alive, so there is no reason to wait for paint), and exposes:

```js
{ closeRequested, cancelClose, confirmClose }
```

**`src/renderer/components/CloseConfirm.jsx`** (new) — composes the message from `workspaces` and renders `ConfirmDialog`. Owning the copy here keeps App.jsx from growing and lets both render branches share one instance.

**`src/renderer/components/ConfirmDialog.jsx`** (modified) — add an `initialFocus` prop, `'confirm' | 'cancel'`, defaulting to `'confirm'`. The three existing call sites in App.jsx are unchanged. The mount effect focuses the matching ref, and the Enter handler fires confirm only when focus is inside the card, which it already does.

**`src/renderer/App.jsx`** (modified) — call `useCloseGuard()` once, then render `<CloseConfirm>` in both branches. The `workspaces.length === 0` early return at line 924 sits above the tree holding the other dialogs, so the onboarding branch becomes a fragment:

```jsx
if (workspaces.length === 0) {
  return (
    <>
      <Onboarding onLaunch={handleOnboardingLaunch} />
      {closeRequested && <CloseConfirm ... />}
    </>
  )
}
```

**Unchanged:** `ipcMain.on('win:close')` keeps forwarding to `win.close()`, so `Toolbar.jsx` and `Onboarding.jsx` need no edits. Their existing `windowClose()` calls now land on the guard like any other close path.

## Dialog copy

Title: **Close CodeSpace?**

| State | Message |
|---|---|
| Agents running | "4 agents are running across 2 workspaces. Closing stops all of them." |
| Agents running + dirty editor | "…all of them, and your unsaved edits to `foo.js` will be lost." |
| Nothing spawned | "Nothing is running right now." |

Singular and plural forms are both handled ("1 agent is running in 1 workspace").

Confirm label: **Close CodeSpace**. Cancel label: **Stay**. `destructive` only when the running-agent count is above zero, so the common case stays quiet and the red carries meaning when it appears.

Counting: an agent is any terminal in `workspace.terminals`. Terminals spawn lazily on first workspace activation, so a persisted-but-never-opened workspace contributes zero. Dirty files come from `workspace.editor.dirty && workspace.editor.file`, checked across all workspaces rather than just the active one.

## Covered close paths

- Titlebar X
- Alt+F4
- Taskbar right-click → Close window
- Taskbar hover-preview X
- `win.close()` from any future main-process caller

## Accepted gaps

- **Close during the `!loaded` null render** (roughly the first 100ms of launch) skips the prompt. There is no tree to draw into, so `useCloseGuard` is gated on `loaded` and deliberately ignores the request: it does not ack and does not set `closeRequested`. That leaves main's 1500ms failsafe timer as the only thing watching, and it fires and closes the window unprompted. Nothing is running that early, so nothing is lost. The load effect's `Promise.all` also carries a `.catch()` now, so a rejected load still flips `loaded` to true instead of leaving the window stuck in this state, and therefore reliant on the failsafe, indefinitely.
- **OS shutdown and restart.** Windows can force-close an app that blocks shutdown. Not worth special handling, since the OS is closing everything anyway.

## Testing

New suites alongside the existing ones.

`tests/main/close-guard.test.js`:
- First close is prevented and sends `win:close-requested`
- Close after `win:confirmClose` passes through
- Close after `before-quit` passes through
- Close passes through when `webContents.isCrashed()` is true
- Timeout closes the window when no ack arrives
- Ack cancels the timeout
- Cancel then re-close starts a fresh prompt cycle

`tests/components/CloseConfirm.test.jsx`:
- Message reflects running agents, plural and singular
- Message names dirty files
- "Nothing is running" copy when no terminals are spawned
- Cancel button holds focus on mount
- Enter does not confirm
- Escape cancels
- `destructive` applied only when agents are running

`tests/components/ConfirmDialog.test.jsx` (new — no suite exists for it today):
- `initialFocus` defaults to confirm, preserving current behavior
- `initialFocus="cancel"` focuses the cancel button

## Files

| File | Change |
|---|---|
| `src/main/index.js` | Guard, IPC handlers, `before-quit` release |
| `src/preload/index.js` | `onCloseRequested`, `closePrompted`, `confirmClose` |
| `src/renderer/hooks/useCloseGuard.js` | New |
| `src/renderer/components/CloseConfirm.jsx` | New |
| `src/renderer/components/ConfirmDialog.jsx` | `initialFocus` prop |
| `src/renderer/App.jsx` | Hook call, dialog in both render branches |
| `tests/main/close-guard.test.js` | New |
| `tests/components/CloseConfirm.test.jsx` | New |
