// One live agent session, nested under its workspace in the sidebar tree.
// Purely presentational — status is resolved by the parent, which is the
// only place that can see the done and exit stores together.

import AgentLogo, { hasAgentLogo } from './AgentLogo.jsx'

export default function SessionRow({ term, status, isFocused, onSelect }) {
  const label =
    term.name?.trim() ||
    term.autoName?.trim() ||
    `Agent ${String(term.agentNum).padStart(2, '0')}`

  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused}
      tabIndex={-1}
      data-sb-node
      data-sb-kind="session"
      data-sb-id={term.id}
      className={`sb-session${isFocused ? ' focused' : ''}`}
      onClick={() => onSelect(term.id)}
      title={label}
    >
      {/* The agent's mark doubles as the status: white running, cyan done,
          yellow stopped. Unknown shells fall back to a plain dot. */}
      {hasAgentLogo(term.shell) ? (
        <span className={`sb-session-logo ${status}`} aria-hidden>
          <AgentLogo shell={term.shell} size={12} />
        </span>
      ) : (
        <span className={`sb-session-dot ${status}`} aria-hidden />
      )}
      <span className="sb-session-name">{label}</span>
    </div>
  )
}
