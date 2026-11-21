// EditorPane — right-docked file viewer/editor. Phase 3 skeleton.
// CodeMirror is wired in Phase 4; the body slot renders a <pre> placeholder
// so the layout/header/states can be verified independently.

import { useCallback, useEffect, useRef, useState } from 'react'
import { openSearchPanel } from '@codemirror/search'
import useEditor, { PLAIN_MODE_THRESHOLD } from '../hooks/useEditor.js'
import MarkdownPreview, { findTaskMarkers } from './MarkdownPreview.jsx'
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

// How many parent folders the header shows ahead of the filename.
const PATH_DEPTH = 5

// Splits a path into the trailing folders worth showing and the filename.
// `clipped` is true when folders above the shown ones were dropped.
function pathParts(p) {
  const segs = (p ?? '').split(/[\\/]+/).filter(Boolean)
  const name = segs.pop() ?? ''
  const dirs = segs.slice(-PATH_DEPTH)
  return { dirs, name, clipped: segs.length > dirs.length }
}

// Markdown files open as a rendered document by default. The last choice
// (preview or source) is remembered across files and sessions.
const MD_VIEW_KEY = 'cs.editor.mdView'
export const isMarkdownFile = (p) => /\.(md|markdown|mdx)$/i.test(p ?? '')

