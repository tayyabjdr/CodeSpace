import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/App.jsx'

afterEach(() => {
  delete window.electronAPI
})

describe('App', () => {
  // Regression test for the bug fixed alongside useCloseGuard's `ready` gate:
  // the initial-load effect used to be a Promise.all(...).then(...) with no
  // .catch(). If any of loadWorkspaces/getDesktopPath/initSettings rejected,
  // setLoaded(true) never ran, so the app stayed on its `!loaded` null render
  // forever — and with useCloseGuard(loaded) in place, a window stuck there
  // can only ever be closed via main's 1500ms failsafe, never a dialog.
  it('still reaches a rendered state when the initial load rejects, instead of hanging on the null render', async () => {
    window.electronAPI = {
      loadWorkspaces: vi.fn(() => Promise.reject(new Error('disk read failed'))),
      getDesktopPath: vi.fn(() => Promise.resolve('')),
      saveWorkspaces: vi.fn(() => Promise.resolve()),
      onCloseRequested: vi.fn(() => vi.fn()),
      closePrompted: vi.fn(),
      confirmClose: vi.fn(),
      windowClose: vi.fn(),
      onUpdateReady: vi.fn(() => vi.fn())
    }

    render(<App />)

    // The rejection degrades to the onboarding/empty state rather than a
    // permanent null render — this heading only exists once `loaded` flips.
    expect(await screen.findByRole('heading', { name: 'CodeSpace' })).toBeTruthy()
  })
})
