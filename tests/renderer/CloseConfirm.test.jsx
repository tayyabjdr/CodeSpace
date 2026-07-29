import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CloseConfirm, { closeSummary } from '../../src/renderer/components/CloseConfirm.jsx'

function ws(overrides = {}) {
  return { id: 'w1', name: 'Repo', terminals: [], editor: { open: false, file: null, dirty: false }, ...overrides }
}
function term(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}` }))
}
function setup(workspaces) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<CloseConfirm workspaces={workspaces} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('closeSummary', () => {
  it('counts agents and only the workspaces that have them', () => {
    const s = closeSummary([
      ws({ id: 'a', terminals: term(3) }),
      ws({ id: 'b', terminals: term(1) }),
      ws({ id: 'c', terminals: [] })
    ])
    expect(s.agents).toBe(4)
    expect(s.activeWorkspaces).toBe(2)
  })

  it('collects dirty file names across all workspaces', () => {
    const s = closeSummary([
      ws({ id: 'a', editor: { file: 'C:\\repo\\App.jsx', dirty: true } }),
      ws({ id: 'b', editor: { file: 'C:\\repo\\clean.js', dirty: false } })
    ])
    expect(s.dirty).toEqual(['App.jsx'])
  })

  it('returns zeroes for an empty or missing list', () => {
    expect(closeSummary([])).toEqual({ agents: 0, activeWorkspaces: 0, dirty: [] })
    expect(closeSummary()).toEqual({ agents: 0, activeWorkspaces: 0, dirty: [] })
  })
})

describe('CloseConfirm', () => {
  it('always asks before closing', () => {
    setup([])
    expect(screen.getByText('Close CodeSpace?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument()
  })

  it('focuses Stay so a stray Enter cannot close the app', () => {
    setup([ws({ terminals: term(2) })])
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus()
  })

  it('reports plural agents across plural workspaces', () => {
    setup([ws({ id: 'a', terminals: term(3) }), ws({ id: 'b', terminals: term(1) })])
    expect(screen.getByText(/4 agents are running across 2 workspaces/)).toBeInTheDocument()
  })

  it('reports a single agent in a single workspace', () => {
    setup([ws({ terminals: term(1) })])
    expect(screen.getByText(/1 agent is running in 1 workspace/)).toBeInTheDocument()
  })

  it('names unsaved files', () => {
    setup([ws({ terminals: term(1), editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(screen.getByText('App.jsx')).toBeInTheDocument()
  })

  it('says nothing is running when no agents are spawned', () => {
    setup([ws({ terminals: [] })])
    expect(screen.getByText(/Nothing is running right now/)).toBeInTheDocument()
  })

  it('names the dirty file and is destructive when every pane is closed but an edit is unsaved', () => {
    setup([ws({ terminals: [], editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(screen.getByText(/Closing now means your unsaved edits to/)).toBeInTheDocument()
    expect(screen.getByText('App.jsx')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toHaveClass('destructive')
  })

  it('marks the confirm destructive when agents are running', () => {
    setup([ws({ terminals: term(1) })])
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toHaveClass('destructive')
  })

  it('marks the confirm destructive when unsaved edits exist, even with no agents running', () => {
    setup([ws({ terminals: [], editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).toHaveClass('destructive')
  })

  it('is not destructive in the truly quiet case: no agents running, nothing dirty', () => {
    setup([ws({ terminals: [] })])
    expect(screen.getByRole('button', { name: 'Close CodeSpace' })).not.toHaveClass('destructive')
  })

  it('uses no em-dashes in its copy', () => {
    setup([ws({ terminals: term(2), editor: { file: 'C:\\repo\\App.jsx', dirty: true } })])
    expect(document.body.textContent).not.toContain('\u2014')
  })
})
