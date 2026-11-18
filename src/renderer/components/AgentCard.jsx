// The focused isolated agent's branch at a glance, pinned to the bottom of
// the sidebar: branch, files, lines, commits ahead, plus Open folder and the
// same Finish the pane carries. Hidden when there is nothing to show yet, so
// a fresh agent doesn't get an empty card.

import { useFinish } from './FinishControl.jsx'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const BranchGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

export default function AgentCard(props) {
  const api = typeof window !== 'undefined' ? window.electronAPI?.merge : null
  if (!api || !props.repoDir || !props.agentId || !props.branch) return null
  return <AgentCardInner api={api} {...props} />
}

function AgentCardInner({ api, agentId, ptyId, repoDir, agentName, branch }) {
  const {
    info, seq, view, disabled, finishTitle, onMouseDown, onMouseLeave, onFinish
  } = useFinish({ api, agentId, ptyId, repoDir, agentName })

  const hasChanges = !!info && (info.ahead > 0 || info.files > 0)
  if (!hasChanges && !view) return null

  const openFolder = (e) => {
    e.stopPropagation()
    window.electronAPI?.worktree?.openFolder?.({ repoDir, agentId })
  }

  return (
    <section className="sb-card" aria-label={`${agentName} branch`}>
      <div className="sb-card-top" title={branch}>
        <span className="sb-card-icon"><BranchGlyph /></span>
        <span className="sb-card-branch">{branch}</span>
      </div>
      {hasChanges && (
        <div className="sb-card-stats">
          <span>{plural(info.files, 'file')}</span>
          {info.insertions > 0 && <span className="sb-card-add">+{info.insertions}</span>}
          {info.deletions > 0 && <span className="sb-card-del">−{info.deletions}</span>}
          {info.ahead > 0 && (
            <>
              <span className="sb-card-sep" aria-hidden>·</span>
              <span>{info.ahead} ahead</span>
            </>
          )}
        </div>
      )}
      {view && (
        <div key={seq} className="sb-card-status" data-tone={view.tone} title={view.title}>
          {view.label}
        </div>
      )}
      <div className="sb-card-actions">
        <button type="button" className="sb-card-btn ghost" onClick={openFolder} title="Open this agent's folder">
          Open folder
        </button>
        <button
          type="button"
          className="sb-card-btn solid"
          disabled={disabled}
          title={finishTitle}
          onMouseDown={onMouseDown}
          onMouseLeave={onMouseLeave}
          onClick={onFinish}
        >
          Finish
        </button>
      </div>
    </section>
  )
}
