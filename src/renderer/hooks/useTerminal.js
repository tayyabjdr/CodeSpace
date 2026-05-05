import { useEffect, useState, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import * as ptyPool from '../pty-pool.js'

export default function useTerminal(ptyId, shell, cwd, containerRef, onActivity, onUserInput, onPtyReady, fontSize, onFontSizeChange) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(ptyId)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const onPtyReadyRef = useRef(onPtyReady)
  const onFontSizeChangeRef = useRef(onFontSizeChange)

  // keep latest callbacks without re-running mount effect
  useEffect(() => { onPtyReadyRef.current = onPtyReady }, [onPtyReady])
  useEffect(() => { onFontSizeChangeRef.current = onFontSizeChange }, [onFontSizeChange])

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
    }, 180)

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

      // Copy selection: Ctrl+Shift+C (so Ctrl+C still sends SIGINT to the shell)
      if (e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) {
          window.electronAPI.writeClipboardText(sel)
          e.preventDefault()
          return false
        }
      }
      return true
    })

    const start = async () => {
      let id = ptyIdRef.current
      try {
        if (!id) {
          id = await ptyPool.createPty(shell, cwd)
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
        if (!cancelled) setError(err.message ?? 'Failed to start shell')
      }
    }
    start()

    ro = new ResizeObserver(() => {
      fitAddon.fit()
      if (ptyIdRef.current) ptyPool.resizePty(ptyIdRef.current, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    // Ctrl + wheel → change font size for the whole workspace
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = e.deltaY > 0 ? -1 : 1
      onFontSizeChangeRef.current?.(step)
    }
    const wheelTarget = containerRef.current
    wheelTarget.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelled = true
      detach?.()
      dataDisposable?.dispose()
      ro?.disconnect()
      wheelTarget?.removeEventListener('wheel', onWheel)
      term?.dispose()
      // Note: PTY is NOT killed here. Workspace owns PTY lifecycle.
    }
  }, []) // intentionally empty — runs once on mount

  return { error, exitCode }
}
