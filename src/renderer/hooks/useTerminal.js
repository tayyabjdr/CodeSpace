import { useEffect, useState, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import * as ptyPool from '../pty-pool.js'
import { parsePathsInLine } from '../path-parser.js'
import { resolvePath } from '../path-resolver.js'
import { FONT_RESIZE_DEBOUNCE_MS } from '../constants.js'

export default function useTerminal(termId, ptyId, shell, cwd, containerRef, onActivity, onUserInput, onPtyReady, fontSize, onFontSizeChange, linkOpts) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(ptyId)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const onPtyReadyRef = useRef(onPtyReady)
  const onFontSizeChangeRef = useRef(onFontSizeChange)
  const linkOptsRef = useRef(linkOpts)

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
      if (ptyIdRef.current) {
        ptyPool.resizePty(ptyIdRef.current, term.cols, term.rows)
      }
      term.scrollToBottom()
    }, FONT_RESIZE_DEBOUNCE_MS)

    return () => clearTimeout(fontResizeTimerRef.current)
  }, [fontSize])

  useEffect(() => {
    if (!containerRef.current) return

    let term
    let fitAddon
    let detach
    let dataDisposable
    let cancelled = false
    let ro

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: '"Geist Mono Variable", "Geist Mono", "Cascadia Code", monospace',
        lineHeight: 1.5,
        theme: {
          background: '#0d0f12',
          foreground: 'rgba(255,255,255,0.85)',
          cursor: 'rgba(255,255,255,0.8)',
          cursorAccent: '#0d0f12',
          selectionBackground: 'rgba(255,255,255,0.12)',
          black: '#0a0a0a',
          brightBlack: '#3f3f3f',
          red: '#f87171',
          brightRed: '#fca5a5',
          green: '#86efac',
          brightGreen: '#bbf7d0',
          yellow: '#fcd34d',
          brightYellow: '#fde68a',
          blue: '#93c5fd',
          brightBlue: '#bfdbfe',
          magenta: '#c4b5fd',
          brightMagenta: '#ddd6fe',
          cyan: '#67e8f9',
          brightCyan: '#a5f3fc',
          white: 'rgba(255,255,255,0.78)',
          brightWhite: 'rgba(255,255,255,0.92)'
        }
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
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return true

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
          id = await ptyPool.createPty(shell, cwd, termId, term.cols, term.rows)
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

        ptyPool.resizePty(id, term.cols, term.rows)
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

    ro = new ResizeObserver(() => {
      fitAddon.fit()
      if (ptyIdRef.current) ptyPool.resizePty(ptyIdRef.current, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    // Ctrl + wheel → change font size for the whole workspace.
    // Coalesce a wheel burst into one rAF-flushed state update so we don't
    // re-render every pane per tick.
    let pendingStep = 0
    let rafId = 0
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
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
    wheelTarget.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      detach?.()
      dataDisposable?.dispose()
      ro?.disconnect()
      wheelTarget?.removeEventListener('wheel', onWheel)
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
    const URL_RE = /\bhttps?:\/\/[^\s<>"'`{}|\\^[\]]+/gi
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

    function getBufferLine(y) {
      const line = term.buffer.active.getLine(y - 1)
      return line ? line.translateToString(true) : ''
    }

    const disposable = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const text = getBufferLine(bufferLineNumber)
        const links = []
        for (const m of text.matchAll(URL_RE)) {
          const url = trimUrl(m[0])
          if (!url) continue
          const start = m.index
          const end = start + url.length
          links.push({
            range: {
              start: { x: start + 1, y: bufferLineNumber },
              end:   { x: end,       y: bufferLineNumber }
            },
            text: url,
            activate: (event) => {
              if (!(event.ctrlKey || event.metaKey)) return
              window.electronAPI?.openExternal?.(url)
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

    function getBufferLine(y) {
      const line = term.buffer.active.getLine(y - 1)
      return line ? line.translateToString(true) : ''
    }

    const disposable = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const text = getBufferLine(bufferLineNumber)
        const matches = parsePathsInLine(text)
        if (matches.length === 0) return callback(undefined)
        callback(matches.map(m => ({
          range: {
            start: { x: m.start + 1, y: bufferLineNumber },
            end:   { x: m.end,       y: bufferLineNumber }
          },
          text: m.raw,
          activate: async (event) => {
            if (!(event.ctrlKey || event.metaKey)) return
            const opts = linkOptsRef.current
            if (!opts?.onOpenFile) return
            const resolved = await resolvePath(
              m.raw,
              opts.cwdRef?.current,
              opts.workspaceDirRef?.current,
              window.electronAPI?.editor
            )
            if (!resolved) return
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
