// When a Finish fails, tell the agent in its own terminal so it can fix the
// problem. Only agent panes get the message, and only when the pane has been
// quiet: a user may have typed something since, and we must not submit text
// on top of it.

import * as ptyPool from './pty-pool.js'
import { DONE_SILENCE_MS } from './constants.js'

const AGENT_SHELLS = new Set(['claude', 'codex'])

// Text and \r in one chunk can read as a paste rather than a submit, the same
// reason pty-manager.js delays its \r.
export const SUBMIT_DELAY_MS = 150

export function handoffKind(state) {
  if (state === 'tests-failed') return 'tests failed'
  if (state === 'conflict') return 'rebase conflict'
  return null
}

export function handoffText({ target, kind, logPath }) {
  const details = logPath ? ` Details are in ${logPath}.` : ''
  return `CodeSpace could not merge this branch into ${target}: ${kind}.${details} ` +
    'Please fix it and commit. For a conflict, finish with git rebase --continue.'
}

export function deliverHandoff({ ptyId, shell, text, lastOutputAt, now = Date.now() }) {
  if (!ptyId || !text || !AGENT_SHELLS.has(shell)) return false
  if (typeof lastOutputAt !== 'number' || now - lastOutputAt < DONE_SILENCE_MS) return false
  ptyPool.writePty(ptyId, text)
  setTimeout(() => ptyPool.writePty(ptyId, '\r'), SUBMIT_DELAY_MS)
  return true
}

// One merge-status event in, at most one handoff out. `resolveAgent` maps an
// agentId to its { ptyId, shell }, or null when the pane is gone.
export function handoffForStatus(status, { resolveAgent, lastOutputAt, now = Date.now() }) {
  const kind = handoffKind(status?.state)
  if (!kind || !status.target) return false
  const agent = resolveAgent(status.agentId)
  if (!agent?.ptyId) return false
  return deliverHandoff({
    ptyId: agent.ptyId,
    shell: agent.shell,
    text: handoffText({ target: status.target, kind, logPath: status.logPath }),
    lastOutputAt: lastOutputAt(agent.ptyId),
    now
  })
}

// App wiring: one handoff attempt per merge-status event. Returns an
// unsubscribe. Re-renders never reach here, only new events do.
export function startHandoffs({ onMergeEvent, resolveAgent, lastOutputAt }) {
  return onMergeEvent((status) => {
    try { handoffForStatus(status, { resolveAgent, lastOutputAt }) }
    catch (err) { console.warn('[merge-handoff] failed:', err) }
  })
}
