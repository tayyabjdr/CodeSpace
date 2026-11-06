// Why a workspace is (or isn't) running its agents in separate folders.
// Shared by Onboarding (before launch) and the workspace notice (after).
export const ISOLATION_NOTES = {
  'not-a-repo': "This folder isn't a git repo, so agents will share it.",
  'no-commits': 'This repo has no commits yet, so agents will share the folder. Make a first commit to separate them.',
  'git-missing': "Git wasn't found, so agents will share this folder."
}

// Decides which notice, if any, a workspace should show above its grid.
// Add new kinds (e.g. a setup warning) as further early returns by priority.
export function isolationNotice({ isolated, canIso, liveAgents, failures }) {
  if (failures && failures.length > 0) return { kind: 'spawn-failed', actionEnabled: true }
  if (isolated) return { kind: null, actionEnabled: false }
  if (!canIso) return { kind: null, actionEnabled: false }
  if (canIso.ok) return { kind: 'can-isolate', actionEnabled: liveAgents === 0 }
  return { kind: 'cannot-isolate', actionEnabled: false }
}
