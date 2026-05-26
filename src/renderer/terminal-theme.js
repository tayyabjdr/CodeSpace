function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function buildTerminalTheme() {
  const bg = readToken('--cs-term-bg', '#0d0f12')
  return {
    background: bg,
    foreground: readToken('--cs-term-fg', 'rgba(255,255,255,0.85)'),
    cursor: readToken('--cs-term-cursor', 'rgba(255,255,255,0.8)'),
    cursorAccent: bg,
    selectionBackground: readToken('--cs-term-selection', 'rgba(255,255,255,0.12)'),
    black:         readToken('--cs-term-black',         '#0a0a0a'),
    brightBlack:   readToken('--cs-term-bright-black',  '#3f3f3f'),
    red:           readToken('--cs-term-red',           '#f87171'),
    brightRed:     readToken('--cs-term-bright-red',    '#fca5a5'),
    green:         readToken('--cs-term-green',         '#86efac'),
    brightGreen:   readToken('--cs-term-bright-green',  '#bbf7d0'),
    yellow:        readToken('--cs-term-yellow',        '#fcd34d'),
    brightYellow:  readToken('--cs-term-bright-yellow', '#fde68a'),
    blue:          readToken('--cs-term-blue',          '#93c5fd'),
    brightBlue:    readToken('--cs-term-bright-blue',   '#bfdbfe'),
    magenta:       readToken('--cs-term-magenta',       '#c4b5fd'),
    brightMagenta: readToken('--cs-term-bright-magenta','#ddd6fe'),
    cyan:          readToken('--cs-term-cyan',          '#67e8f9'),
    brightCyan:    readToken('--cs-term-bright-cyan',   '#a5f3fc'),
    white:         readToken('--cs-term-white',         'rgba(255,255,255,0.78)'),
    brightWhite:   readToken('--cs-term-bright-white',  'rgba(255,255,255,0.92)'),
  }
}
