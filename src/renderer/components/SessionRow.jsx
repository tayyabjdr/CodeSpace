// One live agent session, nested under its workspace in the sidebar tree.
// Purely presentational — status is resolved by the parent, which is the
// only place that can see the done and exit stores together.

import AgentLogo, { hasAgentLogo } from './AgentLogo.jsx'

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' }

const STATUS_TITLES = { running: 'Working', done: 'Done', exited: 'Exited' }

export function sessionLabel(term) {
  return (
    term.name?.trim() ||
    term.autoName?.trim() ||
    `Agent ${String(term.agentNum).padStart(2, '0')}`
  )
}

export default function SessionRow({ term, status, isFocused, onSelect }) {
  const label = sessionLabel(term)

  // Second line: agent type, then the worktree branch for an isolated agent.
  // An exited agent says so instead, since its branch is no longer live.
  const agent = AGENT_NAMES[term.shell] ?? term.shell ?? 'Shell'
  // Only the branch's last part (the agent id): `cs/<repo>/` repeats the
  // workspace and would push the id out of a 240px rail. Hover shows it all.
  const branchTail = term.branch ? term.branch.split('/').pop() : null
  const detail = status === 'exited' ? 'exited' : branchTail
  const sub = detail ? `${agent} · ${detail}` : agent

  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused}
      tabIndex={-1}
      data-sb-node
      data-sb-kind="session"
      data-sb-id={term.id}
      className={`sb-session ${status}${isFocused ? ' focused' : ''}`}
      onClick={() => onSelect(term.id)}
      title={term.branch ? `${label}\n${term.branch}` : label}
    >
      {/* The mark stays white in every state; the dot on the right carries
          the status. Unknown shells get a plain glyph-sized spacer. */}
      <span className="sb-session-logo" aria-hidden>
        {hasAgentLogo(term.shell) && <AgentLogo shell={term.shell} size={12} />}
      </span>
      <span className="sb-session-text">
        <span className="sb-session-name">{label}</span>
        <span className="sb-session-sub">{sub}</span>
      </span>
      <span className="sb-session-status" title={STATUS_TITLES[status]}>
        <span className={`sb-session-dot ${status}`} aria-label={STATUS_TITLES[status]} />
      </span>
    </div>
  )
}
