// EditorPane — right-docked file viewer/editor. Phase 3 skeleton.
// CodeMirror is wired in Phase 4; the body slot renders a <pre> placeholder
// so the layout/header/states can be verified independently.

import { useCallback, useEffect, useRef, useState } from 'react'
import useEditor, { PLAIN_MODE_THRESHOLD } from '../hooks/useEditor.js'
import { isProbablyText, rejectBody } from '../text-file.js'
import './EditorPane.css'

// How long a refusal stays on screen before fading out.
const REJECT_MS = 2600

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
  width, fontSize, themeId, initialLine,
  isFullscreen, onToggleFullscreen,
  onClose, onRevealInFolder, onRetry,
  onSave, onDirtyChange, onChange, onScroll,
  onDropFile, onBrowse,
}) {
  const handleReveal = useCallback(() => file && onRevealInFolder?.(file), [file, onRevealInFolder])
  const reason = errorReason ? REASON_COPY[errorReason] : null

  const [dragOver, setDragOver] = useState(false)
  const [reject, setReject] = useState(null)
  const rejectTimer = useRef(null)
  useEffect(() => () => clearTimeout(rejectTimer.current), [])

  const flashReject = useCallback((name, why) => {
    clearTimeout(rejectTimer.current)
    setReject({ name, body: rejectBody(why) })
    rejectTimer.current = setTimeout(() => setReject(null), REJECT_MS)
  }, [])

  // Drops are handled in the CAPTURE phase and stopped there. CodeMirror
  // installs its own drop handler that reads a dropped file and pastes the
  // text into the open document — it must never see the event. Only `Files`
  // drags are intercepted, so CodeMirror keeps its own drag-to-move-text.
  const carriesFiles = (dt) => !!dt && Array.from(dt.types ?? []).includes('Files')

  const handleDragOver = (e) => {
    if (!carriesFiles(e.dataTransfer)) return
    e.preventDefault()   // also tells App's window-level swallow to skip this
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }

  // onBrowse resolves to null (opened, or the dialog was cancelled) or to
  // { path, reason } — it finds its own path, so it can't take one like a drop.
  const handleBrowse = () => {
    Promise.resolve(onBrowse?.()).then(res => {
      if (res?.reason) flashReject(basename(res.path ?? ''), res.reason)
    })
  }

  const handleDrop = (e) => {
    if (!carriesFiles(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const path = Array.from(e.dataTransfer.files ?? [])[0]?.path
    if (!path) return
    const name = basename(path)
    if (!isProbablyText(name)) {
      flashReject(name, 'not-text')
      return
    }
    clearTimeout(rejectTimer.current)
    setReject(null)
    Promise.resolve(onDropFile?.(path)).then(why => { if (why) flashReject(name, why) })
  }

  return (
    <div
      className={`editor-pane${isFullscreen ? ' fullscreen' : ''}${dragOver ? ' drag-over' : ''}`}
      style={width && !isFullscreen ? { flex: `0 0 ${width}px` } : undefined}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {file && (
        <div
          className="editor-pane-header"
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) onToggleFullscreen?.()
          }}
        >
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
            <button
              className={`editor-icon-btn editor-fs-btn${isFullscreen ? ' is-active' : ''}`}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="9 4 9 9 4 9" />
                  <polyline points="20 9 15 9 15 4" />
                  <polyline points="15 20 15 15 20 15" />
                  <polyline points="4 15 9 15 9 20" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="4 9 4 4 9 4" />
                  <polyline points="15 4 20 4 20 9" />
                  <polyline points="20 15 20 20 15 20" />
                  <polyline points="9 20 4 20 4 15" />
                </svg>
              )}
            </button>
            <button className="editor-icon-btn editor-close-btn" title="Close editor" onClick={onClose}>×</button>
          </div>
        </div>
      )}

      {!file && (
        <div className="editor-empty" onDoubleClick={handleBrowse}>
          <span className="editor-empty-mark">✦</span>
          <p className="editor-empty-title">Drop a file here</p>
          <p className="editor-empty-hint">or double-click to browse</p>
          <p className="editor-empty-alt">Ctrl+click a path in your terminal</p>
        </div>
      )}

      {file && loadState === 'loading' && (
        <div className="editor-body">
          <div className="editor-loading-bar" />
        </div>
      )}

      {file && loadState === 'content' && (
        <div className="editor-body">
          <EditorBody
            file={file}
            line={initialLine}
            content={content ?? ''}
            fontSize={fontSize}
            themeId={themeId}
            onSave={onSave}
            onDirtyChange={onDirtyChange}
            onChange={onChange}
            onScroll={onScroll}
          />
        </div>
      )}

      {reject && (
        <div className="editor-reject" role="status">
          <p className="editor-reject-title">Can't open {reject.name}</p>
          <p className="editor-reject-body">{reject.body}</p>
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

function EditorBody({ file, line, content, fontSize, themeId, onSave, onDirtyChange, onChange, onScroll }) {
  const hostRef = useRef(null)
  const isPlain = (content?.length ?? 0) >= PLAIN_MODE_THRESHOLD
  const { jumpToLine } = useEditor({ hostRef, file, content, isPlain, fontSize, themeId, onSave, onDirtyChange, onChange, onScroll })

  useEffect(() => { if (line) jumpToLine(line) }, [file, line]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className="editor-cm-host" />
}