function readMdView() {
  try { return localStorage.getItem(MD_VIEW_KEY) === 'source' ? 'source' : 'preview' } catch { return 'preview' }
}
function writeMdView(v) {
  try { localStorage.setItem(MD_VIEW_KEY, v) } catch { /* storage unavailable */ }
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

  // ── Markdown preview ────────────────────────────────────────────────────
  const isMd = isMarkdownFile(file)
  const [mdView, setMdView] = useState(readMdView)
  // A Ctrl+click on `notes.md:42` means "take me to line 42", which only the
  // source view can do — so a file opened at a line starts on the source.
  const [lineOverride, setLineOverride] = useState(false)
  useEffect(() => { setLineOverride(!!initialLine) }, [file, initialLine])
  const showPreview = isMd && loadState === 'content' && mdView === 'preview' && !lineOverride

  // The text the preview renders: the file as loaded, then every edit made in
  // the source view. The CodeMirror view stays mounted underneath, so its
  // undo history and unsaved edits survive flipping back and forth.
  const [liveText, setLiveText] = useState(content ?? '')
  useEffect(() => { setLiveText(content ?? '') }, [file, content])
  const handleChange = useCallback((text) => { setLiveText(text); onChange?.(text) }, [onChange])

  const viewRef = useRef(null)
  const previewRef = useRef(null)

  // A checkbox clicked in the preview flips its "[ ]"/"[x]" in the source,
  // through CodeMirror so it is undoable and marks the file unsaved.
  const handleToggleTask = useCallback((index) => {
    const v = viewRef.current
    if (!v) return false
    const doc = v.state.doc.toString()
    const markers = findTaskMarkers(doc)
    const boxes = previewRef.current?.querySelectorAll('input[data-task-index]').length
    // Only trust the mapping when the source and the preview agree on count.
    if (boxes !== markers.length || !markers[index]) return false
    const { pos, checked } = markers[index]
    v.dispatch({ changes: { from: pos, to: pos + 1, insert: checked ? ' ' : 'x' } })
    return true
  }, [])
  const pendingSearch = useRef(false)

  const setView = useCallback((v) => {
    setLineOverride(false)
    setMdView(v)
    writeMdView(v)
  }, [])

  // After a flip, put focus where the reader is now looking.
  const prevShowPreview = useRef(showPreview)
  useEffect(() => {
    if (prevShowPreview.current === showPreview) return
    prevShowPreview.current = showPreview
    if (showPreview) { previewRef.current?.focus({ preventScroll: true }); return }
    const v = viewRef.current
    if (!v) return
    v.requestMeasure()
    if (pendingSearch.current) {
      pendingSearch.current = false
      openSearchPanel(v)
    } else {
      v.focus()
    }
  }, [showPreview])

  const handlePaneKeyDown = (e) => {
    if (!isMd || loadState !== 'content') return
    const k = e.key.toLowerCase()
    if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'v') {
      e.preventDefault()
      setView(showPreview ? 'source' : 'preview')
      return
    }
    if (!showPreview || !e.ctrlKey || e.shiftKey || e.altKey) return
    if (k === 'f') {
      // Find works on the source, so jump there with the search box open.
      e.preventDefault()
      pendingSearch.current = true
      setView('source')
    } else if (k === 's') {
      e.preventDefault()
      onSave?.(liveText)
    }
  }

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
      onKeyDown={handlePaneKeyDown}
    >
      {file && (
        <div
          className="editor-pane-header"
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) onToggleFullscreen?.()
          }}
        >
          <span className="editor-path" title={file}>
            {(() => {
              const { dirs, name, clipped } = pathParts(file)
              return (
                <>
                  {(clipped || dirs.length > 0) && (
                    <span className="editor-path-dirs">
                      <bdi dir="ltr">
                        {(clipped ? '…\\' : '') + dirs.map(d => d + '\\').join('')}
                      </bdi>
                    </span>
                  )}
                  <span className="editor-filename">{name}</span>
                </>
              )
            })()}
          </span>
          {/* After the name, and takes no room at all while clean, so the
              header never has an empty gap and the name never shifts. */}
          <span
            data-testid="dirty-dot"
            className={`editor-dirty-dot ${dirty ? 'is-dirty' : ''}`}
            title={dirty ? 'Unsaved changes' : undefined}
            aria-hidden="true"
          />
          {isExternal &&<span className="editor-chip">EXTERNAL</span>}
          {isPlain && <span className="editor-chip">PLAIN</span>}
          <div className="editor-pane-actions">
            {isMd && loadState === 'content' && (
              <div className="editor-view-toggle" role="group" aria-label="Markdown view">
                <button
                  type="button"
                  className={`editor-view-opt${showPreview ? ' is-active' : ''}`}
                  aria-pressed={showPreview}
                  title="Read as a document (Ctrl+Shift+V)"
                  onClick={() => setView('preview')}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={`editor-view-opt${!showPreview ? ' is-active' : ''}`}
                  aria-pressed={!showPreview}
                  title="Edit the source (Ctrl+Shift+V)"
                  onClick={() => setView('source')}
                >
                  Source
                </button>
              </div>
            )}
            <button className="editor-icon-btn" title="Reveal in folder" onClick={handleReveal}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 5h5v5" />
                <line x1="19" y1="5" x2="11" y2="13" />
                <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
              </svg>
            </button>
            <button
              className={`editor-icon-btn editor-fs-btn${isFullscreen ? ' is-active' : ''}`}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="9 4 9 9 4 9" />
                  <polyline points="20 9 15 9 15 4" />
                  <polyline points="15 20 15 15 20 15" />
                  <polyline points="4 15 9 15 9 20" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="4 9 4 4 9 4" />
                  <polyline points="15 4 20 4 20 9" />
                  <polyline points="20 15 20 20 15 20" />
                  <polyline points="9 20 4 20 4 15" />
                </svg>
              )}
            </button>
            <button className="editor-icon-btn editor-close-btn" title="Close editor" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {!file && (
        <div className="editor-pane-header">
          <span className="editor-filename is-placeholder">Editor</span>
          <div className="editor-pane-actions">
            {onClose && (
              <button className="editor-icon-btn editor-close-btn" title="Close editor" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
            )}
          </div>
        </div>
      )}

      {!file && (
        <div className="editor-empty" onDoubleClick={handleBrowse}>
          <div className="editor-empty-inner">
            <span className="editor-empty-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <polyline points="14 3 14 8 19 8" />
                <polyline points="10 13 8.5 14.5 10 16" />
                <polyline points="14 13 15.5 14.5 14 16" />
              </svg>
            </span>
            <p className="editor-empty-title">No file open</p>
            <p className="editor-empty-sub">Open a file to read or edit it next to your agents.</p>
            <button
              type="button"
              className="editor-empty-btn"
              onClick={handleBrowse}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              Browse files
            </button>
            <ul className="editor-empty-ways">
              <li>
                <span className="editor-empty-way-label">Drop a file here</span>
                <span className="editor-empty-keys"><kbd>Drag</kbd></span>
              </li>
              <li>
                <span className="editor-empty-way-label">Open a path from a terminal</span>
                <span className="editor-empty-keys"><kbd>Ctrl</kbd><kbd>Click</kbd></span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {file && loadState === 'loading' && (
        <div className="editor-body">
          <div className="editor-loading-bar" />
        </div>
      )}

      {file && loadState === 'content' && (
        <div className={`editor-body${showPreview ? ' is-preview' : ''}`}>
          <EditorBody
            file={file}
            line={initialLine}
            content={content ?? ''}
            fontSize={fontSize}
            themeId={themeId}
            hidden={showPreview}
            viewHandle={viewRef}
            onSave={onSave}
            onDirtyChange={onDirtyChange}
            onChange={handleChange}
            onScroll={onScroll}
          />
          {isMd && (
            <MarkdownPreview
              ref={previewRef}
              file={file}
              text={liveText}
              fontSize={fontSize}
              hidden={!showPreview}
              onToggleTask={handleToggleTask}
              onOpenFile={(path) => {
                Promise.resolve(onDropFile?.(path)).then(why => { if (why) flashReject(basename(path), why) })
              }}
            />
          )}
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

function EditorBody({ file, line, content, fontSize, themeId, hidden, viewHandle, onSave, onDirtyChange, onChange, onScroll }) {
  const hostRef = useRef(null)
  const isPlain = (content?.length ?? 0) >= PLAIN_MODE_THRESHOLD
  const { viewRef, jumpToLine } = useEditor({ hostRef, file, content, isPlain, fontSize, themeId, onSave, onDirtyChange, onChange, onScroll })

  useEffect(() => { if (line) jumpToLine(line) }, [file, line]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hand the live view up so the pane can focus it / open its search box.
  useEffect(() => {
    if (viewHandle) viewHandle.current = viewRef.current
  })

  return <div ref={hostRef} className="editor-cm-host" hidden={hidden} />
}
