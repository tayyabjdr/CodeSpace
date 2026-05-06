// EditorPane — right-docked file viewer/editor. Phase 3 skeleton.
// CodeMirror is wired in Phase 4; the body slot renders a <pre> placeholder
// so the layout/header/states can be verified independently.

import { useCallback } from 'react'
import './EditorPane.css'

const REASON_COPY = {
  'not-found':  { title: 'File no longer at this path', body: 'It may have been moved or deleted.', cta: null },
  'too-large':  { title: 'File too large to open in CodeSpace', body: 'Files larger than 20 MB must be opened externally.', cta: 'reveal' },
  'binary':     { title: 'Binary file', body: 'CodeSpace only opens text files.', cta: 'reveal' },
  'denied':     { title: "Couldn't read this file", body: 'Permission denied.', cta: 'retry' },
  'unknown':    { title: "Couldn't read this file", body: 'Unknown error.', cta: 'retry' },
}

function basename(p) {
  if (!p) return ''
  const m = p.match(/[^\\/]+$/)
  return m ? m[0] : p
}

export default function EditorPane({
  file, dirty, isExternal, isPlain,
  loadState, content, errorReason,
  width,
  onClose, onRevealInFolder, onRetry,
}) {
  const handleReveal = useCallback(() => file && onRevealInFolder?.(file), [file, onRevealInFolder])
  const reason = errorReason ? REASON_COPY[errorReason] : null

  return (
    <div className="editor-pane" style={width ? { flex: `0 0 ${width}px` } : undefined}>
      {file && (
        <div className="editor-pane-header">
          <span
            data-testid="dirty-dot"
            className={`editor-dirty-dot ${dirty ? 'is-dirty' : ''}`}
            aria-hidden="true"
          />
          <span className="editor-filename" title={file}>{basename(file)}</span>
          {isExternal && <span className="editor-chip">EXTERNAL</span>}
          {isPlain && <span className="editor-chip">PLAIN</span>}
          <div className="editor-pane-actions">
            <button className="editor-icon-btn" title="Reveal in folder" onClick={handleReveal}>↗</button>
            <button className="editor-icon-btn editor-close-btn" title="Close editor" onClick={onClose}>×</button>
          </div>
        </div>
      )}

      {!file && (
        <div className="editor-empty">
          <span className="editor-empty-mark">✦</span>
          <p className="editor-empty-title">Editor is open</p>
          <p className="editor-empty-hint">Ctrl+click any path in your terminal</p>
        </div>
      )}

      {file && loadState === 'loading' && (
        <div className="editor-body">
          <div className="editor-loading-bar" />
        </div>
      )}

      {file && loadState === 'content' && (
        <div className="editor-body">
          <pre className="editor-pre">{content ?? ''}</pre>
        </div>
      )}

      {file && loadState === 'error' && (
        <div className="pane-error">
          <p className="pane-error-title">{reason?.title ?? "Couldn't open this file"}</p>
          <p className="pane-error-body">{reason?.body ?? ''}</p>
          {reason?.cta === 'reveal' && (
            <button className="pane-error-btn" onClick={handleReveal}>Reveal in folder</button>
          )}
          {reason?.cta === 'retry' && (
            <button className="pane-error-btn" onClick={onRetry}>Try again</button>
          )}
        </div>
      )}
    </div>
  )
}
