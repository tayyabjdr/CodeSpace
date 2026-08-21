// One live agent session, nested under its workspace in the sidebar tree.
// Purely presentational — status is resolved by the parent, which is the
// only place that can see the done and exit stores together.

const GLYPHS = { claude: '✳', codex: '◆' }

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
      <span className={`sb-session-dot ${status}`} aria-hidden />
      <span className="sb-session-glyph" aria-hidden>{GLYPHS[term.shell] ?? '·'}</span>
      <span className="sb-session-name">{label}</span>
    </div>
  )
}
