import ConfirmDialog from './ConfirmDialog.jsx'
import { basename } from '../path-resolver.js'

/**
 * What the user actually stands to lose. Terminals spawn lazily on first
 * workspace activation, so a persisted-but-never-opened workspace counts zero.
 */
export function closeSummary(workspaces = []) {
  let agents = 0
  let activeWorkspaces = 0
  const dirty = []

  for (const w of workspaces) {
    const count = w?.terminals?.length ?? 0
    if (count > 0) {
      agents += count
      activeWorkspaces += 1
    }
    if (w?.editor?.dirty && w.editor.file) dirty.push(basename(w.editor.file))
  }

  return { agents, activeWorkspaces, dirty }
}

export default function CloseConfirm({ workspaces, onCancel, onConfirm }) {
  const { agents, activeWorkspaces, dirty } = closeSummary(workspaces)
  const running = agents > 0

  const unsaved = dirty.length > 0 && (
    <>your unsaved edits to <strong className="cd-emphasis">{dirty.join(', ')}</strong> will be lost</>
  )

  let message
  if (running) {
    message = (
      <>
        {agents === 1 ? '1 agent is' : `${agents} agents are`} running{' '}
        {activeWorkspaces === 1 ? 'in 1 workspace' : `across ${activeWorkspaces} workspaces`}.
        {' '}Closing stops {agents === 1 ? 'it' : 'all of them'}
        {unsaved && <>, and {unsaved}</>}.
      </>
    )
  } else if (dirty.length > 0) {
    // Barely reachable, since the editor lives inside an activated workspace,
    // but cheap to get right rather than claim nothing is at stake.
    message = <>Closing now means {unsaved}.</>
  } else {
    message = <>Nothing is running right now.</>
  }

  return (
    <ConfirmDialog
      title="Close CodeSpace?"
      message={message}
      confirmLabel="Close CodeSpace"
      cancelLabel="Stay"
      initialFocus="cancel"
      destructive={running}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
