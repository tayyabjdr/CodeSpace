import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTheme() {
  const bg        = readToken('--cs-bg-surface',   '#0d0f12')
  const sidebarBg = readToken('--cs-bg-sidebar',   '#0a0c0f')
  const border    = readToken('--cs-border',       '#1b1e24')
  const cyan      = readToken('--cs-cyan',         '#67e8f9')
  const muted     = readToken('--cs-text-muted',   'rgba(255,255,255,0.28)')
  const primary   = readToken('--cs-text-primary', 'rgba(255,255,255,0.92)')
  const selection = readToken('--cs-cm-selection', 'rgba(103, 232, 249, 0.18)')
  const fontMono  = readToken('--cs-font-mono',    'ui-monospace, monospace')

  return EditorView.theme({
    '&': {
      backgroundColor: bg,
      color: primary,
      fontFamily: fontMono,
      height: '100%',
    },
    '.cm-content':       { caretColor: cyan, padding: '8px 0' },
    '.cm-cursor':        { borderLeftColor: cyan, borderLeftWidth: '1.5px' },
    '.cm-selectionBackground, ::selection': { backgroundColor: selection },
    '.cm-activeLine':       { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: sidebarBg,
      color: muted,
      borderRight: `1px solid ${border}`,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: fontMono,
      fontVariantNumeric: 'tabular-nums',
      padding: '0 8px',
    },
    '&.cm-focused':         { outline: 'none' },
    '.cm-scroller':         { fontFamily: fontMono, lineHeight: '1.55' },
  }, { dark: true })
}

export function buildHighlightStyle() {
  const keyword   = readToken('--cs-cm-keyword',   '#67e8f9')
  const string    = readToken('--cs-cm-string',    '#86efac')
  const number    = readToken('--cs-cm-number',    '#f59e0b')
  const type      = readToken('--cs-cm-type',      '#67e8f9')
  const tag       = readToken('--cs-cm-tag',       '#67e8f9')
  const attribute = readToken('--cs-cm-attribute', '#86efac')
  const comment   = readToken('--cs-cm-comment',   'rgba(255,255,255,0.28)')
  const primary   = readToken('--cs-text-primary', 'rgba(255,255,255,0.92)')
  const secondary = readToken('--cs-text-secondary','rgba(255,255,255,0.78)')
  const tertiary  = readToken('--cs-text-tertiary','rgba(255,255,255,0.42)')

  return syntaxHighlighting(HighlightStyle.define([
    { tag: t.keyword,                       color: keyword },
    { tag: [t.string, t.special(t.string)], color: string },
    { tag: t.comment,                       color: comment, fontStyle: 'italic' },
    { tag: [t.number, t.bool, t.null],      color: number },
    { tag: t.variableName,                  color: primary },
    { tag: t.function(t.variableName),      color: primary },
    { tag: t.typeName,                      color: type },
    { tag: t.propertyName,                  color: secondary },
    { tag: t.operator,                      color: tertiary },
    { tag: t.punctuation,                   color: tertiary },
    { tag: t.tagName,                       color: tag },
    { tag: t.attributeName,                 color: attribute },
  ]))
}
