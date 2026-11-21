import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import MarkdownPreview, { renderMarkdown, resolveLocalLink } from '../../src/renderer/components/MarkdownPreview.jsx'
import EditorPane from '../../src/renderer/components/EditorPane.jsx'

describe('renderMarkdown', () => {
  it('renders headings, task lists and tables', () => {
    const html = renderMarkdown('# Title\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toMatch(/<input[^>]*type="checkbox"/)
    expect(html).toContain('<table>')
  })

  it('strips scripts and event handlers from raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })
})

describe('resolveLocalLink', () => {
  const file = 'D:\\docs\\guide\\README.md'
  it('resolves relative links against the file folder', () => {
    expect(resolveLocalLink(file, './setup.md')).toBe('D:\\docs\\guide\\setup.md')
    expect(resolveLocalLink(file, '../other%20file.md#part')).toBe('D:\\docs\\other file.md')
  })
  it('keeps absolute Windows paths', () => {
    expect(resolveLocalLink(file, 'C:/x/y.md')).toBe('C:\\x\\y.md')
  })
  it('ignores web links and anchors', () => {
    expect(resolveLocalLink(file, 'https://example.com')).toBeNull()
    expect(resolveLocalLink(file, '#intro')).toBeNull()
    expect(resolveLocalLink(file, 'javascript:alert(1)')).toBeNull()
  })
})

describe('MarkdownPreview links', () => {
  it('sends web links to the OS browser instead of navigating', () => {
    const openExternal = vi.fn()
    window.electronAPI = { openExternal }
    render(<MarkdownPreview file="C:\\a\\b.md" text="[site](https://example.com)" fontSize={13} />)
    fireEvent.click(screen.getByText('site'))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    delete window.electronAPI
  })

  it('opens linked local files in the editor', () => {
    const onOpenFile = vi.fn()
    render(<MarkdownPreview file="C:\\a\\b.md" text="[next](next.md)" fontSize={13} onOpenFile={onOpenFile} />)
    fireEvent.click(screen.getByText('next'))
    expect(onOpenFile).toHaveBeenCalledWith('C:\\a\\next.md')
  })
})

describe('EditorPane markdown view', () => {
  const props = {
    file: 'C:\\notes\\plan.md', dirty: false, width: 600, fontSize: 13,
    loadState: 'content', content: '# Plan\n\nSome **bold** text',
    onSave: vi.fn(), onClose: vi.fn(), onRevealInFolder: vi.fn(),
  }
  beforeEach(() => localStorage.clear())

  it('opens .md files as a rendered document by default', () => {
    const { container } = render(<EditorPane {...props} />)
    expect(container.querySelector('.md-preview-doc h1')?.textContent).toBe('Plan')
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to source and remembers the choice', () => {
    const { container, unmount } = render(<EditorPane {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(container.querySelector('.md-preview')).toBeNull()
    expect(container.querySelector('.editor-cm-host')).not.toHaveAttribute('hidden')
    unmount()
    const again = render(<EditorPane {...props} />)
    expect(again.container.querySelector('.md-preview')).toBeNull()
  })

  it('starts on the source when opened at a line', () => {
    const { container } = render(<EditorPane {...props} initialLine={3} />)
    expect(container.querySelector('.md-preview')).toBeNull()
  })

  it('shows no toggle for non-markdown files', () => {
    render(<EditorPane {...props} file="C:\\x\\a.js" content="let a" />)
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })
})
