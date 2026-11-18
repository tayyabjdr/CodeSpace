import { basename, parentLabel } from '../path-display.js'

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Case-insensitive, trailing-separator-tolerant path equality (Windows), as in
// normalizePath in src/main/recent-dirs-store.js, plus / and \ count as equal.
function samePath(a, b) {
  const norm = s => String(s ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

// One row per folder: a single column never leaves a ragged half-filled row
// and gives long folder names the full card width. Double-click picks the
// folder and launches straight away.
export default function RecentDirectories({ recents, currentDir, onPick, onRemove, onLaunch }) {
  if (!recents || recents.length === 0) return null

  return (
    <div className="ob-field">
      <label className="ob-label">Recent</label>
      <div className="ob-recent-list">
        {recents.map(dir => {
          const active = currentDir && samePath(dir, currentDir)
          return (
            <div
              key={dir}
              role="button"
              tabIndex={0}
              className={`ob-recent-card${active ? ' active' : ''}`}
              title={dir}
              aria-pressed={!!active}
              onClick={() => onPick(dir)}
              onDoubleClick={() => onLaunch?.(dir)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onPick(dir)
                }
              }}
            >
              <span className="ob-recent-folder"><FolderIcon /></span>
              <span className="ob-recent-name">{basename(dir)}</span>
              <span className="ob-recent-path">{parentLabel(dir, 26)}</span>
              <button
                type="button"
                className="ob-recent-remove"
                aria-label={`Remove ${basename(dir)}`}
                title="Remove from recent"
                onClick={e => {
                  e.stopPropagation()
                  onRemove(dir)
                }}
                onDoubleClick={e => e.stopPropagation()}
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
