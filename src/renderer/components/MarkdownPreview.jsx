// MarkdownPreview — renders a .md file as a document instead of source.
//
// The HTML comes from marked and is always run through DOMPurify before it
// touches the DOM: a markdown file can carry raw HTML, and this renderer has
// window.electronAPI on it. Links never navigate the window — web links go to
// the OS browser, links to other files open in the editor, #anchors scroll.

import { forwardRef, useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function renderMarkdown(text) {
  const html = marked.parse(text ?? '', { gfm: true, breaks: false, async: false })
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] })
}

export function slugify(s) {
  return (s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

// Resolves a link in the document against the folder of the file it sits in.
// Returns an absolute Windows-style path, or null for anything that isn't a
// local file reference.
export function resolveLocalLink(file, href) {
  if (!href) return null
  // Any scheme (http:, file:, javascript:, …) except a bare drive letter.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return null
  let target = href.split('#')[0].split('?')[0]
  if (!target) return null
  try { target = decodeURIComponent(target) } catch { /* keep as written */ }
  if (/^[a-z]:[\\/]/i.test(target) || target.startsWith('\\\\')) return target.replace(/\//g, '\\')
  const segs = (file ?? '').split(/[\\/]+/)
  segs.pop() // the file's own name
  for (const part of target.split(/[\\/]+/)) {
    if (!part || part === '.') continue
    if (part === '..') { if (segs.length > 1) segs.pop(); continue }
    segs.push(part)
  }
  return segs.join('\\')
}

const MarkdownPreview = forwardRef(function MarkdownPreview(
  { file, text, fontSize, onOpenFile, hidden },
  ref,
) {
  const html = useMemo(() => (hidden ? null : renderMarkdown(text)), [text, hidden])
  const innerRef = useRef(null)

  // Give headings ids so in-document #links have somewhere to land.
  useEffect(() => {
    const root = innerRef.current
    if (!root || html == null) return
    const seen = new Map()
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      const base = slugify(h.textContent) || 'section'
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      h.id = n ? `${base}-${n}` : base
    })
  }, [html])

  const handleClick = (e) => {
    const a = e.target.closest?.('a[href]')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      window.electronAPI?.openExternal?.(href)
      return
    }
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      const el = innerRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    const path = resolveLocalLink(file, href)
    if (path) onOpenFile?.(path)
  }

  if (hidden) return null

  return (
    <div
      ref={ref}
      className="md-preview"
      tabIndex={0}
      onClick={handleClick}
      style={{ '--md-font-size': `${fontSize + 1}px` }}
    >
      <article
        ref={innerRef}
        className="md-preview-doc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})

export default MarkdownPreview
