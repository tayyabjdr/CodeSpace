// Work an earlier session left behind in this repo: agent folders kept
// because they had uncommitted changes or couldn't be removed, and agent
// branches holding commits that never reached the main branch. Each row can
// copy its branch, open its folder, or be discarded; the parent confirms a
// discard before anything is deleted.
import './LeftoverWorkNotice.css'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const KEPT_LABEL = {
  'uncommitted': 'Uncommitted changes',
  'cleanup-failed': "Couldn't be removed",
  'unreadable': "Couldn't read, left alone"
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

function Actions({ row, onOpenFolder, onDiscard }) {
  return (
    <span className="lw-actions">
      <CopyButton branch={row.branch} />
      {onOpenFolder && row.agentId && row.path && !row.folderGone && (
        <button type="button" className="lw-copy" title={`Open ${row.path}`} onClick={() => onOpenFolder(row)}>
          Open folder
        </button>
      )}
      {onDiscard && (
        <button type="button" className="lw-copy lw-discard" title="Delete this work for good" onClick={() => onDiscard(row)}>
          Discard
        </button>
      )}
    </span>
  )
}

export default function LeftoverWorkNotice({ kept = [], stranded = [], onDismiss, onOpenFolder, onDiscard }) {
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
              <span className="lw-meta" title={k.detail || undefined}>
                {k.discardFailed ? "Couldn't discard. Close anything using it, then try again"
                  : k.folderGone ? 'Folder is already gone. Discard clears this row'
                  : (KEPT_LABEL[k.reason] ?? 'Kept')}
              </span>
              <span className="lw-path" title={k.path}>{k.path}</span>
            </div>
            <Actions row={k} onOpenFolder={onOpenFolder} onDiscard={onDiscard} />
          </li>
        ))}
        {stranded.map(s => (
          <li key={`stranded-${s.branch}`} className="lw-row">
            <div className="lw-main">
              <span className="lw-branch">{s.branch}</span>
              <span className="lw-meta">
                {s.discardFailed ? "Couldn't discard this branch" : `${plural(s.ahead, 'commit', 'commits')} not merged`}
              </span>
            </div>
            <Actions row={s} onOpenFolder={onOpenFolder} onDiscard={onDiscard} />
          </li>
        ))}
      </ul>
    </div>
  )
}
