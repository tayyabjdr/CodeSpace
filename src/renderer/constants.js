// Renderer-side timing constants. Centralized so behavior tuning happens in
// one place; magic numbers in components belong here.

// How long after activity stops we consider Claude "done" and play the ding.
export const DONE_SILENCE_MS = 4000

// Wheel-zoom font change → fit() + SIGWINCH debounce. A scroll burst sends
// many ticks; coalescing avoids stacking TUI redraws.
export const FONT_RESIZE_DEBOUNCE_MS = 180

// Workspaces.json persistence debounce — long enough to absorb rapid state
// flips (creating a workspace and switching focus is two state updates),
// short enough that a quit shortly after still saves.
export const PERSIST_DEBOUNCE_MS = 500

// Boot animation hold before transitioning out of onboarding.
export const ONBOARDING_BOOT_DELAY_MS = 850

// Cap on clipboard:writeText payloads — defends main process from a renderer
// trying to push gigantic blobs into the OS clipboard.
export const CLIPBOARD_WRITE_MAX_BYTES = 1024 * 1024
