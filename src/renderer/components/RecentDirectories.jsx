const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

function basename(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p
}

// Case-insensitive, trailing-separator-tolerant path equality (Windows).
// Also collapses repeated separators so JSX-attr double-backslash paths match.
function samePath(a, b) {
  const norm = s => String(s ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

export default function RecentDirectories({ recents, currentDir, onPick, onRemove }) {
  if (!recents || recents.length === 0) return null

  return (
    <div className="ob-field">
      <label className="ob-label">Recent</label>
      <div className="ob-recent-grid">
        {recents.map(dir => {
          const active = currentDir && samePath(dir, currentDir)
          return (
            <div
              key={dir}
              role="button"
              tabIndex={0}
              className={`ob-recent-card${active ? ' active' : ''}`}
              title={dir}
              onClick={() => onPick(dir)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(dir)
                }
              }}
            >
              <span className="ob-recent-folder"><FolderIcon /></span>
              <span className="ob-recent-text">
                <span className="ob-recent-name">{basename(dir)}</span>
                <span className="ob-recent-path">{dir}</span>
              </span>
              <button
                type="button"
                className="ob-recent-remove"
                aria-label={`Remove ${basename(dir)}`}
                onClick={e => {
                  e.stopPropagation()
                  onRemove(dir)
                }}
              >
                <XIcon />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
