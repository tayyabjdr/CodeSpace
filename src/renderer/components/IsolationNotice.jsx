import { ISOLATION_NOTES } from '../isolation-notice.js'
import './IsolationNotice.css'

const SWITCH_BLOCKED = "Close this workspace's agents to switch."

export default function IsolationNotice({
  kind, actionEnabled, reason, failures = [], retrying = false, onSwitch, onRetry, onDismiss
}) {
  if (!kind) return null

  let text
  if (kind === 'spawn-failed') {
    const n = failures.length
    const detail = failures.find(f => f?.detail)?.detail ?? failures[0]?.error ?? 'unknown error'
    text = `Couldn't create a folder for ${n} ${n === 1 ? 'agent' : 'agents'}: ${detail}`
  } else if (kind === 'can-isolate') {
    text = 'Agents here share one folder, so their changes can collide.'
  } else {
    text = ISOLATION_NOTES[reason] ?? ISOLATION_NOTES['not-a-repo']
  }

  return (
    <div className={`iso-notice iso-notice-${kind}`} role={kind === 'spawn-failed' ? 'alert' : 'status'}>
      <span className="iso-notice-text">{text}</span>
      {kind === 'spawn-failed' && (
        <button type="button" className="iso-notice-btn" disabled={retrying} onClick={onRetry}>Retry</button>
      )}
      {kind === 'can-isolate' && (
        <button
          type="button"
          className="iso-notice-btn"
          disabled={!actionEnabled}
          title={actionEnabled ? undefined : SWITCH_BLOCKED}
          onClick={onSwitch}
        >
          Use separate folders
        </button>
      )}
      {kind !== 'spawn-failed' && (
        <button type="button" className="iso-notice-x" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      )}
    </div>
  )
}
