// Work an earlier session left behind in this repo: agent folders kept
// because they had uncommitted changes or couldn't be removed, and agent
// branches holding commits that never reached the main branch. Shown so the
// user can find them; nothing here deletes anything.
import './LeftoverWorkNotice.css'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const KEPT_LABEL = {
  'uncommitted': 'Uncommitted changes',
  'cleanup-failed': "Couldn't be removed"
}

function CopyButton({ branch }) {
  return (
    <button
      type="button"
      className="lw-copy"
      title={`Copy ${branch}`}
      onClick={() => window.electronAPI.writeClipboardText(branch)}
    >
      Copy
    </button>
  )
}

export default function LeftoverWorkNotice({ kept = [], stranded = [], onDismiss }) {
  if (!kept.length && !stranded.length) return null

  return (
    <div className="lw-notice" role="status">
      <div className="lw-head">
        <span className="lw-title">Work left from an earlier session</span>
        <button type="button" className="lw-x" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
      <ul className="lw-list">
        {kept.map(k => (
          <li key={`kept-${k.agentId ?? k.path}`} className="lw-row">
            <div className="lw-main">
              <span className="lw-branch">{k.branch}</span>
              <span className="lw-meta" title={k.detail || undefined}>{KEPT_LABEL[k.reason] ?? 'Kept'}</span>
              <span className="lw-path" title={k.path}>{k.path}</span>
            </div>
            <CopyButton branch={k.branch} />
          </li>
        ))}
        {stranded.map(s => (
          <li key={`stranded-${s.branch}`} className="lw-row">
            <div className="lw-main">
              <span className="lw-branch">{s.branch}</span>
              <span className="lw-meta">{plural(s.ahead, 'commit', 'commits')} not merged</span>
            </div>
            <CopyButton branch={s.branch} />
          </li>
        ))}
      </ul>
    </div>
  )
}
