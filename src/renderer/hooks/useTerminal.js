import { useEffect, useState, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import * as ptyPool from '../pty-pool.js'
import { parsePathsInLine } from '../path-parser.js'
import { resolvePath } from '../path-resolver.js'
import { FONT_RESIZE_DEBOUNCE_MS, PTY_RESIZE_DEBOUNCE_MS } from '../constants.js'
import { buildTerminalTheme } from '../terminal-theme.js'
import { windowsPtyOption } from '../windows-pty.js'
import { logicalLineAt, spanToRange, spanCrossesRows } from '../wrapped-line.js'
import { isProbablyText } from '../text-file.js'

// Adapts the xterm buffer to the {text, isWrapped} rows wrapped-line.js reads.
function rowGetter(term) {
  return (y) => {
    if (y < 0) return null
    const line = term.buffer.active.getLine(y)
    return line ? { text: line.translateToString(true), isWrapped: line.isWrapped } : null
  }
}

// Claude CLI prints OSC 8 hyperlinks, and the same text also matches our own
// URL provider, so one Ctrl+click can activate both. Open a given URL at most
// once per click.
let lastOpened = { url: '', at: 0 }
function openUrlOnce(url) {
  const now = Date.now()
  if (url === lastOpened.url && now - lastOpened.at < 500) return
  lastOpened = { url, at: now }
  window.electronAPI?.openExternal?.(url)
}

export default function useTerminal(termId, ptyId, shell, cwd, containerRef, onActivity, onUserInput, onPtyReady, fontSize, onFontSizeChange, linkOpts, themeId, port) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(ptyId)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const onPtyReadyRef = useRef(onPtyReady)
  const onFontSizeChangeRef = useRef(onFontSizeChange)
  const linkOptsRef = useRef(linkOpts)
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize

  // Dimensions last pushed to the PTY. ConPTY's ResizePseudoConsole is
  // unconditional — it rewraps the console buffer and signals the child even
  // when the size hasn't changed — and node-pty passes every call straight
  // through, so a resize that doesn't cross a character-cell boundary must
  // never reach it. Every PTY resize in this hook goes through here.
  const lastPtyDimsRef = useRef(null)
  const syncPtySize = useCallback((term) => {
    const id = ptyIdRef.current
    if (!id || !term) return
    const last = lastPtyDimsRef.current
    if (last && last.cols === term.cols && last.rows === term.rows) return
    lastPtyDimsRef.current = { cols: term.cols, rows: term.rows }
    ptyPool.resizePty(id, term.cols, term.rows)
  }, [])

  // keep latest callbacks without re-running mount effect
  useEffect(() => { onPtyReadyRef.current = onPtyReady }, [onPtyReady])
  useEffect(() => { onFontSizeChangeRef.current = onFontSizeChange }, [onFontSizeChange])
  useEffect(() => { linkOptsRef.current = linkOpts }, [linkOpts])

  // Sync external fontSize → xterm options.
  // The visual font change is immediate, but fit() + PTY resize is debounced
  // so a scroll burst sends only one SIGWINCH (TUI apps redraw on every signal).
  const fontResizeTimerRef = useRef(null)
  useEffect(() => {
    if (!fontSize || !termRef.current) return
    const term = termRef.current
    term.options.fontSize = fontSize

    clearTimeout(fontResizeTimerRef.current)
    fontResizeTimerRef.current = setTimeout(() => {
      fitRef.current?.fit()
      syncPtySize(term)
      term.scrollToBottom()
    }, FONT_RESIZE_DEBOUNCE_MS)

    return () => clearTimeout(fontResizeTimerRef.current)
  }, [fontSize])

  // When the app theme changes, repaint the xterm palette in-place — no PTY
  // restart, no buffer loss. Tokens are read fresh from CSS.
  useEffect(() => {
    if (!themeId || !termRef.current) return
    termRef.current.options.theme = buildTerminalTheme()
  }, [themeId])

  useEffect(() => {
    if (!containerRef.current) return

    let term
    let fitAddon
    let detach
    let dataDisposable
    let cancelled = false
    let ro

    const winPty = windowsPtyOption(
      window.electronAPI?.platform,
      window.electronAPI?.osRelease
    )

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        // Start at the workspace's size. The sync effect above runs before the
        // terminal exists on first mount, so it can't apply the initial value.
        fontSize: fontSizeRef.current || 13,
        fontFamily: '"Geist Mono Variable", "Geist Mono", "Cascadia Code", monospace',
        lineHeight: 1.5,
        // Don't yank the viewport to the bottom on every keypress. While the
        // user is scrolled up — e.g. navigating a TUI multi-select with the
        // arrow keys — input still reaches the PTY, but the scroll position is
        // left alone. Ctrl+Down (below) is the explicit "jump to bottom".
        scrollOnUserInput: false,
        theme: buildTerminalTheme(),
        // Tell xterm it is reading a Windows ConPTY. Without this it pulls
        // scrollback rows up into the viewport when the terminal grows, while
        // ConPTY opens blank rows at the bottom and repaints into them — the
        // mismatch is what duplicates lines and tears blank gaps into the
        // buffer on resize. Spread so xterm keeps its own default off Windows.
        ...(winPty ? { windowsPty: winPty } : {}),
        // OSC 8 hyperlinks. xterm's default handler calls window.open(), which
        // in Electron spawns a bare CodeSpace window. Send them to the OS
        // browser instead, with the same Ctrl/Cmd-click rule as plain URLs.
        linkHandler: {
          activate: (event, uri) => {
            if (!(event.ctrlKey || event.metaKey)) return
            if (/^https?:\/\//i.test(uri)) openUrlOnce(uri)
          },
          allowNonHttpProtocols: false,
        },
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      termRef.current = term
      fitRef.current = fitAddon

    } catch (err) {
      setError(err.message ?? 'Failed to initialise terminal')
      return
    }

    // Intercept clipboard shortcuts before xterm processes them.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // Shift+Enter → newline inside the current input, not a submit.
      // preventDefault() is required: returning false stops xterm's own
      // key→data conversion, but without it the browser still delivers Enter
      // to xterm's hidden textarea, which gets sent to the PTY as a submit.
      // The bytes are backslash + CR — Claude CLI's terminal-agnostic
      // line-continuation: a trailing "\" followed by Enter becomes a newline.
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const id = ptyIdRef.current
        if (id) ptyPool.writePty(id, '\\\r')
        return false
      }

      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return true

      // Ctrl+Down → jump the viewport to the bottom. With scrollOnUserInput
      // off, plain keys no longer snap down, so this is the explicit gesture
      // to catch up to the latest output. Consumed as a pure scroll — not
      // forwarded to the PTY — so it never disturbs a TUI's own navigation.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        term.scrollToBottom()
        return false
      }

      // Ctrl+= / Ctrl++ / Ctrl+- → font size, same as Ctrl+wheel.
      if (!e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault()
        onFontSizeChangeRef.current?.(e.key === '-' || e.key === '_' ? -1 : 1)
        return false
      }

      // Paste: Ctrl+V or Ctrl+Shift+V
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        const id = ptyIdRef.current
        if (id) {
          window.electronAPI.readClipboardText().then(text => {
            if (text) ptyPool.writePty(id, text)
          })
        }
        return false
      }

      // Copy: Ctrl+C with an active selection copies (and clears the selection
      // so the next Ctrl+C falls through to SIGINT). With no selection, Ctrl+C
      // passes through to the shell as interrupt. Ctrl+Shift+C is preserved as
      // an always-explicit copy shortcut for muscle memory.
      if (e.key === 'c' || e.key === 'C') {
        const sel = term.getSelection()
        if (sel) {
          window.electronAPI.writeClipboardText(sel)
          term.clearSelection()
          e.preventDefault()
          return false
        }
        // No selection — let Ctrl+C through to the PTY as SIGINT.
      }
      return true
    })

    const start = async () => {
      let id = ptyIdRef.current
      try {
        if (!id) {
          // Spawn at the renderer's measured size so Claude's banner doesn't
          // wrap to 80 cols on first paint.
          id = await ptyPool.createPty(shell, cwd, termId, term.cols, term.rows, port)
          ptyIdRef.current = id
          onPtyReadyRef.current?.(id)
        }
        if (cancelled) return

        detach = ptyPool.attach(id, {
          onData: data => {
            term.write(data)
            onActivity?.()
          },
          onExit: code => setExitCode(code)
        })

        dataDisposable = term.onData(data => {
          ptyPool.writePty(id, data)
          onUserInput?.(data)
        })

        syncPtySize(term)
      } catch (err) {
        if (err?.cancelled) return
        if (cancelled) return
        if (err?.code === 'claude-missing') {
          setError({
            code: 'claude-missing',
            title: 'Claude CLI not found',
            body: 'CodeSpace runs the Claude CLI for each agent. Install it from the Anthropic docs and make sure `claude.exe` is on your PATH, then reload.'
          })
        } else if (err?.code === 'cwd-missing') {
          setError({
            code: 'cwd-missing',
            title: 'Folder no longer exists',
            body: `${err.detail?.cwd ?? 'The workspace folder'} can't be opened. Re-create the workspace with the correct folder.`
          })
        } else {
          setError({ code: 'unknown', title: 'Failed to start shell', body: err.message ?? '' })
        }
      }
    }
    start()

    // A window or splitter drag fires ResizeObserver on every frame. Handing
    // each one to the PTY makes ConPTY rewrap its buffer and signal the agent
    // dozens of times a second, and the agent's TUI repaints on every signal —
    // the same stacked redraws the font-size path above avoids. Coalesce a drag
    // into one fit + one resize, and debounce fit() alongside it so xterm and
    // the PTY stay on the same dimensions the whole way through: anything the
    // agent streams mid-drag then wraps once, at a width both ends agree on.
    let resizeTimer = null
    ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        fitAddon.fit()
        syncPtySize(term)
      }, PTY_RESIZE_DEBOUNCE_MS)
    })
    ro.observe(containerRef.current)

    // Ctrl + wheel → change font size for the whole workspace.
    // Coalesce a wheel burst into one rAF-flushed state update so we don't
    // re-render every pane per tick.
    let pendingStep = 0
    let rafId = 0
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      // Listened for in the capture phase: xterm's own wheel handler calls
      // stopPropagation (e.g. whenever the agent has mouse tracking on), so a
      // bubbling listener here never saw the event. Stop it so xterm doesn't
      // also scroll or forward the wheel to the PTY.
      e.preventDefault()
      e.stopPropagation()
      pendingStep += e.deltaY > 0 ? -1 : 1
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        const step = pendingStep
        pendingStep = 0
        rafId = 0
        if (step !== 0) onFontSizeChangeRef.current?.(step)
      })
    }
    const wheelTarget = containerRef.current
    wheelTarget.addEventListener('wheel', onWheel, { passive: false, capture: true })

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      clearTimeout(resizeTimer)
      detach?.()
      dataDisposable?.dispose()
      ro?.disconnect()
      wheelTarget?.removeEventListener('wheel', onWheel, { capture: true })
      term?.dispose()
      // Note: PTY is NOT killed here. Workspace owns PTY lifecycle.
    }
  }, []) // intentionally empty — runs once on mount

  // xterm linkProvider — Ctrl/Cmd-click on http(s) URLs to open in the OS's
  // default browser. Independent of the path provider below; both providers
  // can run on the same line and xterm will render both ranges as links.
  useEffect(() => {
    if (!termRef.current || !ptyId) return
    const term = termRef.current

    // Trailing characters that are almost always punctuation in surrounding
    // prose, not part of the URL. The regex captures aggressively, then we
    // peel these off the end. Closing brackets are paired — strip them only
    // when the URL has no matching opening bracket.
    //
    // Two patterns are unioned:
    //   1. Explicit-scheme URLs  (https?://)
    //   2. Bare hostnames with a recognised TLD — e.g. status.claude.com
    //      Must have at least one subdomain/label dot before a known TLD so
    //      plain words like "example" or version strings like "1.2.3" don't
    //      match. The TLD list covers the most common ones seen in agent output.
    const KNOWN_TLDS = 'com|org|net|io|dev|ai|app|co|gov|edu|cloud|info|sh'
    const URL_RE = new RegExp(
      `(?:https?:\\/\\/[^\\s<>"'\`{}|\\\\^[\\]]+|\\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+(?:${KNOWN_TLDS})(?:\\/[^\\s<>"'\`{}|\\\\^[\\]]*)?)`,
      'gi'
    )
    const TRAIL_PUNCT = /[.,;:!?]+$/
    function trimUrl(raw) {
      let url = raw.replace(TRAIL_PUNCT, '')
      for (const [open, close] of [['(', ')'], ['[', ']']]) {
        while (url.endsWith(close) && (url.split(open).length - 1) < (url.split(close).length - 1)) {
          url = url.slice(0, -1)
        }
      }
      return url
    }
    function toAbsoluteUrl(url) {
      return /^https?:\/\//i.test(url) ? url : `https://${url}`
    }

    const disposable = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        // Match against the row joined with the rows it wraps into, so a URL
        // the agent's TUI broke across lines is still one link.
        const { text, cells } = logicalLineAt(rowGetter(term), bufferLineNumber - 1, term.cols)
        const links = []
        for (const m of text.matchAll(URL_RE)) {
          const url = trimUrl(m[0])
          if (!url) continue
          const range = spanToRange(cells, m.index, m.index + url.length, bufferLineNumber - 1)
          if (!range) continue
          links.push({
            range,
            text: url,
            activate: (event) => {
              if (!(event.ctrlKey || event.metaKey)) return
              openUrlOnce(toAbsoluteUrl(url))
            },
            hover: () => {},
            leave: () => {},
          })
        }
        callback(links.length === 0 ? undefined : links)
      }
    })
    return () => disposable.dispose()
  }, [ptyId])

  // xterm linkProvider — Ctrl/Cmd-click on parsed paths to open in editor.
  // Reads cwd / workspaceDir / onOpenFile from linkOptsRef so the provider
  // doesn't re-register when those change.
  useEffect(() => {
    if (!termRef.current || !ptyId) return
    const term = termRef.current

    const disposable = term.registerLinkProvider({
      async provideLinks(bufferLineNumber, callback) {
        const y = bufferLineNumber - 1
        const getRow = rowGetter(term)
        const rowText = getRow(y)?.text ?? ''
        const logical = logicalLineAt(getRow, y, term.cols)

        const exists = async (raw) => {
          try {
            const resolved = await resolvePath(
              raw,
              linkOptsRef.current?.cwdRef?.current,
              linkOptsRef.current?.workspaceDirRef?.current,
              window.electronAPI?.editor
            )
            return !!resolved && !!(await window.electronAPI?.editor?.pathExists?.(resolved.path))
          } catch { return false }
        }

        // Paths the agent's TUI broke across rows. Joining rows is a guess,
        // so a joined match only counts if the file is really there —
        // otherwise this row falls back to its own single-row matches.
        const joined = []
        if (logical.first !== logical.last) {
          for (const m of parsePathsInLine(logical.text)) {
            if (!spanCrossesRows(logical.cells, m.start, m.end)) continue
            const range = spanToRange(logical.cells, m.start, m.end, y)
            if (!range) continue
            if (!(await exists(m.raw))) continue
            joined.push({ m, range })
          }
        }

        // A path with spaces in its folder names ("D:\PC Backup\x.md") is a
        // guess too: keep it only if the file exists, otherwise use the
        // space-free matches for that stretch of the row.
        const rowMatches = []
        const plain = parsePathsInLine(rowText, { folderSpaces: false })
        for (const m of parsePathsInLine(rowText)) {
          if (!m.raw.includes(' ') || await exists(m.raw)) { rowMatches.push(m); continue }
          rowMatches.push(...plain.filter(p => p.start >= m.start && p.end <= m.end))
        }
        // Columns a joined link covers on this row, to drop row matches under it.
        const joinedCols = joined.map(({ range }) => [
          range.start.y === bufferLineNumber ? range.start.x : 1,
          range.end.y === bufferLineNumber ? range.end.x : Infinity,
        ])
        const onRow = rowMatches
          .map(m => ({ m, range: { start: { x: m.start + 1, y: bufferLineNumber }, end: { x: m.end, y: bufferLineNumber } } }))
          .filter(({ range }) => !joinedCols.some(([a, b]) => range.start.x <= b && range.end.x >= a))

        const matches = [...joined, ...onRow]
        if (matches.length === 0) return callback(undefined)
        callback(matches.map(({ m, range }) => ({
          range,
          text: m.raw,
          activate: async (event) => {
            if (!(event.ctrlKey || event.metaKey)) return
            const opts = linkOptsRef.current
            const resolved = await resolvePath(
              m.raw,
              opts?.cwdRef?.current,
              opts?.workspaceDirRef?.current,
              window.electronAPI?.editor
            )
            if (!resolved) return
            // Ctrl+Shift+click on an .html/.htm path → open the rendered page
            // in the OS default browser. Plain Ctrl+click keeps the existing
            // "open in editor" behaviour so source viewing still works.
            if (event.shiftKey && /\.html?$/i.test(resolved.path)) {
              window.electronAPI?.openLocalHtml?.(resolved.path)
              return
            }
            // Images, PDFs and other media can't be shown in the text editor —
            // open them in the OS's default viewer instead.
            if (!isProbablyText(resolved.path)) {
              window.electronAPI?.openLocalMedia?.(resolved.path)
              return
            }
            if (!opts?.onOpenFile) return
            opts.onOpenFile({ path: resolved.path, line: resolved.line, col: resolved.col })
          },
          hover: () => {},
          leave: () => {},
        })))
      }
    })
    return () => disposable.dispose()
  }, [ptyId])

  // Ctrl/Cmd held → expose a data-attr on the container so the linkProvider's
  // <span class="xterm-link"> elements pick up `cursor: pointer` via CSS.
  useEffect(() => {
    const host = containerRef.current
    if (!host) return
    function onKey(e) {
      if (e.key === 'Control' || e.key === 'Meta') {
        host.dataset.modifierCtrl = e.type === 'keydown' ? 'true' : ''
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [containerRef])

  return { error, exitCode }
}
