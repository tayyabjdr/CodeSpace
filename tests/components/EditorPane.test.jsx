import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import EditorPane from '../../src/renderer/components/EditorPane.jsx'

const baseProps = {
  file: null, line: null, dirty: false, width: 600,
  fontSize: 13, isExternal: false,
  onSave: vi.fn(), onClose: vi.fn(), onResize: vi.fn(), onRevealInFolder: vi.fn(),
}

describe('EditorPane', () => {
  it('renders empty state when file is null', () => {
    render(<EditorPane {...baseProps} />)
    expect(screen.getByText(/Drop a file here/i)).toBeInTheDocument()
  })

  it('renders filename in header when file is set', () => {
    render(<EditorPane {...baseProps} file="C:\\Users\\TJ\\src\\foo.ts" loadState="content" content="hi" />)
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
  })

  it('shows dirty dot when dirty is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" dirty loadState="content" content="" />)
    expect(screen.getByTestId('dirty-dot')).toHaveClass('is-dirty')
  })

  it('shows external badge when isExternal is true', () => {
    render(<EditorPane {...baseProps} file="C:\\foo.ts" isExternal loadState="content" content="" />)
    expect(screen.getByText(/external/i)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<EditorPane {...baseProps} file="C:\\foo.ts" onClose={onClose} loadState="content" content="" />)
    fireEvent.click(screen.getByTitle('Close editor'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error UI for too-large state', () => {
    render(<EditorPane {...baseProps} file="C:\\big" loadState="error" errorReason="too-large" />)
    expect(screen.getByText(/too large/i)).toBeInTheDocument()
    expect(screen.getByText(/reveal in folder/i)).toBeInTheDocument()
  })
})

// ── Drag-and-drop / browse ────────────────────────────────────────────────
// A file drop must never reach CodeMirror: its own drop handler reads the
// file and pastes the text into the open document.

const fileDrag = (...files) => ({
  dataTransfer: {
    types: ['Files'],
    files: files.map(name => ({ name, path: `C:/Users/TJ/src/${name}` })),
  },
})

const openProps = { ...baseProps, file: 'C:/Users/TJ/src/App.jsx', loadState: 'content', content: 'hi' }

describe('EditorPane drag-and-drop', () => {
  it('highlights the pane while OS files are dragged over it', () => {
    const { container } = render(<EditorPane {...openProps} onDropFile={vi.fn()} />)
    const pane = container.querySelector('.editor-pane')
    const notCancelled = fireEvent.dragOver(pane, fileDrag('notes.md'))
    expect(notCancelled).toBe(false) // preventDefault — App's window swallow must skip this
    expect(pane).toHaveClass('drag-over')
  })

  it('ignores drags that carry no files', () => {
    const { container } = render(<EditorPane {...openProps} onDropFile={vi.fn()} />)
    const pane = container.querySelector('.editor-pane')
    const notCancelled = fireEvent.dragOver(pane, {
      dataTransfer: { types: ['application/x-codespace-skill'], files: [] },
    })
    expect(notCancelled).toBe(true)
    expect(pane).not.toHaveClass('drag-over')
  })

  it('clears the highlight on drag leave', () => {
    const { container } = render(<EditorPane {...openProps} onDropFile={vi.fn()} />)
    const pane = container.querySelector('.editor-pane')
    fireEvent.dragOver(pane, fileDrag('notes.md'))
    fireEvent.dragLeave(pane)
    expect(pane).not.toHaveClass('drag-over')
  })

  it('clears the highlight once the file is dropped', () => {
    const { container } = render(<EditorPane {...openProps} onDropFile={vi.fn(async () => null)} />)
    const pane = container.querySelector('.editor-pane')
    fireEvent.dragOver(pane, fileDrag('notes.md'))
    fireEvent.drop(pane, fileDrag('notes.md'))
    expect(pane).not.toHaveClass('drag-over')
  })

  it('opens a dropped text file', () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...openProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('notes.md'))
    expect(onDropFile).toHaveBeenCalledWith('C:/Users/TJ/src/notes.md')
  })

  it('stops a file drop before CodeMirror can paste it into the open document', () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...openProps} onDropFile={onDropFile} />)
    const inner = container.querySelector('.editor-cm-host')
    const codemirror = vi.fn()
    inner.addEventListener('drop', codemirror)
    fireEvent.drop(inner, fileDrag('notes.md'))
    expect(onDropFile).toHaveBeenCalled()
    expect(codemirror).not.toHaveBeenCalled()
  })

  it('opens only the first file when several are dropped', () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...openProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('one.md', 'two.md'))
    expect(onDropFile).toHaveBeenCalledTimes(1)
    expect(onDropFile).toHaveBeenCalledWith('C:/Users/TJ/src/one.md')
  })

  it('refuses a dropped image without disturbing the open file', async () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...openProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('logo.png'))
    expect(await screen.findByText("Can't open logo.png")).toBeInTheDocument()
    expect(screen.getByText('Not a text file')).toBeInTheDocument()
    expect(onDropFile).not.toHaveBeenCalled()
    expect(screen.getByText('App.jsx')).toBeInTheDocument()
  })

  it('reports the reason when the probe refuses the file', async () => {
    const onDropFile = vi.fn(async () => 'too-large')
    const { container } = render(<EditorPane {...openProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('huge.log'))
    expect(await screen.findByText("Can't open huge.log")).toBeInTheDocument()
    expect(screen.getByText('Larger than 20 MB')).toBeInTheDocument()
  })

  it('shows no message when the file opens cleanly', async () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...baseProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('notes.md'))
    await waitFor(() => expect(onDropFile).toHaveBeenCalled())
    expect(screen.queryByText(/Can't open/)).not.toBeInTheDocument()
  })

  it('accepts a drop on the empty state', () => {
    const onDropFile = vi.fn(async () => null)
    const { container } = render(<EditorPane {...baseProps} onDropFile={onDropFile} />)
    fireEvent.drop(container.querySelector('.editor-pane'), fileDrag('notes.md'))
    expect(onDropFile).toHaveBeenCalledWith('C:/Users/TJ/src/notes.md')
  })
})

