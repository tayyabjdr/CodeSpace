import ConfirmDialog from './ConfirmDialog.jsx'
import { leftoverReasonText } from '../isolation-notice.js'

// One-button notice listing agent folders a workspace cleanup left on disk,
// each with why: kept on purpose (uncommitted work, unreadable) or not removable.
export default function LeftoverFoldersDialog({ folders, onClose }) {
  if (!folders || folders.length === 0) return null
  return (
    <ConfirmDialog
      title="Some agent folders were left behind"
      message={
        <>
          These folders are still on disk:
          {folders.map((f, i) => (
            <span key={f.agentId ?? i} style={{ display: 'block', marginTop: 6 }}>
              <code>{f.path ?? `Unknown folder (${f.detail ?? 'error'})`}</code>
              <span className="lfd-reason" style={{ display: 'block', color: 'var(--cs-text-tertiary)' }}>
                {leftoverReasonText(f)}
              </span>
            </span>
          ))}
        </>
      }
      confirmLabel="OK"
      hideCancel
      onConfirm={onClose}
      onCancel={onClose}
    />
  )
}
