import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// The code editor always uses Tokyo Night (the "Night" variant of
// enkia.tokyo-night) for its syntax colours, whatever the app theme is. The
// background is the exception: it reads the terminal surface token, so the
// editor and the terminal cards sit on the same colour.
// The --cs-cm-* tokens in design-tokens.css are no longer read.
export const TOKYO_NIGHT = {
  bg:            '#1a1b26',
  fg:            'rgba(255, 255, 255, 0.92)',   // plain text, white like the app's primary text
  fgBright:      'rgba(255, 255, 255, 0.92)',
  comment:       'rgba(255, 255, 255, 0.34)',   // matches lineNumber
  lineNumber:    'rgba(255, 255, 255, 0.34)',   // neutral grey, not Tokyo navy
  punctuation:   'rgba(255, 255, 255, 0.44)',   // lineNumber + 10 points
  lineNumberAct: 'rgba(255, 255, 255, 0.78)',
  activeLine:    'rgba(255, 255, 255, 0.035)',
  selection:     'rgba(81, 92, 126, 0.45)',
  match:         'rgba(115, 122, 162, 0.3)',
  red:           '#f7768e',
  orange:        '#ff9e64',
  yellow:        '#e0af68',
  green:         '#9ece6a',
  teal:          '#73daca',
  cyan:          '#7dcfff',
  lightCyan:     '#b4f9f8',
  blue:          '#7aa2f7',
  blueBright:    '#2ac3de',
  operator:      '#89ddff',
  purple:        '#bb9af7',
}

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTheme() {
  const c = TOKYO_NIGHT
  const fontMono = readToken('--cs-font-mono', 'ui-monospace, monospace')
  const bg       = readToken('--cs-bg-surface', '#141414')   // same as .xterm-container

  return EditorView.theme({
    '&': {
      backgroundColor: bg,
      color: c.fg,
      fontFamily: fontMono,
      height: '100%',
    },
    '.cm-content':       { caretColor: c.fgBright, padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.fgBright, borderLeftWidth: '1.5px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: c.selection },
    '.cm-activeLine':       { backgroundColor: c.activeLine },
    '.cm-activeLineGutter': { backgroundColor: c.activeLine, color: c.lineNumberAct },
    '.cm-selectionMatch':   { backgroundColor: c.match },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: c.match, outline: 'none' },
    '.cm-searchMatch':      { backgroundColor: 'rgba(61, 89, 161, 0.35)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(61, 89, 161, 0.6)' },
    '.cm-gutters': {
      backgroundColor: bg,
      color: c.lineNumber,
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: fontMono,
      fontVariantNumeric: 'tabular-nums',
      padding: '0 12px 0 8px',
    },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: c.comment },
    '.cm-tooltip': { backgroundColor: '#16161e', border: '1px solid #101014', color: c.fg },
    '&.cm-focused':         { outline: 'none' },
    '.cm-scroller':         { fontFamily: fontMono, lineHeight: '1.55' },
  }, { dark: true })
}

export function buildHighlightStyle() {
  const c = TOKYO_NIGHT

  return syntaxHighlighting(HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier], color: c.purple },
    { tag: [t.operatorKeyword, t.operator, t.derefOperator], color: c.operator },
    { tag: [t.punctuation, t.separator, t.bracket], color: c.punctuation },
    { tag: [t.string, t.special(t.string), t.docString], color: c.green },
    { tag: [t.regexp], color: c.lightCyan },
    { tag: [t.escape], color: c.operator },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.comment, fontStyle: 'italic' },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: c.orange },
    { tag: [t.variableName], color: c.fgBright },
    { tag: [t.definition(t.variableName)], color: c.fgBright },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: c.blue },
    { tag: [t.self, t.special(t.variableName)], color: c.red },
    { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: c.orange },
    { tag: [t.propertyName], color: c.teal },
    { tag: [t.definition(t.propertyName)], color: c.teal },
    { tag: [t.typeName, t.className, t.namespace], color: c.blueBright },
    { tag: [t.tagName], color: c.red },
    { tag: [t.attributeName], color: c.purple },
    { tag: [t.attributeValue], color: c.green },
    { tag: [t.labelName], color: c.blue },
    { tag: [t.macroName, t.annotation], color: c.cyan },
    { tag: [t.heading], color: c.operator, fontWeight: 'bold' },
    { tag: [t.strong], color: c.orange, fontWeight: 'bold' },
    { tag: [t.emphasis], color: c.purple, fontStyle: 'italic' },
    { tag: [t.link, t.url], color: c.teal, textDecoration: 'underline' },
    { tag: [t.quote], color: c.comment },
    { tag: [t.inserted], color: c.green },
    { tag: [t.deleted], color: c.red },
    { tag: [t.changed], color: c.yellow },
    { tag: [t.invalid], color: '#db4b4b' },
    { tag: [t.meta, t.processingInstruction], color: c.cyan },
  ]))
}
