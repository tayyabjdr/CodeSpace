// Why a workspace is (or isn't) running its agents in separate folders.
// Shared by Onboarding (before launch) and the workspace notice (after).
export const ISOLATION_NOTES = {
  'not-a-repo': "This folder isn't a git repo, so agents will share it.",
  'no-commits': 'This repo has no commits yet, so agents will share the folder. Make a first commit to separate them.',
  'git-missing': "Git wasn't found, so agents will share this folder."
}

// Decides which notice, if any, a workspace should show above its grid.
// Priority: spawn failures, then the can-isolate / cannot-isolate hints, then
// setup warnings (e.g. node_modules couldn't be linked) as the lowest.
export function isolationNotice({ isolated, canIso, liveAgents, failures, warnings = [] }) {
  if (failures && failures.length > 0) return { kind: 'spawn-failed', actionEnabled: true }
  const base = baseNotice({ isolated, canIso, liveAgents })
  if (!base.kind && warnings && warnings.length > 0) return { kind: 'setup-warning', actionEnabled: false }
  return base
}

function baseNotice({ isolated, canIso, liveAgents }) {
  if (isolated) return { kind: null, actionEnabled: false }
  if (!canIso) return { kind: null, actionEnabled: false }
  if (canIso.ok) return { kind: 'can-isolate', actionEnabled: liveAgents === 0 }
  return { kind: 'cannot-isolate', actionEnabled: false }
}

// materializeAgents numbers agents startNum + (index within the batch), so the
// counter must advance by the batch size, not by how many of them succeeded.
export function nextAgentCounter(counter, startNum, batchSize) {
  return Math.max(counter, startNum + batchSize - 1)
}

// After a retry: drop the retried failures (by identity) from the current list,
// keep any added concurrently, then append the retry's own new failures.
export function mergeRetryFailures(current, retried, newFailures) {
  const gone = new Set(retried)
  return [...(current ?? []).filter(f => !gone.has(f)), ...newFailures]
}
