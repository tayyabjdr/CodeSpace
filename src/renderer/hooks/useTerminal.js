import { useEffect, useState, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

export default function useTerminal(id, shell, containerRef) {
  const [error, setError] = useState(null)
  const [exitCode, setExitCode] = useState(null)
  const ptyIdRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      const webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available — xterm.js falls back to canvas renderer
    }

    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    let cleanupData
    let cleanupExit
    let dataDisposable
    let cancelled = false

    window.electronAPI.createPty(shell)
      .then(({ ptyId }) => {
        if (cancelled) {
          window.electronAPI.killPty(ptyId)
          return
        }

        ptyIdRef.current = ptyId

        cleanupData = window.electronAPI.onPtyData(ptyId, data => {
          term.write(data)
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

    const ro = new ResizeObserver(() => {
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
      ro.disconnect()
      if (ptyIdRef.current) window.electronAPI.killPty(ptyIdRef.current)
      term.dispose()
    }
  }, []) // intentionally empty — runs once on mount, id/shell are stable

  return { error, exitCode }
}
