import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeFailureMessage, leftoverReasonText } from '../../src/renderer/isolation-notice.js'
import LeftoverFoldersDialog from '../../src/renderer/components/LeftoverFoldersDialog.jsx'
import LeftoverWorkNotice from '../../src/renderer/components/LeftoverWorkNotice.jsx'

const EM = '\u2014'

describe('leftover folder wording', () => {
  it('names why a folder was kept', () => {
    expect(leftoverReasonText({ reason: 'uncommitted', branch: 'cs/app/a1' }))
      .toBe('Kept: it has uncommitted changes on cs/app/a1')
    expect(leftoverReasonText({ reason: 'unreadable' }))
      .toBe("Kept: git couldn't read it, so it was left alone")
  })

  it('never tells the user to delete a folder that still holds a node_modules link', () => {
    // PowerShell 5.1 Remove-Item -Recurse follows the junction into the real node_modules.
    for (const f of [{ reason: 'deps-unlink-failed' }, { error: 'deps-unlink-failed' }]) {
      const t = leftoverReasonText(f)
      expect(t).toBe('A link to your node_modules is still inside. Remove that link first, then delete the folder.')
      expect(t).not.toMatch(/Delete it/)
    }
    const msg = closeFailureMessage({ ok: false, error: 'deps-unlink-failed', path: 'D:/wt/a1' })
    expect(msg).toContain('D:/wt/a1')
    expect(msg).toContain('Remove that link first')
    expect(msg).not.toMatch(/Delete it/)
  })

  it('closeFailureMessage words kept folders', () => {
    expect(closeFailureMessage({ ok: false, reason: 'uncommitted', branch: 'cs/app/a1', path: 'D:/wt/a1' }))
      .toContain('Kept: it has uncommitted changes on cs/app/a1')
    expect(closeFailureMessage({ ok: false, reason: 'unreadable', path: 'D:/wt/a1' }))
      .toContain("Kept: git couldn't read it, so it was left alone")
  })

  it('the dialog shows each folder with its reason, no em-dashes', () => {
    const { container } = render(
      <LeftoverFoldersDialog
        folders={[
          { agentId: 'a1', path: 'D:/wt/a1', branch: 'cs/app/a1', reason: 'uncommitted' },
          { agentId: 'a2', path: 'D:/wt/a2', reason: 'unreadable' },
          { agentId: 'a3', path: 'D:/wt/a3', error: 'deps-unlink-failed' },
          { agentId: 'a4', path: 'D:/wt/a4', detail: 'EBUSY' }
        ]}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Kept: it has uncommitted changes on cs/app/a1')).toBeTruthy()
    expect(screen.getByText("Kept: git couldn't read it, so it was left alone")).toBeTruthy()
    expect(screen.getByText(/Remove that link first/)).toBeTruthy()
    expect(screen.getByText("Couldn't remove it. Delete it after closing anything using it.")).toBeTruthy()
    // The intro no longer claims every folder failed to delete.
    expect(container.textContent).not.toContain("These folders couldn't be removed")
    expect(container.textContent).not.toContain(EM)
  })

  it('the earlier-session notice words unreadable folders', () => {
    render(<LeftoverWorkNotice kept={[{ agentId: 'a1', branch: 'cs/app/a1', path: 'D:/wt/a1', reason: 'unreadable' }]} />)
    expect(screen.getByText("Couldn't read, left alone")).toBeTruthy()
  })
})