describe('EditorPane browse', () => {
  it('opens the file browser when the empty state is double-clicked', () => {
    const onBrowse = vi.fn()
    const { container } = render(<EditorPane {...baseProps} onBrowse={onBrowse} />)
    fireEvent.doubleClick(container.querySelector('.editor-empty'))
    expect(onBrowse).toHaveBeenCalled()
  })

  it('reports a refusal from the file browser', async () => {
    const onBrowse = vi.fn(async () => ({ path: 'C:/pics/logo.png', reason: 'not-text' }))
    const { container } = render(<EditorPane {...baseProps} onBrowse={onBrowse} />)
    fireEvent.doubleClick(container.querySelector('.editor-empty'))
    expect(await screen.findByText("Can't open logo.png")).toBeInTheDocument()
    expect(screen.getByText('Not a text file')).toBeInTheDocument()
  })

  it('shows nothing when the file browser is cancelled', async () => {
    const onBrowse = vi.fn(async () => null)
    const { container } = render(<EditorPane {...baseProps} onBrowse={onBrowse} />)
    fireEvent.doubleClick(container.querySelector('.editor-empty'))
    await waitFor(() => expect(onBrowse).toHaveBeenCalled())
    expect(screen.queryByText(/Can't open/)).not.toBeInTheDocument()
  })

  it('does not browse on a double-click in the editor body', () => {
    const onBrowse = vi.fn()
    const { container } = render(<EditorPane {...openProps} onBrowse={onBrowse} />)
    fireEvent.doubleClick(container.querySelector('.editor-body'))
    expect(onBrowse).not.toHaveBeenCalled()
  })
})
