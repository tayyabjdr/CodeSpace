// Flashes the Windows taskbar icon when any agent finishes a turn while the
// window is unfocused. Subscribes to done-tracker once at import time so it
// fires for every workspace, not just the active one. The main process
// suppresses the call when the window is already focused, and clears the
// flash automatically when focus returns.

import * as doneTracker from './done-tracker.js'

doneTracker.onDone(() => {
  try { window.electronAPI?.windowFlashFrame?.() } catch {}
})
