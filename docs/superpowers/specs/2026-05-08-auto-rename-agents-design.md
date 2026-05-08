# Auto-rename agents — design

**Date:** 2026-05-08
**Status:** approved (brainstorm)
**Owner:** TJ

## Goal

Replace the static `Agent NN` label on each terminal pane with a short
4–5-word title that reflects what the Claude agent in that pane is
currently doing. The title regenerates after every Claude turn.

## Non-goals

- Full chat-style summarization or transcripts.
- Persistence of generated titles across sessions (terminals themselves
  are not persisted; titles follow that lifetime).
- A settings UI for the API key.
- A user-visible "regenerate now" button.
- Auto-renaming after a manual rename has been applied.

## User-visible behavior

- A freshly spawned pane shows `Agent 01`, `Agent 02`, … as today.
- After the first Claude turn finishes (Enter pressed → 4 s of silence,
  the existing "done" trigger), the pane's label changes to a 3–5
  word, Title Case summary of the current task. No quotes, no period.
- On every subsequent Claude turn, the label re-summarizes.
- If the user double-clicks and renames the pane, that name is treated
  as a pin: auto-rename never overwrites it.
- If `ANTHROPIC_API_KEY` is not set in the environment when CodeSpace
  launches, auto-rename is silently disabled. Panes keep their
  `Agent NN` defaults; no error UI.
- Network or API errors leave the existing label unchanged. Console
  logs the error.

## Architecture

Two new modules and one IPC channel.

### Renderer: `src/renderer/auto-namer.js`

Mirrors the structure of `done-tracker.js`. Subscribes to "done"
events from `done-tracker` (new small `onDone(cb)` hook on that
module), and reacts:

```
onDone(termId) →
  if termHasManualName(termId)        → return
  if !apiKeyAvailable                  → return
  if inFlight.has(termId)              → return
  inFlight.add(termId)
  tail = stripAnsi(ptyPool.getRing(ptyId)).slice(-4096)
  if tail === lastTail.get(termId)     → return  // suppress no-op
  lastTail.set(termId, tail)
  ipc.summarizeAgentName(tail) →
    on success: notifyName(termId, sanitized)
    on failure: leave previous name
  inFlight.delete(termId)
```

`apiKeyAvailable` is fetched once at startup via a new
`agentName:hasKey` IPC call and cached.

### Main: `src/main/auto-namer.js`

Owns the Anthropic SDK client. Exports two IPC handlers (registered in
`ipc-handlers.js`):

- `agentName:hasKey` → `boolean` (does `process.env.ANTHROPIC_API_KEY`
  exist).
- `agentName:summarize` → `{ ok: true, name } | { ok: false, reason }`.

Calls Haiku 4.5 with `max_tokens: 20`, system prompt below, and the
ANSI-stripped tail as the user message. Sanitizes the response before
returning: trim, strip wrapping quotes/backticks, drop trailing
punctuation, cap at 40 characters.

```
System: You name terminal tabs. Reply with 3–5 words, Title Case,
        no quotes, no punctuation, no trailing period. Describe what
        the Claude agent in this terminal is currently doing. If the
        terminal is idle or has no clear task, reply "Idle".
```

If the SDK throws, the handler returns `{ ok: false, reason: 'api' }`
and logs server-side.

### Done-tracker hook

`done-tracker.js` already detects the moment we care about. It
currently calls `playDoneSound()` and `notify()` when a turn ends.
Add a parallel `doneListeners` set + `onDone(cb)` exporter; call it
from inside the same silence-timer block. Auto-namer subscribes once
at module load.

## Data model

Per-terminal shape gains one field:

```js
{ id, shell, agentNum, cwd, ptyId, name, autoName }
```

- `name` — manual, set only via the rename UI. Wins everywhere.
- `autoName` — AI-generated; set by auto-namer.
- Display: `name?.trim() || autoName?.trim() || \`Agent ${pad(agentNum)}\``.

`TerminalPane.jsx`'s existing `displayName` line is updated to
include `autoName` in the fallback chain. The component receives
`autoName` as a new prop from `App.jsx`.

`autoName` is **not** persisted. `workspaces.json` already only
serializes `{ id, name, dir, agentCount, editor }` per workspace and
no terminal-level data, so this falls out for free.

## Update flow (App.jsx)

A new callback `setAutoName(termId, name)` is plumbed through to
`auto-namer` via a one-time subscription in `AppInner`:

```js
useEffect(() => autoNamer.subscribe((termId, name) => {
  setWorkspaces(prev => prev.map(w => ({
    ...w,
    terminals: w.terminals.map(t =>
      t.id === termId ? { ...t, autoName: name } : t
    )
  })))
}), [])
```

Auto-namer runs across every workspace's PTYs (just like
done-tracker), so hidden workspaces' agents also get renamed.

## Failure & cost

- **No API key**: feature disabled at startup, silent.
- **Network error / rate limit / 5xx**: handler returns
  `{ ok: false }`; renderer leaves the existing `autoName` (or default
  `Agent NN`) in place. One `console.warn` per failure.
- **Cost**: ~1 Haiku 4.5 call per Claude turn per pane. Inputs ≤ 4 KB,
  outputs ≤ 20 tokens. Roughly $0.001 per call. Negligible for solo
  use; left unmetered.

## Out of scope (deferred)

- Settings UI for entering the key from inside the app.
- A regenerate-now button.
- Persisting `autoName` to disk so it survives a restart.
- Smarter content selection (right now: tail of the ring).

## Open questions

None at design time. Implementation will resolve:

- Exact ANSI-stripping helper (existing dep in pty-pool? otherwise add
  `strip-ansi`).
- Whether to strip Claude CLI's prompt markers (`> `, status lines)
  before sending — start without; revisit if Haiku output is noisy.

## Files touched

- `src/main/auto-namer.js` — new
- `src/main/ipc-handlers.js` — register two handlers
- `src/main/index.js` — wire up auto-namer module on startup
- `src/preload/index.js` — expose `agentName.hasKey` /
  `agentName.summarize`
- `src/renderer/auto-namer.js` — new
- `src/renderer/done-tracker.js` — add `onDone(cb)` exporter
- `src/renderer/App.jsx` — wire subscription, pass `autoName` prop
- `src/renderer/components/TerminalPane.jsx` — include `autoName` in
  display fallback chain
- `package.json` — add `@anthropic-ai/sdk`, `strip-ansi` (if needed)
