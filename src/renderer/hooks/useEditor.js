import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { buildTheme, buildHighlightStyle } from '../codemirror-theme.js'

export const PLAIN_MODE_THRESHOLD = 2 * 1024 * 1024 // 2 MB

function langFor(file) {
  if (!file) return null
  const ext = (file.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase()
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs':
    case 'ts': case 'tsx':            return javascript({ jsx: true, typescript: ext.startsWith('ts') })
    case 'json':                       return json()
    case 'md': case 'markdown':        return markdown()
    case 'html': case 'htm':           return html()
    case 'css':                        return css()
    default:                            return null
  }
}

export default function useEditor({ hostRef, file, content, isPlain, fontSize, onSave, onDirtyChange, onChange, onScroll }) {
  const viewRef = useRef(null)
  const fontCompartmentRef = useRef(new Compartment())
  const lastSavedRef = useRef(content ?? '')

  const [scrolledToLine, setScrolledToLine] = useState(null)

  // Build / rebuild view when file or plain mode changes.
  useEffect(() => {
    if (!hostRef.current) return
    const lang = isPlain ? null : langFor(file)
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content ?? '',
        extensions: [
          history(),
          drawSelection(),
          isPlain ? [] : highlightActiveLine(),
          isPlain ? [] : lineNumbers(),
          buildTheme(),
          buildHighlightStyle(),
          ...(lang ? [lang] : []),
          fontCompartmentRef.current.of(EditorView.theme({
            '&': { fontSize: `${fontSize}px` }
          })),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: (v) => { onSave?.(v.state.doc.toString()); return true } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const cur = update.state.doc.toString()
              onChange?.(cur)
              const dirty = cur !== lastSavedRef.current
              onDirtyChange?.(dirty)
            }
            if (update.geometryChanged) {
              onScroll?.(view.scrollDOM.scrollTop)
            }
          }),
        ]
      })
    })
    viewRef.current = view
    lastSavedRef.current = content ?? ''
    onDirtyChange?.(false)

    return () => { view.destroy(); viewRef.current = null }
  }, [hostRef, file, isPlain]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update font size without rebuilding the view.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({
      effects: fontCompartmentRef.current.reconfigure(EditorView.theme({
        '&': { fontSize: `${fontSize}px` }
      }))
    })
  }, [fontSize])

  // Mark not-dirty when content prop changes (file swap → caller passes new doc).
  useEffect(() => { lastSavedRef.current = content ?? '' }, [content])

  function markSaved(snapshot) {
    lastSavedRef.current = snapshot
    onDirtyChange?.(false)
  }

  function jumpToLine(line) {
    const v = viewRef.current
    if (!v || !line) return
    const lineCount = v.state.doc.lines
    const target = Math.max(1, Math.min(line, lineCount))
    const pos = v.state.doc.line(target).from
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
    setScrolledToLine(target)
  }

  return { viewRef, markSaved, jumpToLine, scrolledToLine }
}
