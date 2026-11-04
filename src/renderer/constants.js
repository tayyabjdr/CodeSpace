// Renderer-side timing constants. Centralized so behavior tuning happens in
// one place; magic numbers in components belong here.

// How long after activity stops we consider Claude "done" and play the ding.
export const DONE_SILENCE_MS = 4000

// Wheel-zoom font change → fit() + SIGWINCH debounce. A scroll burst sends
// many ticks; coalescing avoids stacking TUI redraws.
export const FONT_RESIZE_DEBOUNCE_MS = 180

// Window/splitter resize → fit() + SIGWINCH debounce. ResizeObserver fires on
// every frame of a drag, and ConPTY rewraps its buffer and signals the agent on
// every resize it's handed, so an uncoalesced drag stacks dozens of TUI redraws
// and leaves duplicated lines behind. Short enough that the grid still looks
// like it tracks the drag.
export const PTY_RESIZE_DEBOUNCE_MS = 100

// Workspaces.json persistence debounce — long enough to absorb rapid state
// flips (creating a workspace and switching focus is two state updates),
// short enough that a quit shortly after still saves.
export const PERSIST_DEBOUNCE_MS = 500

// Boot animation hold before transitioning out of onboarding.
export const ONBOARDING_BOOT_DELAY_MS = 850

// Cap on clipboard:writeText payloads — defends main process from a renderer
// trying to push gigantic blobs into the OS clipboard.
export const CLIPBOARD_WRITE_MAX_BYTES = 1024 * 1024

// Agent CLI types CodeSpace can spawn. Single source of truth for picker,
// badge, persistence, and settings.
export const AGENT_TYPES = ['claude', 'codex']

export const AGENT_LABELS = {
  claude: 'Claude',
  codex:  'Codex'
}

// Hard cap on agents per workspace (matches the 1–8 onboarding grid).
export const AGENT_COUNT_MAX = 8
