import ConfirmDialog from './ConfirmDialog.jsx'

// One-button notice listing agent folders a workspace cleanup couldn't remove.
export default function LeftoverFoldersDialog({ folders, onClose }) {
  if (!folders || folders.length === 0) return null
  return (
    <ConfirmDialog
      title="Some agent folders were left behind"
      message={
        <>
          These folders couldn't be removed. Delete them after closing anything using them:
          {folders.map((f, i) => (
            <span key={f.agentId ?? i} style={{ display: 'block' }}>
              <code>{f.path ?? `Unknown folder (${f.detail ?? 'error'})`}</code>
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
