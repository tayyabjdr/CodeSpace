import { useEffect, useState, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export default function useTerminal(id, shell, cwd, containerRef, onActivity) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    let term
    let fitAddon
    let cleanupData
    let cleanupExit
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
          background: '#0f0f0f',
          foreground: 'rgba(255,255,255,0.85)',
          cursor: 'rgba(255,255,255,0.8)',
          cursorAccent: '#0f0f0f',
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

    window.electronAPI.createPty(shell, cwd)
      .then(({ ptyId }) => {
        if (cancelled) {
          window.electronAPI.killPty(ptyId)
          return
        }

        ptyIdRef.current = ptyId

        cleanupData = window.electronAPI.onPtyData(ptyId, data => {
          term.write(data)
          onActivity?.()
        })

        cleanupExit = window.electronAPI.onPtyExit(ptyId, code => {
          setExitCode(code)
        })

        dataDisposable = term.onData(data => {
          window.electronAPI.writePty(ptyId, data)
        })

        window.electronAPI.resizePty(ptyId, term.cols, term.rows)
      })
      .catch(err => {
        if (!cancelled) setError(err.message ?? 'Failed to start shell')
      })

    ro = new ResizeObserver(() => {
      fitAddon.fit()
      if (ptyIdRef.current) {
        window.electronAPI.resizePty(ptyIdRef.current, term.cols, term.rows)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      cancelled = true
      cleanupData?.()
      cleanupExit?.()
      dataDisposable?.dispose()
      ro?.disconnect()
      if (ptyIdRef.current) window.electronAPI.killPty(ptyIdRef.current)
      term?.dispose()
    }
  }, []) // intentionally empty — runs once on mount

  return { error, exitCode }
}
